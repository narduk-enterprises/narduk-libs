import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { NeComponentRegistration } from '../src/registry'

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

function makeNuxt() {
  return { options: { build: { transpile: [] as unknown[] } } }
}

interface LoadedModule {
  defaults: { components?: boolean }
  setup: (options: { components?: boolean }, nuxt: unknown) => void | Promise<void>
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

  it('never calls addComponentsDir, so an app-local component collides instead of shadowing', async () => {
    const { addComponentsDir } = mockNuxtKit()
    mockRegistry([{ name: 'NeFixtureOne', filePath: './runtime/components/NeFixtureOne.vue' }])

    const module_ = await loadModule()
    await module_.setup({ components: true }, makeNuxt())

    expect(addComponentsDir).not.toHaveBeenCalled()
    // A *call* to addComponentsDir is what must never appear -- not the
    // identifier itself, which the module's own comment names on purpose to
    // explain why it never calls it (that comment predates this lane and
    // previously tripped this same bare-word regex).
    expect(readFileSync(join(packageRoot, 'src', 'module.ts'), 'utf8')).not.toMatch(
      /addComponentsDir\s*\(/,
    )
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
