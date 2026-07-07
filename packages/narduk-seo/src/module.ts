import { fileURLToPath } from 'node:url'

import { applyCoreViteBuildWarningPolicy } from '@narduk-enterprises/narduk-core/shared/vite-build-warnings'
import {
  addComponentsDir,
  addImportsDir,
  addServerScanDir,
  createResolver,
  defineNuxtModule,
  extendPages,
  extendRouteRules,
  installModule,
} from '@nuxt/kit'
import { defu } from 'defu'

const PACKAGE_NAME = '@narduk-enterprises/narduk-seo'
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

export default defineNuxtModule<NardukSeoModuleOptions>({
  meta: {
    name: PACKAGE_NAME,
    configKey: 'nardukSeo',
    compatibility: { nuxt: '>=3.16.0' },
  },
  defaults: {
    app: true,
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

    nuxtOptions.site = defu((nuxtOptions.site ?? {}) as Record<string, unknown>, {
      name: process.env.APP_NAME || 'Nuxt 4 App',
      description: 'A Nuxt 4 application deployed on Cloudflare Workers.',
    })
    nuxtOptions.runtimeConfig = defu(nuxtOptions.runtimeConfig, {
      public: {
        ogImagePreviewLab: process.env.NUXT_PUBLIC_OG_IMAGE_PREVIEW === 'true',
        publicCatalogBaseUrl,
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
