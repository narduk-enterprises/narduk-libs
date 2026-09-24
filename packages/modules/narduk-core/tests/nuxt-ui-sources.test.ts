import { readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it, vi } from 'vitest'

import { CORE_NUXT_UI_COMPONENTS } from '../src/nuxt-ui-components'
import {
  extendNuxtUiComponentDetection,
  extendNuxtUiCssSources,
  registerNuxtUiSources,
  tailwindSourceLines,
} from '../src/nuxt-ui-sources'

/**
 * narduk-libs#700: Nuxt UI adds `@source` and component detection only for
 * Nuxt layers. narduk-core and narduk-auth are modules, so they register the
 * files they render themselves.
 */

const RUNTIME_APP = fileURLToPath(new URL('../runtime/app', import.meta.url))
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

interface UiCssTemplate {
  filename: string
  getContents: (data: never) => Promise<string>
}

function uiCssTemplate(contents = '@source "./ui";'): UiCssTemplate {
  return { filename: 'ui.css', getContents: async () => contents }
}

describe('tailwindSourceLines', () => {
  it('quotes each path and normalises Windows separators', () => {
    expect(tailwindSourceLines(['/pkg/app', 'C:\\pkg\\app'])).toBe(
      '@source "/pkg/app";\n@source "C:/pkg/app";',
    )
  })
})

describe('extendNuxtUiCssSources', () => {
  it("prepends the module's sources to Nuxt UI's ui.css", async () => {
    const other = { filename: 'other.css', getContents: vi.fn(() => 'other') }
    const template = uiCssTemplate()

    expect(extendNuxtUiCssSources([other, template], ['/pkg/app'])).toBe(true)

    await expect(template.getContents({} as never)).resolves.toBe(
      '@source "/pkg/app";\n@source "./ui";',
    )
    expect(other.getContents()).toBe('other')
  })

  it('stacks when two modules register, keeping Nuxt UI output last', async () => {
    const template = uiCssTemplate()
    extendNuxtUiCssSources([template], ['/core/app'])
    extendNuxtUiCssSources([template], ['/auth/app'])

    await expect(template.getContents({} as never)).resolves.toBe(
      '@source "/auth/app";\n@source "/core/app";\n@source "./ui";',
    )
  })

  it('does nothing in an app without Nuxt UI', () => {
    expect(extendNuxtUiCssSources([], ['/pkg/app'])).toBe(false)
  })
})

describe('extendNuxtUiComponentDetection', () => {
  it.each([undefined, {}, { experimental: {} }, { experimental: { componentDetection: false } }])(
    'leaves detection off when the app did not turn it on (%j)',
    (ui) => {
      const before = structuredClone(ui)
      extendNuxtUiComponentDetection(ui, ['Button'])
      expect(ui).toEqual(before)
    },
  )

  it('turns `true` into an include list, which keeps detection on', () => {
    const ui = { experimental: { componentDetection: true as boolean | string[] } }
    extendNuxtUiComponentDetection(ui, ['Button', 'Card'])
    expect(ui.experimental.componentDetection).toEqual(['Button', 'Card'])
  })

  it("appends to the app's list without mutating it or duplicating", () => {
    const appList = ['Card', 'Modal']
    const ui = { experimental: { componentDetection: appList as boolean | string[] } }
    extendNuxtUiComponentDetection(ui, ['Button', 'Card'])
    expect(ui.experimental.componentDetection).toEqual(['Card', 'Modal', 'Button'])
    expect(appList).toEqual(['Card', 'Modal'])
  })
})

describe('registerNuxtUiSources', () => {
  it('waits for modules:done, when Nuxt UI has added its template and options', async () => {
    const hooks: Array<() => void> = []
    const templates: UiCssTemplate[] = []
    const nuxt = {
      options: {
        build: { templates },
        ui: {} as Record<string, unknown>,
      },
      hook: (name: 'modules:done', handler: () => void) => {
        expect(name).toBe('modules:done')
        hooks.push(handler)
      },
    }

    registerNuxtUiSources(nuxt, { sources: ['/pkg/app'], components: ['Alert'] })

    // Nuxt UI installs after this module: its template and options arrive late.
    const template = uiCssTemplate()
    templates.push(template)
    nuxt.options.ui = { experimental: { componentDetection: true } }
    for (const hook of hooks) hook()

    await expect(template.getContents({} as never)).resolves.toContain('@source "/pkg/app";')
    expect(nuxt.options.ui).toEqual({ experimental: { componentDetection: ['Alert'] } })
  })

  it('tolerates a host with no build templates', () => {
    const hooks: Array<() => void> = []
    registerNuxtUiSources(
      { options: {}, hook: (_name, handler) => hooks.push(handler) },
      { sources: ['/pkg/app'] },
    )
    expect(() => {
      for (const hook of hooks) hook()
    }).not.toThrow()
  })
})

describe('CORE_NUXT_UI_COMPONENTS', () => {
  it('is exactly what Nuxt UI detection would find in runtime/app', () => {
    expect([...CORE_NUXT_UI_COMPONENTS].sort()).toEqual(nuxtUiComponentsNamedIn(RUNTIME_APP))
  })

  it("includes error.vue's UButton", () => {
    expect(readFileSync(join(RUNTIME_APP, 'error.vue'), 'utf8')).toContain('<UButton')
    expect(CORE_NUXT_UI_COMPONENTS).toContain('Button')
  })
})

describe('narduk-core module registration', () => {
  async function setupCore(options: Record<string, unknown>) {
    vi.resetModules()
    vi.doMock('@nuxt/kit', () => ({
      addComponentsDir: vi.fn(),
      addImportsDir: vi.fn(),
      addPlugin: vi.fn(),
      addServerHandler: vi.fn(),
      addServerScanDir: vi.fn(),
      addTemplate: vi.fn((template: { src: string }) => ({
        filename: template.src.split('/').pop(),
      })),
      createResolver: (url: string) => ({
        resolve: (path: string) => new URL(path, url).pathname,
      }),
      defineNuxtModule: (definition: unknown) => definition,
      installModule: vi.fn(),
    }))
    const mod = (await import('../src/module')).default as unknown as {
      setup: (options: unknown, nuxt: Record<string, unknown>) => Promise<void>
    }
    const hooks = new Map<string, Array<() => unknown>>()
    const nuxt = {
      options: {
        alias: {},
        app: {},
        appConfig: {},
        build: { templates: [uiCssTemplate()], transpile: [] },
        colorMode: {},
        css: [] as string[],
        devServer: {},
        future: {},
        icon: {},
        nitro: {},
        runtimeConfig: {},
        ui: { experimental: { componentDetection: ['Accordion'] } } as Record<string, unknown>,
        vite: {},
      },
      hook(name: string, handler: () => unknown) {
        hooks.set(name, [...(hooks.get(name) || []), handler])
      },
    }
    await mod.setup({ coreModules: false, server: false, ...options }, nuxt)
    for (const hook of hooks.get('modules:done') || []) hook()
    return nuxt.options
  }

  it("adds core's components to an app's componentDetection list", async () => {
    const options = await setupCore({ app: true })

    expect(options.ui).toEqual(
      expect.objectContaining({
        experimental: { componentDetection: ['Accordion', ...CORE_NUXT_UI_COMPONENTS] },
      }),
    )
    // Core's Tailwind source stays in main.css (`@source '../../'`).
    expect(options.css).toContain(join(RUNTIME_APP, 'assets/css/main.css'))
  })

  it('registers nothing when the app surface is off', async () => {
    const options = await setupCore({ app: false })

    expect(options.ui).toEqual(
      expect.objectContaining({ experimental: { componentDetection: ['Accordion'] } }),
    )
  })
})
