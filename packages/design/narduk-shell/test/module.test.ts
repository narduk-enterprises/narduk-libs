import { readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { NARDUK_SHELL_APP_CONFIG } from '../src/app-config'
import type { NeComponentRegistration } from '../src/registry'

const THEME_STYLESHEET = '@narduk-enterprises/narduk-shell/theme.css'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

interface NuxtKitMocks {
  addComponent: ReturnType<typeof vi.fn>
  addComponentsDir: ReturnType<typeof vi.fn>
  addImports: ReturnType<typeof vi.fn>
}

function mockNuxtKit(): NuxtKitMocks {
  const addComponent = vi.fn()
  // Registered so the test can prove the module never reaches for it. A bare
  // `vi.doMock` without this key would make an accidental call throw, which
  // reads as a different failure than the one that matters.
  const addComponentsDir = vi.fn()
  const addImports = vi.fn()

  vi.doMock('@nuxt/kit', () => ({
    addComponent,
    addComponentsDir,
    addImports,
    createResolver: (url: string) => ({
      resolve: (path: string) => new URL(path, url).pathname,
    }),
    defineNuxtModule: (definition: unknown) => definition,
  }))

  return { addComponent, addComponentsDir, addImports }
}

function mockRegistry(components: readonly NeComponentRegistration[]) {
  vi.doMock('../src/registry', () => ({ NE_SHELL_COMPONENTS: components }))
}

function makeNuxt(appConfig: Record<string, unknown> = {}, css: string[] = []) {
  return { options: { build: { transpile: [] as unknown[] }, css, appConfig } }
}

interface ModuleOptions {
  components?: boolean
  theme?: boolean
}

interface LoadedModule {
  defaults: ModuleOptions
  setup: (options: ModuleOptions, nuxt: unknown) => void | Promise<void>
}

async function loadModule(): Promise<LoadedModule> {
  return (await import('../src/module')).default as unknown as LoadedModule
}

describe('narduk-shell module', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.doUnmock('../src/registry')
  })

  it('registers exactly the registry entries, one explicit addComponent each', async () => {
    const { addComponent, addComponentsDir } = mockNuxtKit()
    mockRegistry([
      { name: 'NeFixtureOne', filePath: './runtime/components/NeFixtureOne.vue' },
      { name: 'NeFixtureTwo', filePath: './runtime/components/NeFixtureTwo.vue' },
    ])

    const module_ = await loadModule()
    await module_.setup({ components: true }, makeNuxt())

    expect(addComponent).toHaveBeenCalledTimes(2)
    expect(addComponent.mock.calls.map(([call]) => (call as { name: string }).name)).toEqual([
      'NeFixtureOne',
      'NeFixtureTwo',
    ])
    for (const [call] of addComponent.mock.calls) {
      const { filePath } = call as { filePath: string }
      expect(filePath.startsWith('/')).toBe(true)
      expect(filePath).toContain('/src/runtime/components/NeFixture')
    }
    expect(addComponentsDir).not.toHaveBeenCalled()
  })

  it('wires defineStatusMap through addImports, resolved against the module', async () => {
    const { addImports } = mockNuxtKit()
    mockRegistry([])

    const module_ = await loadModule()
    await module_.setup({ components: true }, makeNuxt())

    expect(addImports).toHaveBeenCalledTimes(1)
    const [call] = addImports.mock.calls[0] as [{ name: string; from: string }]
    expect(call.name).toBe('defineStatusMap')
    expect(call.from.startsWith('/')).toBe(true)
    expect(call.from).toContain('/src/runtime/utils/status-map')
  })

  it('re-exports defineStatusMap from the package root (src/module.ts)', async () => {
    mockNuxtKit()
    const loaded = await import('../src/module')
    expect(typeof loaded.defineStatusMap).toBe('function')
    expect(loaded.defineStatusMap({ live: ['ok', 'Live'] })('live')).toEqual({
      tone: 'ok',
      label: 'Live',
    })
  })

  it('never calls addComponentsDir, so an app-local component collides instead of shadowing', async () => {
    const { addComponentsDir } = mockNuxtKit()
    mockRegistry([{ name: 'NeFixtureOne', filePath: './runtime/components/NeFixtureOne.vue' }])

    const module_ = await loadModule()
    await module_.setup({ components: true }, makeNuxt())

    expect(addComponentsDir).not.toHaveBeenCalled()
    // Belt and braces: the mock above only proves the branches this test
    // reached. Assert the source contains no call at all -- a call, not a
    // mention, so the comment in src/module.ts explaining why it is absent
    // stays legal.
    expect(readFileSync(join(packageRoot, 'src', 'module.ts'), 'utf8')).not.toMatch(
      /addComponentsDir\s*\(/,
    )
  })

  it('registers every shipped registry entry against a real component file', async () => {
    // `beforeEach` already unmocks '../src/registry', so this loads the real,
    // current NE_SHELL_COMPONENTS. Registry-driven on purpose: each backlog
    // item appends its component here and this test must not need editing.
    const { NE_SHELL_COMPONENTS } = await import('../src/registry')
    expect(NE_SHELL_COMPONENTS.length).toBeGreaterThan(0)
    const { addComponent, addComponentsDir } = mockNuxtKit()

    const module_ = await loadModule()
    await module_.setup({ components: true }, makeNuxt())

    expect(addComponent).toHaveBeenCalledTimes(NE_SHELL_COMPONENTS.length)
    expect(addComponent.mock.calls.map(([call]) => (call as { name: string }).name)).toEqual(
      NE_SHELL_COMPONENTS.map((entry) => entry.name),
    )
    for (const [call] of addComponent.mock.calls) {
      const { filePath } = call as { filePath: string }
      expect(filePath.startsWith('/')).toBe(true)
      expect(filePath).toContain('/src/runtime/components/')
      expect(statSync(filePath).isFile()).toBe(true)
    }
    expect(addComponentsDir).not.toHaveBeenCalled()
  })

  it('registers nothing beyond an empty registry', async () => {
    const { addComponent, addComponentsDir } = mockNuxtKit()
    mockRegistry([])

    const module_ = await loadModule()
    await module_.setup({ components: true }, makeNuxt())

    expect(addComponent).not.toHaveBeenCalled()
    expect(addComponentsDir).not.toHaveBeenCalled()
  })

  it('registers no components when components are disabled, but still wires defineStatusMap', async () => {
    const { addComponent, addImports } = mockNuxtKit()
    mockRegistry([{ name: 'NeFixtureOne', filePath: './runtime/components/NeFixtureOne.vue' }])

    const module_ = await loadModule()
    await module_.setup({ components: false }, makeNuxt())

    expect(addComponent).not.toHaveBeenCalled()
    // defineStatusMap is a plain utility, not a component: turning
    // `components` off must not take it away too.
    expect(addImports).toHaveBeenCalledTimes(1)
  })

  it('keeps the three reserved package exports, with defineStatusMap a named export of the root', async () => {
    const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
      exports: Record<string, unknown>
    }
    expect(Object.keys(manifest.exports)).toEqual(['.', './format', './theme.css'])
  })

  it('defaults component registration on, and transpiles the package exactly once', async () => {
    mockNuxtKit()

    const module_ = await loadModule()
    expect(module_.defaults.components).toBe(true)

    const nuxt = makeNuxt()
    await module_.setup({ components: true }, nuxt)
    await module_.setup({ components: true }, nuxt)

    expect(nuxt.options.build.transpile).toEqual(['@narduk-enterprises/narduk-shell'])
  })
})

describe('narduk-shell theme wiring', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.doUnmock('../src/registry')
  })

  it('defaults the theme on', async () => {
    mockNuxtKit()
    expect((await loadModule()).defaults.theme).toBe(true)
  })

  it('puts theme.css at the front of the app css list, exactly once', async () => {
    mockNuxtKit()
    const module_ = await loadModule()
    const nuxt = makeNuxt({}, ['~/assets/app.css'])

    await module_.setup({ theme: true }, nuxt)
    await module_.setup({ theme: true }, nuxt)

    // Front of the list, so the app's own sheet is later in source order and
    // therefore still wins: both are unlayered.
    expect(nuxt.options.css).toEqual([THEME_STYLESHEET, '~/assets/app.css'])
  })

  it('merges the app.config preset as a default the app can beat', async () => {
    mockNuxtKit()
    const module_ = await loadModule()
    const nuxt = makeNuxt({ ui: { colors: { primary: 'emerald' } } })

    await module_.setup({ theme: true }, nuxt)

    const ui = (nuxt.options.appConfig as { ui: { colors: Record<string, string> } }).ui
    // The value that was already there survives; the missing one is filled.
    expect(ui.colors.primary).toBe('emerald')
    expect(ui.colors.neutral).toBe(NARDUK_SHELL_APP_CONFIG.ui.colors.neutral)
  })

  it('supplies both aliases when the app set none', async () => {
    mockNuxtKit()
    const module_ = await loadModule()
    const nuxt = makeNuxt()

    await module_.setup({ theme: true }, nuxt)

    expect((nuxt.options.appConfig as { ui: unknown }).ui).toEqual(NARDUK_SHELL_APP_CONFIG.ui)
  })

  it('adds neither the stylesheet nor the preset when the theme is off', async () => {
    mockNuxtKit()
    const module_ = await loadModule()
    const nuxt = makeNuxt()

    await module_.setup({ theme: false }, nuxt)

    expect(nuxt.options.css).toEqual([])
    expect(nuxt.options.appConfig).toEqual({})
  })

  it('themes independently of component registration', async () => {
    const { addComponent } = mockNuxtKit()
    mockRegistry([{ name: 'NeFixtureOne', filePath: './runtime/components/NeFixtureOne.vue' }])
    const module_ = await loadModule()
    const nuxt = makeNuxt()

    await module_.setup({ components: false, theme: true }, nuxt)

    expect(addComponent).not.toHaveBeenCalled()
    expect(nuxt.options.css).toEqual([THEME_STYLESHEET])
  })

  it('ships the stylesheet the module names, at the reserved subpath', () => {
    expect(THEME_STYLESHEET).toBe('@narduk-enterprises/narduk-shell/theme.css')
    const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
      exports: Record<string, unknown>
      files: string[]
    }
    expect(manifest.exports['./theme.css']).toBe('./theme.css')
    expect(manifest.files).toContain('theme.css')
    expect(statSync(join(packageRoot, 'theme.css')).size).toBeGreaterThan(0)
  })
})
