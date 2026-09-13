import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { NARDUK_SHELL_APP_CONFIG } from '../src/app-config'
import { NE_SHELL_COMPONENTS, type NeComponentRegistration } from '../src/registry'

const THEME_STYLESHEET = '@narduk-enterprises/narduk-shell/theme.css'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

interface NuxtKitMocks {
  addComponent: ReturnType<typeof vi.fn>
  addComponentsDir: ReturnType<typeof vi.fn>
  addImports: ReturnType<typeof vi.fn>
}

/**
 * The `addImports` call registering `name`. Looked up by name, not position:
 * every backlog item that ships a composable or helper adds its own call, and
 * a test for one of them must not break when another lands.
 */
function importCall(addImports: ReturnType<typeof vi.fn>, name: string) {
  const match = addImports.mock.calls
    .map(([call]) => call as { name: string; from: string })
    .find((call) => call.name === name)
  expect(match, `addImports was not called for ${name}`).toBeDefined()
  return match as { name: string; from: string }
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

    const call = importCall(addImports, 'defineStatusMap')
    expect(call.from.startsWith('/')).toBe(true)
    expect(call.from).toContain('/src/runtime/utils/status-map')
  })

  it('re-exports defineStatusMap from the package root (src/index.ts)', async () => {
    // No mockNuxtKit() here, deliberately: src/index.ts is the `.` barrel and
    // has no legitimate reason to touch '@nuxt/kit' at all (narduk-libs#295),
    // so this loads it for real rather than through a mock that would hide a
    // regression. The "root barrel reachability" test below is the one that
    // actually fails a reintroduced value-level edge to src/module.ts; a
    // mocked '@nuxt/kit' would load either way and prove nothing here.
    const loaded = await import('../src/index')
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
    importCall(addImports, 'defineStatusMap')
  })

  it('keeps the four reserved package exports, with defineStatusMap a named export of the root', async () => {
    const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
      exports: Record<string, unknown>
    }
    expect(Object.keys(manifest.exports)).toEqual(['.', './module', './format', './theme.css'])
  })

  it('auto-imports useConfirm from the runtime composable it ships', async () => {
    const { addImports } = mockNuxtKit()

    const module_ = await loadModule()
    await module_.setup({ components: true }, makeNuxt())

    const call = importCall(addImports, 'useConfirm')
    expect(call.from.startsWith('/')).toBe(true)
    expect(call.from).toContain('/src/runtime/composables/use-confirm')
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

describe('narduk-shell root barrel reachability', () => {
  /**
   * The specifiers a loader actually evaluates. `import type` / `export type`
   * statements are erased before anything runs, which is what makes the type
   * re-exports in src/index.ts free. Same parsing rule
   * test/use-confirm.test.ts's reachability walk uses for src/module.ts;
   * duplicated rather than shared because each walk starts from a different
   * entry and checks a different forbidden target.
   */
  function valueSpecifiers(source: string): string[] {
    const code = source.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/(?<![:/])\/\/[^\n]*/g, '')
    return code
      .split(/\n(?=(?:import|export)\b)/)
      .filter((statement) => /^(?:import|export)\b/.test(statement))
      .filter((statement) => !/^(?:import|export)\s+type\b/.test(statement))
      .map((statement) => /from\s*['"]([^'"]+)['"]/.exec(statement)?.[1])
      .filter((specifier): specifier is string => Boolean(specifier))
  }

  /** A relative specifier resolved to the file it names; a bare one returned as-is. */
  function resolveSpecifier(fromFile: string, specifier: string): string {
    if (!specifier.startsWith('.')) return specifier
    const base = join(dirname(fromFile), specifier)
    for (const candidate of [base, `${base}.ts`, join(base, 'index.ts')]) {
      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
    }
    return base
  }

  /**
   * narduk-libs#295: `.` used to be src/module.ts, which imports `@nuxt/kit`.
   * Nuxt's import-protection plugin refuses any app-code import of a file
   * that pulls in `@nuxt/kit`, which is exactly what broke a plain
   * `import { defineStatusMap } from '@narduk-enterprises/narduk-shell'` in a
   * production `nuxt build` when src/module.ts WAS `.` (0.1.0). src/index.ts
   * is `.` now, and this walk is what keeps it safe: it fails the moment
   * `@nuxt/kit`, or src/module.ts itself, becomes reachable from the barrel
   * through a VALUE import again, whichever file adds the edge.
   */
  it('never reaches @nuxt/kit or src/module.ts by value from src/index.ts', () => {
    const entry = join(packageRoot, 'src', 'index.ts')
    const forbiddenModule = join(packageRoot, 'src', 'module.ts')
    const forbidden = new Set(['@nuxt/kit', forbiddenModule])
    const seen = new Set<string>()
    const queue: Array<{ file: string; trail: string[] }> = [
      { file: entry, trail: ['src/index.ts'] },
    ]
    const visited: string[] = []

    while (queue.length > 0) {
      const { file, trail } = queue.shift()!
      if (seen.has(file)) continue
      seen.add(file)
      visited.push(file)

      for (const specifier of valueSpecifiers(readFileSync(file, 'utf8'))) {
        const resolved = resolveSpecifier(file, specifier)
        const trailDescription = [...trail, specifier].join(' -> ')
        const target = resolved.startsWith(packageRoot) ? relative(packageRoot, resolved) : resolved
        expect(
          forbidden.has(resolved),
          `${trailDescription} reaches ${target}, which src/index.ts must never reach by value (narduk-libs#295)`,
        ).toBe(false)
        if (existsSync(resolved) && statSync(resolved).isFile()) {
          queue.push({ file: resolved, trail: [...trail, specifier] })
        }
      }
    }

    // A walk that resolved nothing would pass vacuously.
    expect(visited.length).toBeGreaterThan(1)
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
