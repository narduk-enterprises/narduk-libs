import { beforeEach, describe, expect, it, vi } from 'vitest'

const kitMocks = vi.hoisted(() => ({
  addComponentsDir: vi.fn(),
  addImportsDir: vi.fn(),
  addServerScanDir: vi.fn(),
}))

vi.mock('@nuxt/kit', () => ({
  addComponentsDir: kitMocks.addComponentsDir,
  addImportsDir: kitMocks.addImportsDir,
  addServerScanDir: kitMocks.addServerScanDir,
  createResolver: (url: string) => ({
    resolve: (path: string) => new URL(path, url).pathname,
  }),
  defineNuxtModule: (definition: unknown) => definition,
}))

describe('narduk-ai Nuxt module', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    delete process.env.XAI_API_KEY
    delete process.env.NUXT_XAI_API_KEY
  })

  it('wires optional app/server surfaces and keeps xAI credentials private', async () => {
    process.env.XAI_API_KEY = '  xai-secret  '
    const mod = (await import('../src/module')).default as unknown as {
      setup: (options: unknown, nuxt: Record<string, unknown>) => void
    }
    const nuxt = {
      options: {
        build: { transpile: [] },
        runtimeConfig: { public: {} },
      },
      hook: vi.fn(),
    }

    mod.setup({ app: true, server: true }, nuxt)

    expect(nuxt.options.build.transpile).toContain('@narduk-enterprises/narduk-ai')
    expect(kitMocks.addImportsDir).toHaveBeenCalledWith(expect.stringContaining('/app/composables'))
    expect(kitMocks.addComponentsDir).toHaveBeenCalledWith(
      expect.objectContaining({ path: expect.stringContaining('/app/components') }),
    )
    expect(kitMocks.addServerScanDir).toHaveBeenCalledWith(expect.stringContaining('/server'))
    expect(nuxt.options.runtimeConfig).toMatchObject({ xaiApiKey: 'xai-secret' })
    expect(
      (nuxt.options.runtimeConfig as { public: Record<string, unknown> }).public,
    ).not.toHaveProperty('xaiApiKey')
  })

  it('can be used for explicit imports without auto-wiring app or server code', async () => {
    const mod = (await import('../src/module')).default as unknown as {
      setup: (options: unknown, nuxt: Record<string, unknown>) => void
    }
    const nuxt = {
      options: {
        build: { transpile: [] },
        runtimeConfig: {},
      },
      hook: vi.fn(),
    }

    mod.setup({ app: false, server: false }, nuxt)

    expect(kitMocks.addImportsDir).not.toHaveBeenCalled()
    expect(kitMocks.addComponentsDir).not.toHaveBeenCalled()
    expect(kitMocks.addServerScanDir).not.toHaveBeenCalled()
  })
})
