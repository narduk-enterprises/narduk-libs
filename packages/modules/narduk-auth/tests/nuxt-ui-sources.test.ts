import { readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it, vi } from 'vitest'

import { AUTH_NUXT_UI_COMPONENTS } from '../src/nuxt-ui-components'

/**
 * narduk-libs#700: Nuxt UI adds `@source` and component detection only for
 * Nuxt layers, and narduk-auth is a module. Without these registrations,
 * `/auth/native` lost `min-h-dvh`, and with `componentDetection` on,
 * `/auth/callback` and `/auth/confirm` lost `px-4`, `font-bold` and their
 * UCard / UAlert themes.
 */

const APP_DIR = fileURLToPath(new URL('../app', import.meta.url))
const NUXT_UI_COMPONENTS_DIR = fileURLToPath(
  new URL(
    '../node_modules/@narduk-enterprises/narduk-core/node_modules/@nuxt/ui/dist/runtime/components',
    import.meta.url,
  ),
)

function filesUnder(dir: string, keep: (file: string) => boolean): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .map((file) => join(dir, file))
    .filter(keep)
}

/** The component names Nuxt UI's detection matches, via its own pattern. */
function nuxtUiComponentsNamedIn(dir: string): string[] {
  const known = new Set(
    filesUnder(
      NUXT_UI_COMPONENTS_DIR,
      (file) => file.endsWith('.vue') && !file.includes('/prose/'),
    ).map((file) => basename(file, '.vue')),
  )
  const pattern =
    /<(?:Lazy)?U([A-Z][a-zA-Z]+)|<(?:lazy-)?u-([a-z][a-z0-9-]*)|\b(?:Lazy)?U([A-Z][a-zA-Z]+)\b/g
  const found = new Set<string>()
  for (const file of filesUnder(dir, (path) => /\.(?:vue|ts|mts|js|mjs)$/.test(path))) {
    if (file.endsWith('.d.ts')) continue
    for (const match of readFileSync(file, 'utf8').matchAll(pattern)) {
      const name =
        match[1] ??
        match[3] ??
        match[2]!.replaceAll(/(?:^|-)([a-z0-9])/g, (_, char: string) => char.toUpperCase())
      if (known.has(name)) found.add(name)
    }
  }
  return [...found].sort()
}

async function setupAuth(options: { app: boolean }) {
  vi.resetModules()
  vi.doMock('@nuxt/kit', () => ({
    addComponentsDir: vi.fn(),
    addImportsDir: vi.fn(),
    addServerScanDir: vi.fn(),
    addTemplate: vi.fn((template: { src: string }) => ({
      filename: template.src.split('/').pop(),
    })),
    createResolver: (url: string) => ({
      resolve: (path: string) => fileURLToPath(new URL(path, url)),
    }),
    defineNuxtModule: (definition: unknown) => definition,
    extendPages: vi.fn(),
    extendRouteRules: vi.fn(),
  }))
  const mod = (await import('../src/module')).default as unknown as {
    setup: (options: unknown, nuxt: Record<string, unknown>) => void
  }
  const hooks = new Map<string, Array<() => unknown>>()
  const uiCss = {
    filename: 'ui.css',
    getContents: vi.fn(async () => '@source "./ui";'),
  }
  const nuxt = {
    options: {
      appConfig: {},
      build: { templates: [uiCss], transpile: [] },
      nitro: {},
      runtimeConfig: {},
      ui: { experimental: { componentDetection: true } } as Record<string, unknown>,
    },
    hook(name: string, handler: () => unknown) {
      hooks.set(name, [...(hooks.get(name) || []), handler])
    },
  }
  mod.setup({ ...options, server: false }, nuxt)
  for (const hook of hooks.get('modules:done') || []) hook()
  return { css: await uiCss.getContents(), ui: nuxt.options.ui }
}

describe('narduk-auth Nuxt UI sources (#700)', () => {
  it('adds app/ to the Tailwind sources Nuxt UI writes into ui.css', async () => {
    const { css } = await setupAuth({ app: true })

    expect(css).toBe(`@source ${JSON.stringify(APP_DIR)};\n@source "./ui";`)
  })

  it("adds the components auth renders to the app's componentDetection", async () => {
    const { ui } = await setupAuth({ app: true })

    expect(ui).toEqual({ experimental: { componentDetection: [...AUTH_NUXT_UI_COMPONENTS] } })
    expect(AUTH_NUXT_UI_COMPONENTS).toEqual(expect.arrayContaining(['Alert', 'Card']))
  })

  it('registers nothing when the app surface is off', async () => {
    const { css, ui } = await setupAuth({ app: false })

    expect(css).toBe('@source "./ui";')
    expect(ui).toEqual({ experimental: { componentDetection: true } })
  })

  it('is exactly what Nuxt UI detection would find in app/', () => {
    expect([...AUTH_NUXT_UI_COMPONENTS].sort()).toEqual(nuxtUiComponentsNamedIn(APP_DIR))
  })

  it('names app/, which the package ships', () => {
    const { files } = JSON.parse(
      readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
    ) as { files: string[] }

    expect(files).toContain('app/')
  })
})
