/**
 * narduk-libs#978: Nuxt UI adds `@source` and component detection only for
 * Nuxt layers, and narduk-shell is a module. Without these registrations a
 * utility only a `Ne*` component uses was never generated in a consuming app,
 * and with `componentDetection` on the `U*` components the suite renders lost
 * their themes.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it, vi } from 'vitest'

import { SHELL_NUXT_UI_COMPONENTS } from '../src/nuxt-ui-sources'

const RUNTIME_DIR = fileURLToPath(new URL('../src/runtime', import.meta.url))
const NUXT_UI_COMPONENTS_DIR = fileURLToPath(
  new URL('../node_modules/@nuxt/ui/dist/runtime/components', import.meta.url),
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

async function setupShell(options: { components?: boolean }, detection?: boolean | string[]) {
  vi.resetModules()
  vi.doMock('@nuxt/kit', () => ({
    addComponent: vi.fn(),
    addComponentsDir: vi.fn(),
    addImports: vi.fn(),
    addPlugin: vi.fn(),
    createResolver: (url: string) => ({
      resolve: (path: string) => fileURLToPath(new URL(path, url)),
    }),
    defineNuxtModule: (definition: unknown) => definition,
  }))
  const mod = (await import('../src/module')).default as unknown as {
    setup: (options: unknown, nuxt: Record<string, unknown>) => void
  }
  const hooks = new Map<string, Array<() => unknown>>()
  const uiCss = { filename: 'ui.css', getContents: async () => '@source "./ui";' }
  const ui = detection === undefined ? {} : { experimental: { componentDetection: detection } }
  const nuxt = {
    hook: (name: string, handler: () => unknown) => {
      hooks.set(name, [...(hooks.get(name) ?? []), handler])
    },
    options: { appConfig: {}, build: { templates: [uiCss], transpile: [] }, css: [], ui },
  }
  mod.setup(options, nuxt)
  for (const handler of hooks.get('modules:done') ?? []) await handler()
  return { css: await uiCss.getContents(), ui }
}

describe('narduk-shell registers its runtime with Tailwind and Nuxt UI (#978)', () => {
  it('names exactly the Nuxt UI components src/runtime renders', () => {
    expect([...SHELL_NUXT_UI_COMPONENTS]).toEqual(nuxtUiComponentsNamedIn(RUNTIME_DIR))
  })

  it("prepends an @source for src/runtime to Nuxt UI's ui.css", async () => {
    const { css } = await setupShell({})
    expect(css).toBe(`@source ${JSON.stringify(RUNTIME_DIR)};\n@source "./ui";`)
  })

  it('still registers with components off, since useConfirm renders NeConfirmDialog', async () => {
    const { css } = await setupShell({ components: false })
    expect(css.startsWith(`@source ${JSON.stringify(RUNTIME_DIR)};`)).toBe(true)
  })

  it('adds the suite to componentDetection when the app turned it on', async () => {
    const { ui } = await setupShell({}, ['Tooltip'])
    expect(ui.experimental?.componentDetection).toEqual(['Tooltip', ...SHELL_NUXT_UI_COMPONENTS])
  })

  it('turns detection `true` into the list, and leaves it off when off', async () => {
    expect((await setupShell({}, true)).ui.experimental?.componentDetection).toEqual([
      ...SHELL_NUXT_UI_COMPONENTS,
    ])
    expect((await setupShell({}, false)).ui.experimental?.componentDetection).toBe(false)
  })
})
