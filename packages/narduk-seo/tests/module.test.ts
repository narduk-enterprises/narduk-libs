import { describe, expect, it, vi } from 'vitest'

describe('narduk-seo module', () => {
  it('registers SEO surface without Nuxt layer inheritance', async () => {
    const addComponentsDir = vi.fn()
    const addImportsDir = vi.fn()
    const addServerScanDir = vi.fn()
    const extendPages = vi.fn()
    const extendRouteRules = vi.fn()
    const installModule = vi.fn()
    vi.doMock('@nuxt/kit', () => ({
      addComponentsDir,
      addImportsDir,
      addServerScanDir,
      createResolver: (url: string) => ({
        resolve: (path: string) => new URL(path, url).pathname,
      }),
      defineNuxtModule: (definition: unknown) => definition,
      extendPages,
      extendRouteRules,
      installModule,
    }))

    const mod = (await import('../src/module')).default as unknown as {
      setup: (options: unknown, nuxt: Record<string, unknown>) => Promise<void>
    }
    const nuxt = {
      options: {
        build: { transpile: [] },
        runtimeConfig: {},
      },
      hook: vi.fn(),
    }

    await mod.setup({ app: true, seoModule: true, server: true }, nuxt)

    expect(nuxt.options.build.transpile).toContain('@narduk-enterprises/narduk-seo')
    expect(installModule).toHaveBeenCalledWith('nuxt-site-config')
    expect(installModule).toHaveBeenCalledWith('nuxt-og-image')
    expect(installModule).toHaveBeenCalledWith('nuxt-schema-org')
    expect(addImportsDir).toHaveBeenCalledWith(expect.stringContaining('/app/composables'))
    expect(addServerScanDir).toHaveBeenCalledWith(expect.stringContaining('/server'))
    expect(extendPages).toHaveBeenCalledTimes(1)
    expect(extendRouteRules).toHaveBeenCalledWith('/_og/**', { prerender: false })
  })
})
