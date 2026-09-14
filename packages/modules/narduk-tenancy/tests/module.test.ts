import { beforeEach, describe, expect, it, vi } from 'vitest'

const kitMocks = vi.hoisted(() => ({
  addServerScanDir: vi.fn(),
}))

vi.mock('@nuxt/kit', () => ({
  addServerScanDir: kitMocks.addServerScanDir,
  createResolver: (url: string) => ({
    resolve: (path: string) => new URL(path, url).pathname,
  }),
  defineNuxtModule: (definition: unknown) => definition,
}))

interface ModuleUnderTest {
  setup: (options: unknown, nuxt: Record<string, unknown>) => void
}

function nuxtStub() {
  return {
    options: {
      build: { transpile: [] as string[] },
    },
    hook: vi.fn(),
  }
}

describe('narduk-tenancy Nuxt module', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('registers the server surface and inlines the package for Nitro', async () => {
    const mod = (await import('../src/module')).default as unknown as ModuleUnderTest
    const nuxt = nuxtStub()

    mod.setup({ server: true }, nuxt)

    expect(nuxt.options.build.transpile).toContain('@narduk-enterprises/narduk-tenancy')
    expect(kitMocks.addServerScanDir).toHaveBeenCalledWith(expect.stringContaining('/server'))
    expect(
      (nuxt.options as unknown as { nitro: { externals: { inline: string[] } } }).nitro.externals
        .inline,
    ).toContain('@narduk-enterprises/narduk-tenancy')
  })

  it('can be installed without auto-wiring the server directory', async () => {
    const mod = (await import('../src/module')).default as unknown as ModuleUnderTest
    const nuxt = nuxtStub()

    mod.setup({ server: false }, nuxt)

    expect(kitMocks.addServerScanDir).not.toHaveBeenCalled()
  })

  it('registers no pages, components, or runtime config', async () => {
    const source = (await import('node:fs')).readFileSync(
      new URL('../src/module.ts', import.meta.url),
      'utf8',
    )
    expect(source).not.toContain('extendPages')
    expect(source).not.toContain('addComponentsDir')
    expect(source).not.toContain('runtimeConfig')
  })
})
