import { existsSync } from 'node:fs'

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
  const addComponent = vi.fn()
  const addComponentsDir = vi.fn()
  const addImportsDir = vi.fn()
  const addPlugin = vi.fn()
  const addServerHandler = vi.fn()
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
      // Tests describe module wiring, not a production build. Production
      // secret enforcement is covered explicitly below.
      dev: true,
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
    addComponent,
    addComponentsDir,
    addImportsDir,
    addPlugin,
    addServerHandler,
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
    addComponent,
    addComponentsDir,
    addImportsDir,
    addPlugin,
    addServerHandler,
    addServerScanDir,
    extendPages,
    extendRouteRules,
    installSnapshots,
    installModule,
    nuxt,
  }
}

/** Frozen snapshot of production robots.txt options on origin/main before this change. */
const PRODUCTION_ROBOTS_DEFAULTS = {
  disallowNonIndexableRoutes: false,
  disallow: [
    '/__preview/',
    '/admin',
    '/admin/',
    '/auth/',
    '/login',
    '/register',
    '/logout',
    '/reset-password',
    '/dashboard',
    '/dashboard/',
    '/settings',
    '/settings/',
    '/account',
    '/account/',
  ],
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
    // narduk-libs#170: `/_og/**` must stay prerenderable. `nuxt-og-image` emits
    // an unsigned `/_og/s/...` URL while a page is prerendered and relies on the
    // crawler to bake that image to a file; pinning `prerender: false` here left
    // the unsigned URL to 403 at runtime under a signing secret. This assertion
    // is inverted from the original on purpose -- the pin it replaced carried no
    // rationale, which is how the contradiction survived from the initial import
    // to a production 403.
    expect(extendRouteRules).not.toHaveBeenCalledWith('/_og/**', { prerender: false })
  })

  it("adds the network row through narduk-core's footer, not a copy of it (narduk-libs#743)", async () => {
    const { addComponent, addComponentsDir, nuxt } = await setupModule({
      nuxtOptions: { appConfig: { nardukCore: { footer: { after: ['AppOwnRow'] } } } },
    })

    expect(addComponent).toHaveBeenCalledWith({
      name: 'LayerNetworkFooter',
      filePath: expect.stringContaining('/app/components/shared/LayerNetworkFooter.vue'),
      global: true,
    })
    // The scanned directory must not register the same file a second time.
    expect(addComponentsDir).toHaveBeenCalledWith(
      expect.objectContaining({
        path: expect.stringMatching(/\/app\/components$/),
        ignore: ['shared/LayerNetworkFooter.vue'],
      }),
    )
    // An app's own rows stay, and ours is appended once.
    expect(
      (nuxt.options as { appConfig?: { nardukCore?: { footer?: { after?: unknown } } } }).appConfig
        ?.nardukCore?.footer?.after,
    ).toEqual(['AppOwnRow', 'LayerNetworkFooter'])
  })

  it('ships no copy of narduk-core components', () => {
    expect(existsSync(new URL('../app/components/app/LayerAppFooter.vue', import.meta.url))).toBe(
      false,
    )
  })

  it('suppresses every automatic twitter:* meta tag (narduk-libs#349)', async () => {
    const { nuxt } = await setupModule()

    // nuxt-seo-utils' InferSeoMetaPlugin and nuxt-og-image's generateMeta are
    // the two sources that would otherwise re-add `twitter:*` names after
    // useSeo stopped emitting them.
    expect(nuxt.options.seo).toMatchObject({ automaticTwitterTags: false })
    expect(nuxt.options.ogImage).toMatchObject({ includeTwitter: false })
  })

  it('lets the app opt back into automatic twitter:* meta', async () => {
    const { nuxt } = await setupModule({
      nuxtOptions: { ogImage: { includeTwitter: true }, seo: { automaticTwitterTags: true } },
    })

    expect(nuxt.options.seo).toMatchObject({ automaticTwitterTags: true })
    expect(nuxt.options.ogImage).toMatchObject({ includeTwitter: true })
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

  it('keeps production robots.txt defaults unchanged when aiCrawlers is unset', async () => {
    const { addServerHandler, installSnapshots, nuxt } = await setupModule()

    expect(nuxt.options.robots).toEqual(PRODUCTION_ROBOTS_DEFAULTS)
    expect(
      installSnapshots.find((snapshot) => snapshot.moduleName === '@nuxtjs/robots')?.robots,
    ).toEqual(PRODUCTION_ROBOTS_DEFAULTS)
    expect(addServerHandler).not.toHaveBeenCalled()
    expect(
      (nuxt.options.runtimeConfig as { nardukSeoSecurityTxt?: unknown }).nardukSeoSecurityTxt,
    ).toBeNull()
  })

  it('keeps the same robots.txt defaults when aiCrawlers is explicitly allow', async () => {
    const { nuxt } = await setupModule({ moduleOptions: { aiCrawlers: 'allow' } })

    expect(nuxt.options.robots).toEqual(PRODUCTION_ROBOTS_DEFAULTS)
  })

  it('emits @nuxtjs/robots groups that disallow every known AI crawler', async () => {
    const { AI_CRAWLERS } = await import('../shared/aiCrawlers')
    const { installSnapshots, nuxt } = await setupModule({
      moduleOptions: { aiCrawlers: 'disallow' },
    })

    const expected = {
      ...PRODUCTION_ROBOTS_DEFAULTS,
      groups: [{ userAgent: [...AI_CRAWLERS], disallow: ['/'] }],
    }
    expect(nuxt.options.robots).toEqual(expected)
    expect(
      installSnapshots.find((snapshot) => snapshot.moduleName === '@nuxtjs/robots')?.robots,
    ).toEqual(expected)
  })

  it('emits named AI-crawler groups from the object form', async () => {
    const { nuxt } = await setupModule({
      moduleOptions: {
        aiCrawlers: { allow: ['GPTBot'], disallow: ['CCBot'] },
      },
    })

    expect(nuxt.options.robots).toEqual({
      ...PRODUCTION_ROBOTS_DEFAULTS,
      groups: [
        { userAgent: ['CCBot'], disallow: ['/'] },
        // A named group replaces `*` for GPTBot (RFC 9309), so it restates the disallows.
        { userAgent: ['GPTBot'], allow: ['/'], disallow: PRODUCTION_ROBOTS_DEFAULTS.disallow },
      ],
    })
  })

  it('does not add AI-crawler groups on top of staging noindex robots', async () => {
    vi.stubEnv('NARDUK_DEPLOY_TARGET', 'staging')

    const { nuxt } = await setupModule({
      moduleOptions: { aiCrawlers: 'disallow' },
    })

    expect(nuxt.options.robots).toMatchObject({
      allow: [],
      disallow: ['/'],
      sitemap: [],
      robotsDisabledValue: 'noindex, nofollow',
    })
    expect(nuxt.options.robots).not.toHaveProperty('groups')
  })

  it('rejects invalid aiCrawlers config at build time', async () => {
    await expect(setupModule({ moduleOptions: { aiCrawlers: 'nope' } })).rejects.toThrow(
      /nardukSeo\.aiCrawlers must be 'allow', 'disallow'/u,
    )
  })

  it('registers identical security.txt handlers when contact is set', async () => {
    const { addServerHandler, nuxt } = await setupModule({
      moduleOptions: {
        securityTxt: {
          contact: 'mailto:security@example.com',
          expiresDays: 30,
          policy: 'https://example.com/security',
        },
      },
    })

    const body = (nuxt.options.runtimeConfig as { nardukSeoSecurityTxt: string })
      .nardukSeoSecurityTxt
    expect(body).toContain('Contact: mailto:security@example.com')
    expect(body).toContain('Policy: https://example.com/security')
    expect(body).toMatch(/^Expires: /m)
    expect(addServerHandler).toHaveBeenCalledTimes(2)
    const routes = addServerHandler.mock.calls.map(
      (call) => (call[0] as { handler: string; route: string }).route,
    )
    const handlers = addServerHandler.mock.calls.map(
      (call) => (call[0] as { handler: string; route: string }).handler,
    )
    expect(routes).toEqual(['/.well-known/security.txt', '/security.txt'])
    expect(handlers[0]).toBe(handlers[1])
    expect(handlers[0]).toContain('/server/handlers/securityTxt.get')
  })

  it('rejects security.txt enabled without a contact', async () => {
    await expect(setupModule({ moduleOptions: { securityTxt: {} } })).rejects.toThrow(
      /nardukSeo\.securityTxt is enabled but contact is missing/u,
    )
    await expect(setupModule({ moduleOptions: { securityTxt: true } })).rejects.toThrow(
      /nardukSeo\.securityTxt is enabled but contact is missing/u,
    )
  })

  it('never treats an empty OG image secret as configured', async () => {
    vi.stubEnv('NUXT_OG_IMAGE_SECRET', '')

    const { nuxt } = await setupModule()
    const ogImage = nuxt.options.ogImage as { security?: { secret?: unknown } }

    expect(ogImage.security?.secret).toBeUndefined()
  })

  it('fails a non-dev build when runtime OG generation has no signing secret', async () => {
    await expect(setupModule({ nuxtOptions: { dev: false } })).rejects.toThrow(
      /NUXT_OG_IMAGE_SECRET/u,
    )
  })

  it('fails a non-dev build when the OG secret is only whitespace', async () => {
    vi.stubEnv('NUXT_OG_IMAGE_SECRET', '   ')

    await expect(setupModule({ nuxtOptions: { dev: false } })).rejects.toThrow(
      /NUXT_OG_IMAGE_SECRET/u,
    )
  })

  it('keeps prepare and disabled-runtime builds from requiring a secret', async () => {
    await expect(setupModule({ nuxtOptions: { _prepare: true, dev: false } })).resolves.toBeTruthy()

    vi.resetModules()
    vi.clearAllMocks()
    await expect(
      setupModule({ moduleOptions: { seoModule: false }, nuxtOptions: { dev: false } }),
    ).resolves.toBeTruthy()

    vi.resetModules()
    vi.clearAllMocks()
    await expect(
      setupModule({ nuxtOptions: { dev: false, ogImage: { enabled: false } } }),
    ).resolves.toBeTruthy()

    vi.resetModules()
    vi.clearAllMocks()
    await expect(
      setupModule({ nuxtOptions: { dev: false, ogImage: { zeroRuntime: true } } }),
    ).resolves.toBeTruthy()
  })

  it('trims and keeps a configured OG signing secret for non-dev builds', async () => {
    vi.stubEnv('NUXT_OG_IMAGE_SECRET', '  production-og-secret  ')

    const { nuxt } = await setupModule({ nuxtOptions: { dev: false } })

    expect(nuxt.options.ogImage).toMatchObject({
      enabled: true,
      security: { secret: 'production-og-secret' },
    })
  })

  it('rejects the committed CI OG placeholder on a Workers Builds deploy build', async () => {
    const { CI_TEST_ONLY_NUXT_OG_IMAGE_SECRET } = await import('../shared/ogImageSecret')
    vi.stubEnv('NUXT_OG_IMAGE_SECRET', `  ${CI_TEST_ONLY_NUXT_OG_IMAGE_SECRET}  `)
    vi.stubEnv('NARDUK_DEPLOY_TARGET', 'production')
    vi.stubEnv('WORKERS_CI', '1')
    vi.stubEnv('WORKERS_CI_BRANCH', 'main')

    await expect(setupModule({ nuxtOptions: { dev: false } })).rejects.toThrow(
      /test-only placeholder/u,
    )
  })

  it('keeps accepting the CI OG placeholder on a build nothing deploys', async () => {
    const { CI_TEST_ONLY_NUXT_OG_IMAGE_SECRET } = await import('../shared/ogImageSecret')
    vi.stubEnv('NUXT_OG_IMAGE_SECRET', CI_TEST_ONLY_NUXT_OG_IMAGE_SECRET)
    vi.stubEnv('NARDUK_DEPLOY_TARGET', 'production')
    vi.stubEnv('NARDUK_CLOUDFLARE_BUILD', '1')
    vi.stubEnv('WORKERS_CI', '')
    vi.stubEnv('WORKERS_CI_BRANCH', '')
    vi.stubEnv('NARDUK_ALLOW_LOCAL_WRANGLER_DEPLOY', '')

    const { nuxt } = await setupModule({ nuxtOptions: { dev: false } })
    expect(nuxt.options.ogImage).toMatchObject({
      security: { secret: CI_TEST_ONLY_NUXT_OG_IMAGE_SECRET },
    })
  })
})
