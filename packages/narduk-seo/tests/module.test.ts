import { afterEach, describe, expect, it, vi } from 'vitest'

interface SetupModuleOptions {
  moduleOptions?: Record<string, unknown>
  nuxtOptions?: Record<string, unknown>
}

async function setupModule(options: SetupModuleOptions = {}) {
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
    setup: (moduleOptions: unknown, nuxt: Record<string, unknown>) => Promise<void>
  }
  const nuxt = {
    options: {
      build: { transpile: [] },
      runtimeConfig: {},
      ...options.nuxtOptions,
    },
    hook: vi.fn(),
  }

  await mod.setup(
    {
      app: true,
      indexNonProduction: false,
      seoModule: true,
      server: true,
      ...options.moduleOptions,
    },
    nuxt,
  )

  return {
    addImportsDir,
    addServerScanDir,
    extendPages,
    extendRouteRules,
    installModule,
    nuxt,
  }
}

afterEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.unstubAllEnvs()
})

describe('narduk-seo module', () => {
  it('registers SEO surface without Nuxt layer inheritance', async () => {
    const { addImportsDir, addServerScanDir, extendPages, extendRouteRules, installModule, nuxt } =
      await setupModule()

    expect(nuxt.options.build.transpile).toContain('@narduk-enterprises/narduk-seo')
    expect(installModule).toHaveBeenCalledWith('nuxt-site-config')
    expect(installModule).toHaveBeenCalledWith('nuxt-og-image')
    expect(installModule).toHaveBeenCalledWith('nuxt-schema-org')
    expect(addImportsDir).toHaveBeenCalledWith(expect.stringContaining('/app/composables'))
    expect(addServerScanDir).toHaveBeenCalledWith(expect.stringContaining('/server'))
    expect(extendPages).toHaveBeenCalledTimes(1)
    expect(extendRouteRules).toHaveBeenCalledWith('/_og/**', { prerender: false })
  })

  it('keeps production deployments indexable by default', async () => {
    vi.stubEnv('NARDUK_DEPLOY_TARGET', 'production')

    const { extendRouteRules, nuxt } = await setupModule({
      nuxtOptions: {
        site: {
          url: 'https://example.com',
        },
      },
    })

    expect(nuxt.options.site).not.toHaveProperty('indexable')
    expect(nuxt.options.sitemap).toMatchObject({
      urls: ['/narduk-network'],
      exclude: expect.arrayContaining(['/__preview/**', '/admin/**']),
    })
    expect(nuxt.options.robots).toMatchObject({
      disallow: expect.arrayContaining(['/__preview/', '/admin/']),
    })
    expect(extendRouteRules).not.toHaveBeenCalledWith('/**', expect.anything(), expect.anything())
  })

  it('forces noindex robots and sitemap suppression for staging deployments', async () => {
    vi.stubEnv('NARDUK_DEPLOY_TARGET', 'staging')

    const { extendRouteRules, nuxt } = await setupModule({
      nuxtOptions: {
        robots: {
          allow: ['/'],
          disallow: ['/private'],
        },
        sitemap: {
          exclude: ['/__preview/**'],
          urls: ['/custom'],
        },
        site: {
          indexable: true,
          url: 'https://staging.example.workers.dev',
        },
      },
    })

    expect(nuxt.options.site).toMatchObject({
      env: 'staging',
      indexable: false,
      url: 'https://staging.example.workers.dev',
    })
    expect(nuxt.options.runtimeConfig).toMatchObject({
      site: {
        env: 'staging',
        indexable: false,
      },
    })
    expect(nuxt.options.sitemap).toMatchObject({
      sources: [],
      urls: [],
      exclude: ['/**'],
    })
    expect(nuxt.options.robots).toMatchObject({
      allow: [],
      disallow: ['/'],
      sitemap: [],
      robotsDisabledValue: 'noindex, nofollow',
    })
    expect(extendRouteRules).toHaveBeenCalledWith(
      '/**',
      {
        headers: {
          'X-Robots-Tag': 'noindex, nofollow',
        },
        site: {
          env: 'staging',
          indexable: false,
        },
        sitemap: false,
      },
      { override: true },
    )
  })

  it('honors explicit non-production indexing opt-in', async () => {
    vi.stubEnv('NARDUK_DEPLOY_TARGET', 'preview')

    const { extendRouteRules, nuxt } = await setupModule({
      moduleOptions: {
        indexNonProduction: true,
      },
      nuxtOptions: {
        site: {
          indexable: true,
          url: 'https://preview.example.workers.dev',
        },
      },
    })

    expect(nuxt.options.site).toMatchObject({
      indexable: true,
      url: 'https://preview.example.workers.dev',
    })
    expect(extendRouteRules).not.toHaveBeenCalledWith('/**', expect.anything(), expect.anything())
  })

  it('honors environment non-production indexing opt-in', async () => {
    vi.stubEnv('NARDUK_DEPLOY_TARGET', 'staging')
    vi.stubEnv('NARDUK_SEO_INDEX_NON_PRODUCTION', 'true')

    const { extendRouteRules, nuxt } = await setupModule({
      nuxtOptions: {
        site: {
          indexable: true,
          url: 'https://staging.example.workers.dev',
        },
      },
    })

    expect(nuxt.options.site).toMatchObject({
      indexable: true,
      url: 'https://staging.example.workers.dev',
    })
    expect(extendRouteRules).not.toHaveBeenCalledWith('/**', expect.anything(), expect.anything())
  })
})
