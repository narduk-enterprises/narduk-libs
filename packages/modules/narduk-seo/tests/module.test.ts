import { afterEach, describe, expect, it, vi } from 'vitest'

interface SetupModuleOptions {
  moduleOptions?: Record<string, unknown>
  nuxtOptions?: Record<string, unknown>
}

function cloneConfig(value: unknown): unknown {
  if (value === undefined) return undefined

  return JSON.parse(JSON.stringify(value))
}

async function setupModule(options: SetupModuleOptions = {}) {
  const addComponentsDir = vi.fn()
  const addImportsDir = vi.fn()
  const addPlugin = vi.fn()
  const addServerScanDir = vi.fn()
  const extendPages = vi.fn()
  const extendRouteRules = vi.fn()
  const installSnapshots: Array<{
    moduleName: string
    robots: unknown
    site: unknown
    sitemap: unknown
  }> = []
  const nuxt = {
    options: {
      build: { transpile: [] },
      runtimeConfig: {},
      ...options.nuxtOptions,
    },
    hook: vi.fn(),
  }
  const installModule = vi.fn((moduleName: string) => {
    installSnapshots.push({
      moduleName,
      robots: cloneConfig(nuxt.options.robots),
      site: cloneConfig(nuxt.options.site),
      sitemap: cloneConfig(nuxt.options.sitemap),
    })
  })

  vi.doMock('@nuxt/kit', () => ({
    addComponentsDir,
    addImportsDir,
    addPlugin,
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
    addPlugin,
    addServerScanDir,
    extendPages,
    extendRouteRules,
    installSnapshots,
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
  it('registers a static fallback only when the app provides an image', async () => {
    const image = { url: '/og.png', alt: 'Example app' }
    const { nuxt, addPlugin } = await setupModule({ moduleOptions: { defaultOgImage: image } })
    expect(nuxt.options.runtimeConfig).toMatchObject({ public: { nardukSeoDefaultImage: image } })
    expect(addPlugin).toHaveBeenCalledWith(
      expect.stringContaining('/app/plugins/defaultSocialImage'),
    )
  })

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

    const { extendRouteRules, installSnapshots, nuxt } = await setupModule({
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
    expect(
      installSnapshots.find((snapshot) => snapshot.moduleName === '@nuxtjs/sitemap')?.sitemap,
    ).toMatchObject({
      urls: ['/narduk-network'],
      exclude: expect.arrayContaining(['/__preview/**', '/admin/**']),
    })
    expect(extendRouteRules).not.toHaveBeenCalledWith('/**', expect.anything(), expect.anything())
  })

  it('forces noindex robots and sitemap suppression for staging deployments', async () => {
    vi.stubEnv('NARDUK_DEPLOY_TARGET', 'staging')

    const { extendRouteRules, installSnapshots, nuxt } = await setupModule({
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
      enabled: false,
      excludeAppSources: true,
      includeAppSources: false,
      sources: [],
      urls: [],
      exclude: ['/**'],
    })
    expect(
      installSnapshots.find((snapshot) => snapshot.moduleName === '@nuxtjs/sitemap')?.sitemap,
    ).toMatchObject({
      enabled: false,
      excludeAppSources: true,
      includeAppSources: false,
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

  it('enables host-aware indexing for production builds that opt in', async () => {
    vi.stubEnv('NARDUK_DEPLOY_TARGET', 'production')

    const { addPlugin, nuxt } = await setupModule({
      moduleOptions: { hostAwareIndexing: true },
    })

    expect(
      (nuxt.options.runtimeConfig as { public?: Record<string, unknown> }).public
        ?.nardukSeoHostAwareIndexing,
    ).toBe(true)
    expect(addPlugin).toHaveBeenCalledWith(
      expect.stringContaining('/app/plugins/hostAwareIndexing'),
    )
  })

  it('keeps host-aware indexing off for non-production targets even when opted in', async () => {
    vi.stubEnv('NARDUK_DEPLOY_TARGET', 'preview')

    const { addPlugin, nuxt } = await setupModule({
      moduleOptions: { hostAwareIndexing: true },
    })

    expect(
      (nuxt.options.runtimeConfig as { public?: Record<string, unknown> }).public
        ?.nardukSeoHostAwareIndexing,
    ).toBe(false)
    expect(addPlugin).not.toHaveBeenCalled()
  })

  it('keeps host-aware indexing off by default and honors the env opt-in', async () => {
    vi.stubEnv('NARDUK_DEPLOY_TARGET', 'production')

    const first = await setupModule()
    expect(
      (first.nuxt.options.runtimeConfig as { public?: Record<string, unknown> }).public
        ?.nardukSeoHostAwareIndexing,
    ).toBe(false)
    expect(first.addPlugin).not.toHaveBeenCalled()

    vi.resetModules()
    vi.clearAllMocks()
    vi.stubEnv('NARDUK_SEO_HOST_AWARE_INDEXING', 'true')

    const second = await setupModule()
    expect(
      (second.nuxt.options.runtimeConfig as { public?: Record<string, unknown> }).public
        ?.nardukSeoHostAwareIndexing,
    ).toBe(true)
    expect(second.addPlugin).toHaveBeenCalledWith(
      expect.stringContaining('/app/plugins/hostAwareIndexing'),
    )
  })
})
