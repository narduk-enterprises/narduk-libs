import { fileURLToPath } from 'node:url'

import { applyCoreViteBuildWarningPolicy } from '@narduk-enterprises/narduk-core/shared/vite-build-warnings'
import {
  addComponent,
  addComponentsDir,
  addImports,
  addImportsDir,
  addPlugin,
  addServerHandler,
  addServerScanDir,
  createResolver,
  defineNuxtModule,
  extendPages,
  extendRouteRules,
  installModule,
  useLogger,
} from '@nuxt/kit'
import { defu } from 'defu'

import { type AiCrawlersOption, mergeAiCrawlerRobotsGroups } from '../shared/aiCrawlers'
import {
  DEPLOYMENT_TARGET_ENV_KEYS,
  resolveBuildDeploymentTarget,
} from '../shared/deploymentTarget'
import {
  canResolveNuxtOgImage,
  isNuxtOgImageModuleRequested,
  isRuntimeOgImageGenerationEnabled,
  isRuntimeOgImageGenerationExplicitlyRequested,
  MISSING_NUXT_OG_IMAGE_MESSAGE,
} from '../shared/nuxtOgImagePackage'
import {
  assertOgImageSigningSecretForBuild,
  resolveOgImageSigningSecret,
} from '../shared/ogImageSecret'
import {
  type NardukSecurityTxtOptions,
  resolveSecurityTxtBody,
  SECURITY_TXT_LEGACY_PATH,
  SECURITY_TXT_WELL_KNOWN_PATH,
} from '../shared/securityTxt'

export {
  AI_CRAWLERS,
  type AiCrawlerLists,
  type AiCrawlerRobotsGroup,
  type AiCrawlerUserAgent,
  type AiCrawlersOption,
} from '../shared/aiCrawlers'
export {
  type NardukSecurityTxtOptions,
  SECURITY_TXT_CONTENT_TYPE,
  SECURITY_TXT_DEFAULT_EXPIRES_DAYS,
  SECURITY_TXT_LEGACY_PATH,
  SECURITY_TXT_MAX_EXPIRES_DAYS,
  SECURITY_TXT_WELL_KNOWN_PATH,
} from '../shared/securityTxt'

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
  seo?: Record<string, unknown>
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
  /**
   * Extra @nuxtjs/robots groups for known AI crawlers. `'allow'` (default)
   * emits nothing, so existing apps keep the same robots.txt. `'disallow'`
   * blocks the exported `AI_CRAWLERS` list; the object form targets named
   * crawlers only.
   */
  aiCrawlers?: AiCrawlersOption
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
  /**
   * Branch whose Workers Builds (or Pages) builds are production when no
   * `NARDUK_DEPLOY_TARGET` is set; every other branch builds as `preview` and
   * is noindexed. Default `'main'`. An app that deploys production from
   * another branch (e.g. `master`) must set this or an explicit target.
   */
  productionBranch?: string
  /**
   * RFC 9116 `security.txt`. Disabled unless the app sets `contact` — this
   * package never invents a reporting address. `expires` is build time plus
   * `expiresDays` (default 365, max 365).
   */
  securityTxt?: NardukSecurityTxtOptions | false
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

function readDeploymentTarget(options: NardukSeoModuleOptions): string {
  // An explicit variable wins exactly as before, including a value that is not
  // one of the three known targets.
  const explicit = readTrimmedEnv([...DEPLOYMENT_TARGET_ENV_KEYS]).toLowerCase()
  if (explicit) return explicit

  // narduk-libs#999: with no explicit variable, a Workers Builds (or Pages)
  // branch still says what this build is, so apps no longer need a nuxt.config
  // write-back of NARDUK_DEPLOY_TARGET. Only the branch result is used: a
  // local build with no branch keeps today's unset target.
  const productionBranch = options.productionBranch?.trim() || undefined
  const resolved = resolveBuildDeploymentTarget(process.env, { productionBranch })
  return resolved.source === 'branch' ? resolved.target : ''
}

function isNonProductionDeployment(options: NardukSeoModuleOptions): boolean {
  const deploymentTarget = readDeploymentTarget(options)

  return nonProductionDeploymentTargets.has(deploymentTarget)
}

function shouldForceNonProductionNoindex(options: NardukSeoModuleOptions): boolean {
  if (options.indexNonProduction || readBooleanEnv('NARDUK_SEO_INDEX_NON_PRODUCTION')) {
    return false
  }

  return isNonProductionDeployment(options)
}

function shouldEnableHostAwareIndexing(options: NardukSeoModuleOptions): boolean {
  if (!(options.hostAwareIndexing || readBooleanEnv('NARDUK_SEO_HOST_AWARE_INDEXING'))) {
    return false
  }

  return readDeploymentTarget(options) === 'production'
}

function applyNonProductionSeoSafety(
  nuxtOptions: MutableNuxtOptionsRecord,
  options: NardukSeoModuleOptions,
): void {
  const deploymentTarget = readDeploymentTarget(options)
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

const NETWORK_FOOTER_COMPONENT = 'LayerNetworkFooter'
const NETWORK_FOOTER_FILE = 'shared/LayerNetworkFooter.vue'

/** Adds the network row to narduk-core's footer extension list, once. */
interface ResolvedOgImageOptions {
  enabled?: boolean
  security?: { secret?: unknown }
  zeroRuntime?: boolean
}

function applyOgImageSigningSecret(ogImage: ResolvedOgImageOptions): string {
  const secret = resolveOgImageSigningSecret(ogImage.security?.secret)
  if (ogImage.security) {
    if (secret) {
      ogImage.security.secret = secret
    } else {
      delete ogImage.security.secret
    }
  }
  return secret
}

function resolveOgImageModuleState(input: {
  incomingOgImage: ResolvedOgImageOptions
  ogImage: ResolvedOgImageOptions
  packagePresent: boolean
  seoModule: boolean
}): { moduleAvailable: boolean; runtimeAvailable: boolean } {
  const moduleRequested = input.seoModule && isNuxtOgImageModuleRequested(input.ogImage)
  const runtimeRequested = input.seoModule && isRuntimeOgImageGenerationEnabled(input.ogImage)
  if (moduleRequested && !input.packagePresent) {
    input.ogImage.enabled = false
    // The generated static-card app never sets `ogImage.enabled`. Our defu
    // default of `true` must not warn -- release-packages treats Nuxt
    // `[warn]` as a typecheck failure (narduk-libs#170).
    if (isRuntimeOgImageGenerationExplicitlyRequested(input.incomingOgImage)) {
      useLogger(PACKAGE_NAME).warn(MISSING_NUXT_OG_IMAGE_MESSAGE)
    }
  }
  return {
    moduleAvailable: moduleRequested && input.packagePresent,
    runtimeAvailable: runtimeRequested && input.packagePresent,
  }
}

async function installSeoUtilityModules(input: {
  defineOgImageStub: string
  ogImageModuleAvailable: boolean
  seoModule: boolean
}): Promise<void> {
  if (input.seoModule) {
    await installModule('nuxt-site-config')
    await installModule('@nuxtjs/robots')
    await installModule('@nuxtjs/sitemap')
    await installModule('nuxt-link-checker')
    if (input.ogImageModuleAvailable) {
      await installModule('nuxt-og-image')
    }
    await installModule('nuxt-schema-org')
    await installModule('nuxt-seo-utils')
  }
  if (!input.ogImageModuleAvailable) {
    addImports({
      name: 'defineOgImage',
      from: input.defineOgImageStub,
    })
  }
}

function appendFooterAfterComponent(options: { appConfig?: Record<string, unknown> }): void {
  const appConfig = (options.appConfig ??= {})
  const nardukCore = (appConfig.nardukCore ??= {}) as { footer?: { after?: unknown } }
  const footer = (nardukCore.footer ??= {})
  const after = Array.isArray(footer.after) ? footer.after : []
  footer.after = after.includes(NETWORK_FOOTER_COMPONENT)
    ? after
    : [...after, NETWORK_FOOTER_COMPONENT]
}

export default defineNuxtModule<NardukSeoModuleOptions>({
  meta: {
    name: PACKAGE_NAME,
    configKey: 'nardukSeo',
    compatibility: { nuxt: '>=4.0.0' },
  },
  defaults: {
    aiCrawlers: 'allow',
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
    const securityTxtBody = resolveSecurityTxtBody(options.securityTxt)

    nuxtOptions.runtimeConfig = defu(nuxtOptions.runtimeConfig, {
      nardukSeoSecurityTxt: securityTxtBody,
      public: {
        nardukSeoDefaultImage: options.defaultOgImage ?? null,
        nardukNetworkDirectoryUrl,
        nardukSeoHostAwareIndexing: hostAwareIndexing,
        nardukSeoOgImageModule: true,
        ogImagePreviewLab: process.env.NUXT_PUBLIC_OG_IMAGE_PREVIEW === 'true',
        publicCatalogBaseUrl,
        // Deprecated and unread since narduk-libs#349; kept so existing
        // NUXT_PUBLIC_TWITTER_SITE deployments keep booting unchanged.
        twitterSite: process.env.NUXT_PUBLIC_TWITTER_SITE || '',
        seoSearchActionUrlTemplate: process.env.NUXT_PUBLIC_SEO_SEARCH_ACTION_URL_TEMPLATE || '',
      },
    })
    // narduk-libs#349: nuxt-seo-utils' InferSeoMetaPlugin pushes a low-priority
    // `twitter:card` into every head by default, and Unhead 3's ValidatePlugin
    // reports every `twitter:*` name as deprecated. `automaticTwitterTags: false`
    // makes seo-utils emit its sentinel card and then strip it, leaving the
    // Open Graph inference intact. It is also the fallback nuxt-og-image reads
    // when `ogImage.includeTwitter` is unset, but that is set explicitly below.
    nuxtOptions.seo = defu((nuxtOptions.seo ?? {}) as Record<string, unknown>, {
      automaticTwitterTags: false,
    })
    const ogImageSecret = readTrimmedEnv(['NUXT_OG_IMAGE_SECRET'])
    const incomingOgImage = {
      ...((nuxtOptions.ogImage ?? {}) as ResolvedOgImageOptions),
    }
    nuxtOptions.ogImage = defu((nuxtOptions.ogImage ?? {}) as Record<string, unknown>, {
      enabled: true,
      // narduk-libs#349: without this, every `defineOgImage` route also emits
      // `twitter:card`, `twitter:image`, `twitter:image:src` and the
      // `twitter:image:*` dimensions. The `og:image*` tags are unaffected.
      includeTwitter: false,
      security: {
        ...(ogImageSecret ? { secret: ogImageSecret } : {}),
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
    const resolvedOgImage = nuxtOptions.ogImage as ResolvedOgImageOptions
    const resolvedOgImageSecret = applyOgImageSigningSecret(resolvedOgImage)
    const nuxtBuildFlags = nuxt.options as { _prepare?: boolean; dev?: boolean }
    // narduk-libs#170: nuxt-og-image is an optional peer. A consumer that
    // omits it (static defaultOgImage only) must not inherit the package.
    // Skip installModule instead of failing the build.
    const { moduleAvailable: ogImageModuleAvailable, runtimeAvailable: runtimeOgAvailable } =
      resolveOgImageModuleState({
        incomingOgImage,
        ogImage: resolvedOgImage,
        packagePresent: canResolveNuxtOgImage(),
        seoModule: Boolean(options.seoModule),
      })
    const publicRuntimeConfig = nuxtOptions.runtimeConfig.public as Record<string, unknown>
    publicRuntimeConfig.nardukSeoOgImageModule = ogImageModuleAvailable
    assertOgImageSigningSecretForBuild({
      isDev: Boolean(nuxtBuildFlags.dev),
      isPrepare: Boolean(nuxtBuildFlags._prepare),
      runtimeGenerationEnabled: runtimeOgAvailable,
      secret: resolvedOgImageSecret,
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
      applyNonProductionSeoSafety(nuxtOptions, options)
    } else {
      nuxtOptions.robots = mergeAiCrawlerRobotsGroups(
        (nuxtOptions.robots ?? {}) as Record<string, unknown>,
        options.aiCrawlers,
      )
    }
    if (hostAwareIndexing) {
      addPlugin(resolver.resolve('../app/plugins/hostAwareIndexing'))
    }

    await installSeoUtilityModules({
      defineOgImageStub: resolver.resolve('../shared/defineOgImageStub'),
      ogImageModuleAvailable,
      seoModule: Boolean(options.seoModule),
    })

    if (options.app) {
      if (options.defaultOgImage) addPlugin(resolver.resolve('../app/plugins/defaultSocialImage'))
      addImportsDir(resolver.resolve('../app/composables'))
      addImportsDir(resolver.resolve('../app/utils'))
      addComponentsDir({
        path: resolver.resolve('../app/components'),
        pathPrefix: false,
        ignore: [NETWORK_FOOTER_FILE],
      })
      // narduk-core's LayerAppFooter renders the global components listed in
      // appConfig.nardukCore.footer.after below its content (narduk-libs#743),
      // so the network row needs no copy of the footer.
      addComponent({
        name: NETWORK_FOOTER_COMPONENT,
        filePath: resolver.resolve(`../app/components/${NETWORK_FOOTER_FILE}`),
        global: true,
      })
      appendFooterAfterComponent(nuxt.options as { appConfig?: Record<string, unknown> })
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

    if (securityTxtBody) {
      const securityTxtHandler = resolver.resolve('../server/handlers/securityTxt.get')
      addServerHandler({
        handler: securityTxtHandler,
        method: 'get',
        route: SECURITY_TXT_WELL_KNOWN_PATH,
      })
      addServerHandler({
        handler: securityTxtHandler,
        method: 'get',
        route: SECURITY_TXT_LEGACY_PATH,
      })
    }

    nuxtOptions.future = defu((nuxtOptions.future ?? {}) as Record<string, unknown>, {
      compatibilityVersion: 4,
    })
    nuxtOptions.typescript = defu((nuxtOptions.typescript ?? {}) as Record<string, unknown>, {
      tsConfig: {
        include: ['../components/**/*.vue'],
      },
    })

    // narduk-libs#170: `/_og/**` is deliberately left prerenderable. This layer
    // used to pin `{ prerender: false }` here -- carried unexplained from the
    // initial import (d82f1eb2) -- which contradicted `nuxt-og-image`'s own
    // behaviour: while a page is prerendered the module emits an *unsigned*
    // `/_og/s/...` URL and expects the crawler to write that image out as a
    // static file. Blocking the prerender left the unsigned URL to be served at
    // runtime, where the handler 403s it as soon as a signing secret is
    // configured -- which every deployed estate build requires. Removing the
    // pin lets the file actually be produced. Do not restore the rule without
    // recording why; its missing rationale is how the contradiction survived to
    // a production 403. tests/og-image-prerender-signing.test.ts pins the
    // upstream mechanism this depends on.
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
