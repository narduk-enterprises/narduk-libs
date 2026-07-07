import { describe, expect, it, vi } from 'vitest'

describe('narduk-auth module', () => {
  it('registers auth surface without Nuxt layer inheritance', async () => {
    const addComponentsDir = vi.fn()
    const addImportsDir = vi.fn()
    const addLayout = vi.fn()
    const addRouteMiddleware = vi.fn()
    const addServerScanDir = vi.fn()
    const extendPages = vi.fn()
    const extendRouteRules = vi.fn()
    vi.doMock('@nuxt/kit', () => ({
      addComponentsDir,
      addImportsDir,
      addLayout,
      addRouteMiddleware,
      addServerScanDir,
      createResolver: (url: string) => ({
        resolve: (path: string) => new URL(path, url).pathname,
      }),
      defineNuxtModule: (definition: unknown) => definition,
      extendPages,
      extendRouteRules,
    }))

    const mod = (await import('../src/module')).default as unknown as {
      setup: (options: unknown, nuxt: Record<string, unknown>) => void
    }
    const nuxt = {
      options: {
        appConfig: {},
        build: { transpile: [] },
        nitro: {},
        runtimeConfig: {},
      },
      hook: vi.fn(),
    }

    mod.setup({ app: true, server: true }, nuxt)

    expect(nuxt.options.build.transpile).toContain('@narduk-enterprises/narduk-auth')
    expect(addImportsDir).toHaveBeenCalledWith(expect.stringContaining('/app/composables'))
    expect(addRouteMiddleware).toHaveBeenCalledWith({
      name: 'auth',
      path: expect.stringContaining('/app/middleware/auth.ts'),
    })
    expect(addServerScanDir).toHaveBeenCalledWith(expect.stringContaining('/server'))
    expect(extendPages).toHaveBeenCalledTimes(1)
    expect(extendRouteRules).toHaveBeenCalledWith('/login', expect.objectContaining({ ssr: false }))
  })
})
