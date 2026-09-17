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
  app?: boolean
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

export default defineNuxtModule<NardukAnalyticsModuleOptions>({
  meta: {
    name: PACKAGE_NAME,
    configKey: 'nardukAnalytics',
    compatibility: { nuxt: '>=3.16.0' },
  },
  defaults: {
    app: true,
    server: true,
  },
  async setup(options, nuxt) {
    const resolver = createResolver(import.meta.url)
    const nuxtOptions = nuxt.options as unknown as MutableNuxtOptionsRecord
    const analyticsRuntimeConfigTypesPath = fileURLToPath(
      new URL('../app/types/runtime-config.d.ts', import.meta.url),
    )

    await ensureNardukCoreInstalled(nuxt)

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
    }

    if (options.server) {
      addServerScanDir(resolver.resolve('../server'))
    }

    nuxtOptions.runtimeConfig = defu(nuxtOptions.runtimeConfig, {
      ownerTagSecret: process.env.OWNER_TAG_SECRET || '',
      posthogOwnerDistinctId: process.env.POSTHOG_OWNER_DISTINCT_ID || '',
      indexNowKey: process.env.NUXT_INDEXNOW_KEY || process.env.INDEXNOW_KEY || '',
      public: {
        analyticsLoadStrategy: readAnalyticsLoadStrategy(),
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

    const registerAnalyticsTypes = (prepareOptions: TypePrepareOptions) => {
      registerTypeReference(prepareOptions, analyticsRuntimeConfigTypesPath)
    }

    nuxt.hook('nitro:prepare:types', registerAnalyticsTypes)
    nuxt.hook('prepare:types', registerAnalyticsTypes)
  },
})
