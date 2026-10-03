import { readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it, vi } from 'vitest'

import {
  FIRST_PARTY_NUXT_UI_COMPONENTS,
  firstPartyNuxtUiComponents,
} from '../src/first-party-nuxt-ui-components'
import { CORE_NUXT_UI_COMPONENTS } from '../src/nuxt-ui-components'
import {
  applyComponentDetectionDefault,
  applyLinkPrefetchDefaults,
  trimManifestResourceHints,
} from '../src/performance-defaults'

/**
 * narduk-libs#1369: three first-paint defaults, each on unless the app opts
 * out, and an app's own value always wins.
 */

const MODULES_DONE = 'modules:done'
const AI = '@narduk-enterprises/narduk-ai'
const ANALYTICS = '@narduk-enterprises/narduk-analytics'
const SEO = '@narduk-enterprises/narduk-seo'

interface BuiltOptions {
  experimental: { defaults: { nuxtLink: { prefetchOn: unknown } } }
  ui?: { experimental?: { componentDetection?: unknown } }
}

const MODULES_DIR = fileURLToPath(new URL('../..', import.meta.url))
const NUXT_UI_COMPONENTS_DIR = fileURLToPath(
  new URL('../node_modules/@nuxt/ui/dist/runtime/components', import.meta.url),
)

/** The component names Nuxt UI's detection matches in a directory, via its own pattern. */
function nuxtUiComponentsNamedIn(dir: string): string[] {
  const known = new Set(
    readdirSync(NUXT_UI_COMPONENTS_DIR, { recursive: true, encoding: 'utf8' })
      .filter((file) => file.endsWith('.vue') && !file.includes('prose/'))
      .map((file) => basename(file, '.vue')),
  )
  const pattern =
    /<(?:Lazy)?U([A-Z][a-zA-Z]+)|<(?:lazy-)?u-([a-z][a-z0-9-]*)|\b(?:Lazy)?U([A-Z][a-zA-Z]+)\b/g
  const found = new Set<string>()
  for (const file of readdirSync(dir, { recursive: true, encoding: 'utf8' })) {
    if (!/\.(?:vue|ts|mts|js|mjs)$/.test(file) || file.endsWith('.d.ts')) continue
    for (const match of readFileSync(join(dir, file), 'utf8').matchAll(pattern)) {
      const name =
        match[1] ??
        match[3] ??
        match[2]!.replaceAll(/(?:^|-)([a-z0-9])/g, (_, char: string) => char.toUpperCase())
      if (known.has(name)) found.add(name)
    }
  }
  return [...found].sort()
}

describe('applyComponentDetectionDefault', () => {
  it('turns detection on when the app said nothing', () => {
    const host: { ui?: unknown } = {}
    applyComponentDetectionDefault(host)
    expect(host.ui).toEqual({ experimental: { componentDetection: true } })
  })

  it('keeps an explicit false, an explicit list and the rest of the ui config', () => {
    const off = { ui: { experimental: { componentDetection: false } } }
    applyComponentDetectionDefault(off)
    expect(off.ui.experimental.componentDetection).toBe(false)

    const list = { ui: { colorMode: false, experimental: { componentDetection: ['UCard'] } } }
    applyComponentDetectionDefault(list)
    expect(list.ui).toEqual({ colorMode: false, experimental: { componentDetection: ['UCard'] } })
  })

  it('mutates the existing object, which @nuxt/ui keeps a reference to', () => {
    const ui = {}
    applyComponentDetectionDefault({ ui })
    expect(ui).toEqual({ experimental: { componentDetection: true } })
  })
})

describe('trimManifestResourceHints', () => {
  it('drops prefetch everywhere and preload on scripts only', () => {
    const manifest = {
      'entry.js': { resourceType: 'script', prefetch: true, preload: true },
      'chunk.js': { resourceType: 'script' },
      'entry.css': { resourceType: 'style', prefetch: true, preload: true },
      'font.woff2': { resourceType: 'font', prefetch: true, preload: true },
    }
    trimManifestResourceHints(manifest)
    expect(manifest).toEqual({
      'entry.js': { resourceType: 'script', prefetch: false, preload: false },
      'chunk.js': { resourceType: 'script', prefetch: false, preload: false },
      'entry.css': { resourceType: 'style', prefetch: false, preload: true },
      'font.woff2': { resourceType: 'font', prefetch: false, preload: true },
    })
  })
})

describe('applyLinkPrefetchDefaults', () => {
  // Nuxt's schema has already put `prefetchOn: { visibility: true }` into the
  // resolved options by the time a module runs.
  const resolved = (prefetchOn: Record<string, boolean> = {}) => ({
    experimental: {
      defaults: { nuxtLink: { prefetch: true, prefetchOn: { visibility: true, ...prefetchOn } } },
    },
  })
  const layer = (prefetchOn: unknown) => ({
    config: { experimental: { defaults: { nuxtLink: { prefetchOn } } } },
  })

  it('prefetches on interaction, not visibility, when no layer chose', () => {
    const host = { ...resolved(), _layers: [{ config: {} }] }
    applyLinkPrefetchDefaults(host)
    expect(host.experimental.defaults.nuxtLink).toEqual({
      prefetch: true,
      prefetchOn: { visibility: false, interaction: true },
    })
  })

  it('creates the path when the resolved options carry none', () => {
    const host: { experimental?: Record<string, unknown> } = {}
    applyLinkPrefetchDefaults(host)
    expect(host.experimental).toEqual({
      defaults: { nuxtLink: { prefetchOn: { visibility: false, interaction: true } } },
    })
  })

  it("keeps a key the app's own config wrote and defaults the other", () => {
    const visible = { ...resolved(), _layers: [layer({ visibility: true })] }
    applyLinkPrefetchDefaults(visible)
    expect(visible.experimental.defaults.nuxtLink.prefetchOn).toEqual({
      visibility: true,
      interaction: true,
    })

    const noInteraction = {
      ...resolved({ interaction: false }),
      _layers: [layer({ interaction: false })],
    }
    applyLinkPrefetchDefaults(noInteraction)
    expect(noInteraction.experimental.defaults.nuxtLink.prefetchOn).toEqual({
      visibility: false,
      interaction: false,
    })
  })

  it('treats a key an extended layer wrote as the app side choosing it', () => {
    const host = { ...resolved(), _layers: [{ config: {} }, layer({ visibility: true })] }
    applyLinkPrefetchDefaults(host)
    expect(host.experimental.defaults.nuxtLink.prefetchOn.visibility).toBe(true)
  })

  it('leaves a wholesale non-object choice alone', () => {
    const host = {
      experimental: { defaults: { nuxtLink: { prefetchOn: false } } },
      _layers: [layer(false)],
    }
    applyLinkPrefetchDefaults(host)
    expect(host.experimental.defaults.nuxtLink.prefetchOn).toBe(false)
  })
})

describe('first-party module components', () => {
  it('lists only the modules that are installed, once each', () => {
    const none = firstPartyNuxtUiComponents([{ meta: { name: 'other' } }, {}])
    expect(none).toEqual([])
    expect(firstPartyNuxtUiComponents(undefined)).toEqual([])

    const both = firstPartyNuxtUiComponents([{ meta: { name: AI } }, { meta: { name: ANALYTICS } }])
    expect(both).toEqual([
      ...new Set([
        ...FIRST_PARTY_NUXT_UI_COMPONENTS[AI]!,
        ...FIRST_PARTY_NUXT_UI_COMPONENTS[ANALYTICS]!,
      ]),
    ])
  })

  it.each([
    [AI, ['narduk-ai/app']],
    [ANALYTICS, ['narduk-analytics/app']],
    [SEO, ['narduk-seo/app', 'narduk-seo/components']],
  ])('%s names exactly what Nuxt UI detection would find in it', (name, dirs) => {
    const found = [
      ...new Set(dirs.flatMap((dir) => nuxtUiComponentsNamedIn(join(MODULES_DIR, dir)))),
    ].sort()
    expect([...FIRST_PARTY_NUXT_UI_COMPONENTS[name]!].sort()).toEqual(found)
  })
})

describe('narduk-core module defaults', () => {
  interface SetupInput {
    nuxtOptions?: Record<string, unknown>
    options?: Record<string, unknown>
  }

  async function setupCore({ options = {}, nuxtOptions = {} }: SetupInput = {}) {
    vi.resetModules()
    const installed: Array<{ name: string; ui: unknown }> = []
    const nuxt = {
      options: {
        alias: {},
        app: {},
        appConfig: {},
        build: { templates: [], transpile: [] },
        colorMode: {},
        css: [] as string[],
        devServer: {},
        experimental: {
          defaults: { nuxtLink: { prefetch: true, prefetchOn: { visibility: true } } },
        } as Record<string, unknown>,
        future: {},
        icon: {},
        nitro: {},
        runtimeConfig: {},
        vite: {},
        ...nuxtOptions,
      } as Record<string, unknown>,
      hook(name: string, handler: (...args: never[]) => unknown) {
        hooks.set(name, [...(hooks.get(name) || []), handler])
      },
    }
    const hooks = new Map<string, Array<(...args: never[]) => unknown>>()
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
      installModule: vi.fn((name: string) => {
        installed.push({ name, ui: structuredClone(nuxt.options.ui) })
      }),
    }))
    const mod = (await import('../src/module')).default as unknown as {
      setup: (options: unknown, nuxt: unknown) => Promise<void>
    }
    await mod.setup({ app: false, auth: false, server: false, coreModules: true, ...options }, nuxt)
    return {
      installed,
      options: nuxt.options as unknown as BuiltOptions,
      run: (name: string, ...args: unknown[]) => {
        for (const hook of hooks.get(name) || []) (hook as (...a: unknown[]) => unknown)(...args)
      },
      hooks,
    }
  }

  it('sets each default when the app names none, detection before @nuxt/ui installs', async () => {
    const core = await setupCore({
      nuxtOptions: { _layers: [{ config: {} }] },
    })

    expect(core.installed.find((entry) => entry.name === '@nuxt/ui')?.ui).toEqual({
      experimental: { componentDetection: true },
    })
    expect(core.options.ui?.experimental?.componentDetection).toBe(true)
    expect(core.options.experimental.defaults.nuxtLink.prefetchOn).toEqual({
      visibility: false,
      interaction: true,
    })
    expect(core.hooks.get('build:manifest')).toHaveLength(1)

    const manifest = { 'entry.js': { resourceType: 'script', prefetch: true, preload: true } }
    core.run('build:manifest', manifest)
    expect(manifest['entry.js']).toEqual({
      resourceType: 'script',
      prefetch: false,
      preload: false,
    })
  })

  it("lets the app's own values win", async () => {
    const core = await setupCore({
      nuxtOptions: {
        ui: { experimental: { componentDetection: false } },
        experimental: {
          defaults: { nuxtLink: { prefetchOn: { visibility: true } } },
        },
        _layers: [
          {
            config: {
              experimental: { defaults: { nuxtLink: { prefetchOn: { visibility: true } } } },
            },
          },
        ],
      },
    })
    core.run(MODULES_DONE)

    expect(core.options.ui?.experimental?.componentDetection).toBe(false)
    expect(core.options.experimental.defaults.nuxtLink.prefetchOn).toEqual({
      visibility: true,
      interaction: true,
    })
  })

  it("keeps an app's own componentDetection list and adds first-party components to it", async () => {
    const core = await setupCore({
      nuxtOptions: {
        ui: { experimental: { componentDetection: ['Accordion'] } },
        _installedModules: [{ meta: { name: AI } }],
      },
    })
    core.run(MODULES_DONE)

    expect(core.options.ui?.experimental?.componentDetection).toEqual([
      'Accordion',
      ...FIRST_PARTY_NUXT_UI_COMPONENTS[AI]!,
    ])
  })

  it('names the components of an installed first-party module under the default', async () => {
    const core = await setupCore({
      nuxtOptions: { _installedModules: [{ meta: { name: SEO } }] },
    })
    core.run(MODULES_DONE)

    expect(core.options.ui?.experimental?.componentDetection).toEqual(
      FIRST_PARTY_NUXT_UI_COMPONENTS[SEO],
    )
  })

  it("names core's own components too when the app surface is on", async () => {
    const core = await setupCore({ options: { app: true } })
    core.run(MODULES_DONE)

    expect(core.options.ui?.experimental?.componentDetection).toEqual([...CORE_NUXT_UI_COMPONENTS])
  })

  it.each([
    [
      'componentDetection',
      (options: BuiltOptions) => {
        expect(options.ui?.experimental?.componentDetection).toBeUndefined()
      },
    ],
    [
      'linkPrefetch',
      (options: BuiltOptions) => {
        expect(options.experimental.defaults.nuxtLink.prefetchOn).toEqual({ visibility: true })
      },
    ],
  ])('opts out of %s', async (flag, check) => {
    const core = await setupCore({ options: { performance: { [flag]: false } } })
    core.run(MODULES_DONE)
    check(core.options)
  })

  it('opts out of resourceHints', async () => {
    const core = await setupCore({ options: { performance: { resourceHints: false } } })
    expect(core.hooks.has('build:manifest')).toBe(false)
  })
})
