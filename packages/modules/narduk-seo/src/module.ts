import { fileURLToPath } from 'node:url'

import { applyCoreViteBuildWarningPolicy } from '@narduk-enterprises/narduk-core/shared/vite-build-warnings'
import {
  addComponentsDir,
  addImportsDir,
  addPlugin,
  addServerScanDir,
  createResolver,
  defineNuxtModule,
  extendPages,
  extendRouteRules,
  installModule,
} from '@nuxt/kit'
import { defu } from 'defu'

const PACKAGE_NAME = '@narduk-enterprises/narduk-seo'
const nonProductionRobotsRule = 'noindex, nofollow'
const nonProductionDeploymentTargets = new Set(['staging', 'preview'])
const nonPublicSitemapRoutes = [
  '/__preview/**',
  '/admin',
  '/admin/**',
  '/api/**',
  '/auth/**',
  '/login',
  '/register',
  '/logout',
  '/reset-password',
  '/dashboard',
  '/dashboard/**',
  '/settings',
  '/settings/**',
  '/account',
  '/account/**',
]
const nonPublicRobotsDisallow = [
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
]

type ViteAlias = Array<{ find: RegExp | string; replacement: string }>

interface MutableViteConfig {
  resolve?: {
    alias?: Record<string, string> | ViteAlias
  }
}

interface ViteExtendContext {
  isClient?: boolean
  isServer?: boolean
}

interface MutableNuxtOptionsRecord {
  alias: Record<string, string>
  build: {
    transpile: string[]
  }
  future?: Record<string, unknown>
  nitro?: Record<string, unknown>
  ogImage?: Record<string, unknown>
  robots?: Record<string, unknown>
  runtimeConfig: Record<string, unknown>
  site?: Record<string, unknown>
  sitemap?: Record<string, unknown>
  typescript?: Record<string, unknown>
}

interface TypeReference {
  path?: string
  types?: string
}

interface TypePrepareOptions {
  references?: TypeReference[]
  tsConfig?: {
    include?: string[]
  }
}

export interface NardukSeoModuleOptions {
  app?: boolean
  /** App-owned 1200x630 static fallback for every page, including noindex routes. */
  defaultOgImage?: { alt: string; url: string }
  /**
   * Production-only, build-once indexing contract: the canonical site host
   * stays indexable while any other request host (e.g. a route-free
   * `workers.dev` preview alias of the same immutable version) is served
   * `noindex, nofollow` at runtime — header via server middleware, meta via
   * an app plugin. Also enabled by `NARDUK_SEO_HOST_AWARE_INDEXING`. Only
   * active when the deployment target is `production`; non-production
   * targets keep the existing build-time noindex safety.
   */
  hostAwareIndexing?: boolean
  indexNonProduction?: boolean
  /**
   * Absolute HTTPS endpoint serving the Narduk network directory feed for
   * `/narduk-network`. Also settable at runtime with
   * `NUXT_PUBLIC_NARDUK_NETWORK_DIRECTORY_URL`.
   *
   * **There is no default, by design.** Leaving it unset disables the
   * directory feature entirely: the `/api/narduk-network/sites` route makes no
   * outbound request and `/narduk-network` renders an empty directory. This
   * package will not fetch a hostname the consuming app never chose.
   */
  networkDirectoryUrl?: string
  seoModule?: boolean
  server?: boolean
}

function pushUnique<T>(items: T[], item: T): void {
  if (!items.includes(item)) {
    items.push(item)
  }
}

function toAliasArray(alias: Record<string, string> | ViteAlias | undefined): ViteAlias {
  if (!alias) return []
  if (Array.isArray(alias)) return alias

  return Object.entries(alias).map(([find, replacement]) => ({ find, replacement }))
}

function registerTypeReference(options: TypePrepareOptions, path: string): void {
  options.references ??= []
  if (!options.references.some((reference) => reference.path === path)) {
    options.references.push({ path })
  }

  options.tsConfig ??= {}
  options.tsConfig.include ??= []
  if (!options.tsConfig.include.includes(path)) {
    options.tsConfig.include.push(path)
  }
}

function addNitroInlinePackage(nuxtOptions: MutableNuxtOptionsRecord, packageName: string): void {
  const nitro = (nuxtOptions.nitro ??= {}) as {
    externals?: {
      inline?: string[]
    }
  }
  nitro.externals ??= {}
  nitro.externals.inline ??= []
  pushUnique(nitro.externals.inline, packageName)
}

function addPageIfMissing(
  pages: Array<{ file?: string; name?: string; path?: string }>,
  page: { file: string; name: string; path: string },
): void {
  if (!pages.some((existing) => existing.path === page.path)) {
    pages.push(page)
  }
}

function readTrimmedEnv(keys: string[]): string {
  for (const key of keys) {
    const value = process.env[key]?.trim()
    if (value) return value
  }

  return ''
}

function readBooleanEnv(key: string): boolean {
  return ['1', 'true', 'yes', 'on'].includes((process.env[key] || '').trim().toLowerCase())
}

function readDeploymentTarget(): string {
  return readTrimmedEnv([
    'NARDUK_DEPLOY_TARGET',
    'NUXT_PUBLIC_NARDUK_DEPLOY_TARGET',
    'NUXT_PUBLIC_DEPLOYMENT_TARGET',
  ]).toLowerCase()
}

function isNonProductionDeployment(): boolean {
  const deploymentTarget = readDeploymentTarget()

  return nonProductionDeploymentTargets.has(deploymentTarget)
}

function shouldForceNonProductionNoindex(options: NardukSeoModuleOptions): boolean {
  if (options.indexNonProduction || readBooleanEnv('NARDUK_SEO_INDEX_NON_PRODUCTION')) {
    return false
  }

  return isNonProductionDeployment()
}

function shouldEnableHostAwareIndexing(options: NardukSeoModuleOptions): boolean {
  if (!(options.hostAwareIndexing || readBooleanEnv('NARDUK_SEO_HOST_AWARE_INDEXING'))) {
    return false
  }

  return readDeploymentTarget() === 'production'
}

function applyNonProductionSeoSafety(nuxtOptions: MutableNuxtOptionsRecord): void {
  const deploymentTarget = readDeploymentTarget()
  const nonProductionRouteRule = {
    headers: {
      'X-Robots-Tag': nonProductionRobotsRule,
    },
    site: {
      env: deploymentTarget,
      indexable: false,
    },
    sitemap: false,
  } as unknown as Parameters<typeof extendRouteRules>[1]

  nuxtOptions.site = {
    ...((nuxtOptions.site ?? {}) as Record<string, unknown>),
    env: deploymentTarget,
    indexable: false,
  }
  nuxtOptions.runtimeConfig = {
    ...nuxtOptions.runtimeConfig,
    site: {
      ...((nuxtOptions.runtimeConfig.site ?? {}) as Record<string, unknown>),
      env: deploymentTarget,
      indexable: false,
    },
  }
  nuxtOptions.sitemap = {
    ...((nuxtOptions.sitemap ?? {}) as Record<string, unknown>),
    enabled: false,
    excludeAppSources: true,
    includeAppSources: false,
    sources: [],
    urls: [],
    exclude: ['/**'],
  }
  nuxtOptions.robots = {
    ...((nuxtOptions.robots ?? {}) as Record<string, unknown>),
    allow: [],
    disallow: ['/'],
    sitemap: [],
    robotsDisabledValue: nonProductionRobotsRule,
  }

  extendRouteRules('/**', nonProductionRouteRule, { override: true })
}

export default defineNuxtModule<NardukSeoModuleOptions>({
  meta: {
    name: PACKAGE_NAME,
    configKey: 'nardukSeo',
    compatibility: { nuxt: '>=3.16.0' },
  },
  defaults: {
    app: true,
    hostAwareIndexing: false,
    indexNonProduction: false,
    seoModule: true,
    server: true,
  },
  async setup(options, nuxt) {
    const resolver = createResolver(import.meta.url)
    const nuxtOptions = nuxt.options as unknown as MutableNuxtOptionsRecord
    const trimmedPublicCatalogBaseUrl = process.env.PUBLIC_CATALOG_BASE_URL?.trim().replace(
      /\/+$/,
      '',
    )
    const publicCatalogBaseUrl = trimmedPublicCatalogBaseUrl || 'https://catalog.nard.uk'
    // Injectable, no default: unset disables the network directory feature.
    const nardukNetworkDirectoryUrl =
      options.networkDirectoryUrl?.trim() ||
      process.env.NUXT_PUBLIC_NARDUK_NETWORK_DIRECTORY_URL?.trim() ||
      ''
    const browserConsolaShim = fileURLToPath(
      new URL('../app/shims/consola-browser.ts', import.meta.url),
    )
    const browserConsolaUtilsShim = fileURLToPath(
      new URL('../app/shims/consola-utils-browser.ts', import.meta.url),
    )
    const seoRuntimeConfigTypesPath = fileURLToPath(
      new URL('../shared/types/runtime-config.d.ts', import.meta.url),
    )

    pushUnique(nuxtOptions.build.transpile, PACKAGE_NAME)
    addNitroInlinePackage(nuxtOptions, PACKAGE_NAME)
    nuxtOptions.alias = {
      ...nuxtOptions.alias,
      '#narduk-seo-server': resolver.resolve('../server'),
    }

    nuxtOptions.site = defu((nuxtOptions.site ?? {}) as Record<string, unknown>, {
      name: process.env.APP_NAME || 'Nuxt 4 App',
      description: 'A Nuxt 4 application deployed on Cloudflare Workers.',
    })
    const hostAwareIndexing = shouldEnableHostAwareIndexing(options)

    nuxtOptions.runtimeConfig = defu(nuxtOptions.runtimeConfig, {
      public: {
        nardukSeoDefaultImage: options.defaultOgImage ?? null,
        nardukNetworkDirectoryUrl,
        nardukSeoHostAwareIndexing: hostAwareIndexing,
        ogImagePreviewLab: process.env.NUXT_PUBLIC_OG_IMAGE_PREVIEW === 'true',
        publicCatalogBaseUrl,
        // Deprecated and unread since narduk-libs#349; kept so existing
        // NUXT_PUBLIC_TWITTER_SITE deployments keep booting unchanged.
        twitterSite: process.env.NUXT_PUBLIC_TWITTER_SITE || '',
        seoSearchActionUrlTemplate: process.env.NUXT_PUBLIC_SEO_SEARCH_ACTION_URL_TEMPLATE || '',
      },
    })
    nuxtOptions.ogImage = defu((nuxtOptions.ogImage ?? {}) as Record<string, unknown>, {
      enabled: true,
      security: {
        secret: process.env.NUXT_OG_IMAGE_SECRET || '',
      },
      defaults: {
        width: 1200,
        height: 630,
        extension: 'png',
        cacheMaxAgeSeconds: 60 * 60 * 24,
      },
      runtimeCacheStorage: {
        driver: 'cloudflare-kv-binding',
        binding: 'OG_IMAGE_CACHE',
      },
      compatibility: {
        runtime: {
          browser: false,
          resvg: 'wasm',
          takumi: 'wasm',
        },
      },
    })
    nuxtOptions.sitemap = defu((nuxtOptions.sitemap ?? {}) as Record<string, unknown>, {
      urls: ['/narduk-network'],
      exclude: nonPublicSitemapRoutes,
    })
    nuxtOptions.robots = defu((nuxtOptions.robots ?? {}) as Record<string, unknown>, {
      disallowNonIndexableRoutes: false,
      disallow: nonPublicRobotsDisallow,
    })
    if (shouldForceNonProductionNoindex(options)) {
      applyNonProductionSeoSafety(nuxtOptions)
    }
    if (hostAwareIndexing) {
      addPlugin(resolver.resolve('../app/plugins/hostAwareIndexing'))
    }

    if (options.seoModule) {
      await installModule('nuxt-site-config')
      await installModule('@nuxtjs/robots')
      await installModule('@nuxtjs/sitemap')
      await installModule('nuxt-link-checker')
      await installModule('nuxt-og-image')
      await installModule('nuxt-schema-org')
      await installModule('nuxt-seo-utils')
    }

    if (options.app) {
      if (options.defaultOgImage) addPlugin(resolver.resolve('../app/plugins/defaultSocialImage'))
      addImportsDir(resolver.resolve('../app/composables'))
      addImportsDir(resolver.resolve('../app/utils'))
      addComponentsDir({
        path: resolver.resolve('../app/components'),
        pathPrefix: false,
      })
      addComponentsDir({
        path: resolver.resolve('../components'),
        pathPrefix: false,
      })
      extendPages((pages) => {
        addPageIfMissing(pages, {
          name: 'og-image-preview',
          path: '/__preview/og-images',
          file: resolver.resolve('../app/pages/__preview/og-images.vue'),
        })
        addPageIfMissing(pages, {
          name: 'narduk-network',
          path: '/narduk-network',
          file: resolver.resolve('../app/pages/narduk-network.vue'),
        })
      })
    }

    if (options.server) {
      addServerScanDir(resolver.resolve('../server'))
    }

    nuxtOptions.future = defu((nuxtOptions.future ?? {}) as Record<string, unknown>, {
      compatibilityVersion: 4,
    })
    nuxtOptions.typescript = defu((nuxtOptions.typescript ?? {}) as Record<string, unknown>, {
      tsConfig: {
        include: ['../components/**/*.vue'],
      },
    })

    extendRouteRules('/_og/**', { prerender: false })
    extendRouteRules('/apple-touch-icon-precomposed.png', {
      redirect: '/apple-touch-icon.png',
    })

    const registerSeoTypes = (prepareOptions: TypePrepareOptions) => {
      registerTypeReference(prepareOptions, seoRuntimeConfigTypesPath)
    }

    nuxt.hook('nitro:prepare:types', registerSeoTypes)
    nuxt.hook('prepare:types', registerSeoTypes)
    nuxt.hook('vite:extendConfig', (config, context) => {
      applyCoreViteBuildWarningPolicy(config)

      const viteConfig = config as MutableViteConfig
      const viteContext = context as ViteExtendContext | undefined

      if (viteContext?.isServer || viteContext?.isClient === false) return

      viteConfig.resolve ??= {}
      viteConfig.resolve.alias = [
        ...toAliasArray(viteConfig.resolve.alias),
        { find: /^consola$/, replacement: browserConsolaShim },
        { find: /^consola\/utils$/, replacement: browserConsolaUtilsShim },
      ]
    })
  },
})
