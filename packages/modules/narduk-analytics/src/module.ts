import { fileURLToPath } from 'node:url'

import {
  addComponentsDir,
  addImportsDir,
  addPlugin,
  addServerScanDir,
  createResolver,
  defineNuxtModule,
  hasNuxtModule,
  installModule,
} from '@nuxt/kit'
import { defu } from 'defu'

const PACKAGE_NAME = '@narduk-enterprises/narduk-analytics'
const CORE_PACKAGE_NAME = '@narduk-enterprises/narduk-core'

interface MutableNuxtOptionsRecord {
  alias: Record<string, string>
  build: {
    transpile: string[]
  }
  nitro?: Record<string, unknown>
  runtimeConfig: Record<string, unknown>
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

export interface NardukAnalyticsModuleOptions {
  /**
   * The `/api/admin/**` GA, Search Console, Indexing and PostHog routes. They
   * authorise with narduk-core's `requireAdmin`, which resolves the admin
   * through the auth session and the app's database. Omitted, they register
   * unless the app declares it has no database (`nardukCore.databaseBackend:
   * 'none'` or `NUXT_DATABASE_BACKEND=none`), where every one of them could
   * only ever answer 401 (narduk-libs#524). `true` or `false` decides outright.
   */
  admin?: boolean
  app?: boolean
  /**
   * `'strict'` for an app whose pages hold private records: PostHog runs with
   * no autocapture, heatmaps, dead clicks, session replay, surveys or remote
   * extensions, and every URL, pathname, title and exception message is
   * reduced to its route pattern before it leaves the browser; GA4 receives
   * route patterns only, with Google signals and ad personalisation off.
   * Decided here, at build time, and written to
   * `runtimeConfig.public.analyticsPrivacy`, which the runtime-public overlay
   * does not carry — a Worker variable cannot turn it off. Default `'standard'`.
   */
  privacy?: 'standard' | 'strict'
  server?: boolean
}

function pushUnique<T>(items: T[], item: T): void {
  if (!items.includes(item)) {
    items.push(item)
  }
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

function readBooleanEnv(name: string, defaultValue = false): boolean {
  const value = process.env[name]?.trim().toLowerCase()
  if (!value) return defaultValue
  if (['1', 'true', 'yes', 'on'].includes(value)) return true
  if (['0', 'false', 'no', 'off'].includes(value)) return false
  return defaultValue
}

function readAnalyticsLoadStrategy() {
  const value = (
    process.env.NUXT_PUBLIC_ANALYTICS_LOAD_STRATEGY ||
    process.env.ANALYTICS_LOAD_STRATEGY ||
    ''
  )
    .trim()
    .toLowerCase()
  return ['immediate', 'idle', 'interaction', 'off'].includes(value) ? value : 'idle'
}

/**
 * Analytics has a hard runtime dependency on narduk-core: the client plugins
 * (`dependsOn: ['runtime-public']`) only receive `posthogPublicKey`,
 * `gaMeasurementId`, and `deploymentTarget` from narduk-core's
 * runtime-public overlay. An app that lists `narduk-analytics` without
 * `narduk-core` gets no build error but silently loses all analytics.
 *
 * `hasNuxtModule` checks both already-installed modules and the app's
 * configured `modules` array (regardless of install order), so this only
 * installs narduk-core when it is genuinely absent — it does not
 * double-install for the documented setup where an app already lists it.
 */
async function ensureNardukCoreInstalled(nuxt: Parameters<typeof hasNuxtModule>[1]): Promise<void> {
  const alreadyPresent =
    hasNuxtModule(CORE_PACKAGE_NAME, nuxt) || hasNuxtModule(`${CORE_PACKAGE_NAME}/nuxt`, nuxt)

  if (alreadyPresent) return

  await installModule(CORE_PACKAGE_NAME)
}

/**
 * Whether the app registered narduk-core with `app: false`, through the
 * `nardukCore` config key or an inline `[module, options]` tuple. Registration
 * alone is not enough: narduk-core registers the runtime-public overlay the
 * analytics client plugins read only when `app` is on, so `app: false` passes
 * {@link ensureNardukCoreInstalled} and still loses every analytics value
 * (narduk-libs#663). narduk-core defaults `app` to true, so an absent value is
 * resolved, not unknown.
 */
function nardukCoreAppDisabled(nuxtOptions: {
  modules?: readonly unknown[]
  nardukCore?: unknown
}): boolean {
  const configured = nuxtOptions.nardukCore as { app?: unknown } | undefined
  if (configured?.app === false) return true
  return (nuxtOptions.modules ?? []).some(
    (entry) =>
      Array.isArray(entry) &&
      (entry[0] === CORE_PACKAGE_NAME || entry[0] === `${CORE_PACKAGE_NAME}/nuxt`) &&
      (entry[1] as { app?: unknown } | undefined)?.app === false,
  )
}

/**
 * Whether the app declares it has no database, read from the same sources
 * narduk-core resolves `databaseBackend` from: the `nardukCore` config key, an
 * inline `[module, options]` tuple, then `NUXT_DATABASE_BACKEND`. Read here
 * rather than from narduk-core's resolved runtime config, because a module
 * listed before narduk-core runs before narduk-core has written it.
 */
function declaresNoDatabase(
  nuxtOptions: { modules?: readonly unknown[]; nardukCore?: unknown },
  env: Record<string, string | undefined> = process.env,
): boolean {
  const configured = (nuxtOptions.nardukCore as { databaseBackend?: unknown } | undefined)
    ?.databaseBackend
  const inline = (nuxtOptions.modules ?? []).find(
    (entry): entry is [unknown, { databaseBackend?: unknown } | undefined] =>
      Array.isArray(entry) &&
      (entry[0] === CORE_PACKAGE_NAME || entry[0] === `${CORE_PACKAGE_NAME}/nuxt`),
  )?.[1]?.databaseBackend
  const declared = configured ?? inline ?? env.NUXT_DATABASE_BACKEND
  return declared === 'none'
}

export default defineNuxtModule<NardukAnalyticsModuleOptions>({
  meta: {
    name: PACKAGE_NAME,
    configKey: 'nardukAnalytics',
    compatibility: { nuxt: '>=4.0.0' },
  },
  defaults: {
    app: true,
    privacy: 'standard',
    server: true,
  },
  async setup(options, nuxt) {
    const resolver = createResolver(import.meta.url)
    const nuxtOptions = nuxt.options as unknown as MutableNuxtOptionsRecord
    const analyticsRuntimeConfigTypesPath = fileURLToPath(
      new URL('../app/types/runtime-config.d.ts', import.meta.url),
    )

    await ensureNardukCoreInstalled(nuxt)
    if (
      options.app &&
      nardukCoreAppDisabled(nuxt.options as unknown as Parameters<typeof nardukCoreAppDisabled>[0])
    ) {
      throw new Error(
        `${PACKAGE_NAME}: narduk-core is registered with app: false, so its runtime-public ` +
          'overlay never registers and the analytics client plugins would run with no PostHog ' +
          'key, GA id or deployment target: no analytics, and no other signal. Turn ' +
          'nardukCore.app back on, or set nardukAnalytics.app: false to keep only the server ' +
          'half (narduk-libs#663).',
      )
    }

    pushUnique(nuxtOptions.build.transpile, PACKAGE_NAME)
    addNitroInlinePackage(nuxtOptions, PACKAGE_NAME)
    nuxtOptions.alias = {
      ...nuxtOptions.alias,
      '#narduk-analytics-server': resolver.resolve('../server'),
    }

    if (options.app) {
      addImportsDir(resolver.resolve('../app/composables'))
      addImportsDir(resolver.resolve('../app/utils'))
      addComponentsDir({
        path: resolver.resolve('../app/components'),
        pathPrefix: false,
      })
      addPlugin(resolver.resolve('../app/plugins/00-analytics-head.client'))
      addPlugin(resolver.resolve('../app/plugins/gtag.client'))
      addPlugin(resolver.resolve('../app/plugins/posthog.client'))
      addPlugin(resolver.resolve('../app/plugins/posthog-exceptions.client'))
    }

    if (options.server) {
      addServerScanDir(resolver.resolve('../server'))
      const admin =
        options.admin ??
        !declaresNoDatabase(nuxt.options as unknown as Parameters<typeof declaresNoDatabase>[0])
      if (admin) addServerScanDir(resolver.resolve('../server/admin'))
    }

    nuxtOptions.runtimeConfig = defu(nuxtOptions.runtimeConfig, {
      ownerTagSecret: process.env.OWNER_TAG_SECRET || '',
      posthogOwnerDistinctId: process.env.POSTHOG_OWNER_DISTINCT_ID || '',
      indexNowKey: process.env.NUXT_INDEXNOW_KEY || process.env.INDEXNOW_KEY || '',
      public: {
        analyticsLoadStrategy: readAnalyticsLoadStrategy(),
        analyticsPrivacy: 'standard',
        gaMeasurementId: process.env.GA_MEASUREMENT_ID || '',
        posthogHost: process.env.POSTHOG_HOST || 'https://us.i.posthog.com',
        posthogDeadClicksEnabled: readBooleanEnv('POSTHOG_DEAD_CLICKS_ENABLED'),
        posthogExternalDependencyLoadingEnabled: readBooleanEnv(
          'POSTHOG_EXTERNAL_DEPENDENCY_LOADING_ENABLED',
        ),
        posthogFeatureFlagsEnabled: readBooleanEnv('POSTHOG_FEATURE_FLAGS_ENABLED'),
        posthogSessionReplayEnabled: readBooleanEnv('POSTHOG_SESSION_REPLAY_ENABLED'),
        posthogSurveysEnabled: readBooleanEnv('POSTHOG_SURVEYS_ENABLED'),
        posthogWebVitalsEnabled: readBooleanEnv('POSTHOG_WEB_VITALS_ENABLED'),
        posthogWebVitalsAttributionEnabled: readBooleanEnv(
          'POSTHOG_WEB_VITALS_ATTRIBUTION_ENABLED',
        ),
        indexNowKey: process.env.NUXT_PUBLIC_INDEXNOW_KEY || '',
      },
    })

    // Strict wins from either source: the module option overrides an app's own
    // `runtimeConfig.public.analyticsPrivacy`, and never the other way round.
    if (options.privacy === 'strict') {
      ;(nuxtOptions.runtimeConfig.public as Record<string, unknown>).analyticsPrivacy = 'strict'
    }

    const registerAnalyticsTypes = (prepareOptions: TypePrepareOptions) => {
      registerTypeReference(prepareOptions, analyticsRuntimeConfigTypesPath)
    }

    nuxt.hook('nitro:prepare:types', registerAnalyticsTypes)
    nuxt.hook('prepare:types', registerAnalyticsTypes)
  },
})
