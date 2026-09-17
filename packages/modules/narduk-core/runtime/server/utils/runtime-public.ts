import { getRequestURL } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'

import {
  readRuntimeBoolean,
  readRuntimeString,
  readRuntimeStringFromKeys,
  readRuntimeStringList,
  trimRuntimeString,
} from './runtime-env'
import { normalizeSupabaseBaseUrl } from './runtime-url'

import type { H3Event } from 'h3'

type RuntimeConfigLike = ReturnType<typeof useRuntimeConfig>

export interface RuntimePublicOverlay {
  allowGeolocation: boolean
  analyticsLoadStrategy: 'immediate' | 'idle' | 'interaction' | 'off'
  appBackendPreset?: 'default' | 'managed-supabase'
  appName: string
  appUrl: string
  authAuthorityUrl?: string
  authBackend?: 'local' | 'supabase'
  authEnforceCanonicalHost?: boolean
  authProviders?: string[]
  authPublicSignup?: boolean
  authRequireMfa?: boolean
  authTurnstileSiteKey?: string
  deploymentTarget: 'production' | 'staging' | 'preview'
  enforceCanonicalHost?: boolean
  gaMeasurementId: string
  posthogDeadClicksEnabled: boolean
  posthogExternalDependencyLoadingEnabled: boolean
  posthogFeatureFlagsEnabled: boolean
  posthogHost: string
  posthogPublicKey: string
  posthogSessionReplayEnabled: boolean
  posthogSurveysEnabled: boolean
  previewSafeMode: boolean
  publicCatalogBaseUrl: string
  seoSearchActionUrlTemplate: string
  siteUrl: string
  supabasePublishableKey?: string
  supabaseUrl?: string
  twitterSite: string
}

const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com'
const DEFAULT_PUBLIC_CATALOG_BASE_URL = 'https://catalog.nard.uk'

function readPublic(config: RuntimeConfigLike | undefined, key: string): unknown {
  const pub = config?.public as Record<string, unknown> | undefined
  return pub?.[key]
}

function normalizeUrl(value: string): string {
  return value.replace(/\/+$/, '')
}

function normalizeDeploymentTarget(value: string): RuntimePublicOverlay['deploymentTarget'] {
  return value === 'staging' || value === 'preview' ? value : 'production'
}

function normalizeAnalyticsLoadStrategy(
  value: string,
): RuntimePublicOverlay['analyticsLoadStrategy'] {
  const normalized = value.trim().toLowerCase()
  return normalized === 'immediate' || normalized === 'interaction' || normalized === 'off'
    ? normalized
    : 'idle'
}

export function resolveRuntimePublicOverlay(event: H3Event): RuntimePublicOverlay {
  const config = useRuntimeConfig(event)
  const configRecord = config as Record<string, unknown>
  const publicAppUrl = trimRuntimeString(readPublic(config, 'appUrl'))
  const appUrl = readRuntimeString(event, 'SITE_URL', { config, fallback: publicAppUrl })
  const configuredAuthBackend = readRuntimeString(event, 'AUTH_BACKEND', {
    config,
    fallback: readPublic(config, 'authBackend') ?? configRecord.authBackend,
  })
  const configuredAppBackendPreset = readRuntimeString(event, 'APP_BACKEND_PRESET', {
    config,
    fallback: readPublic(config, 'appBackendPreset') ?? configRecord.appBackendPreset,
  })
  const authAuthorityUrl = readRuntimeString(event, 'AUTH_AUTHORITY_URL', {
    config,
    fallback: configRecord.authAuthorityUrl,
  })
  const bakedSupabaseUrl = trimRuntimeString(configRecord.supabaseUrl)
  const supabaseUrl = normalizeSupabaseBaseUrl(
    readRuntimeStringFromKeys(event, ['SUPABASE_URL', 'AUTH_AUTHORITY_URL'], {
      config,
      fallbacks: [bakedSupabaseUrl, authAuthorityUrl],
    }),
  )
  const supabasePublishableKey = readRuntimeStringFromKeys(
    event,
    ['AUTH_ANON_KEY', 'SUPABASE_AUTH_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_ANON_KEY'],
    {
      config,
      fallbacks: [configRecord.authAnonKey, configRecord.supabasePublishableKey],
    },
  )
  const hasSupabaseAuth = Boolean(supabaseUrl && supabasePublishableKey)
  const forceLocal = readRuntimeBoolean(event, 'AUTH_FORCE_LOCAL', { config })
  const authBackend =
    configuredAuthBackend === 'supabase'
      ? 'supabase'
      : hasSupabaseAuth && !(configuredAuthBackend === 'local' && forceLocal)
        ? 'supabase'
        : 'local'
  const appBackendPreset =
    configuredAppBackendPreset === 'default'
      ? 'default'
      : configuredAppBackendPreset === 'managed-supabase' || hasSupabaseAuth
        ? 'managed-supabase'
        : 'default'
  const authProviders = readRuntimeStringList(event, 'AUTH_PROVIDERS', {
    config,
    fallbackList: readPublic(config, 'authProviders') as unknown[],
  })
  const configuredDeploymentTarget = normalizeDeploymentTarget(
    readRuntimeString(event, 'NARDUK_DEPLOY_TARGET', {
      config,
      fallback: readPublic(config, 'deploymentTarget'),
    }),
  )
  const requestHostname = getRequestURL(event, { xForwardedHost: false }).hostname.toLowerCase()
  let canonicalHostname = ''
  try {
    canonicalHostname = new URL(appUrl).hostname.toLowerCase()
  } catch {
    // An unset canonical URL must not enable collection on a preview alias.
  }
  const previewHostname =
    requestHostname !== canonicalHostname &&
    (requestHostname.endsWith('.workers.dev') || requestHostname.endsWith('.pages.dev'))
  // One immutable production version is first exercised through a preview
  // alias. Suppression follows the request host without baking preview-only
  // bindings into the version that will later receive production traffic.
  const deploymentTarget = previewHostname ? 'preview' : configuredDeploymentTarget
  const previewSafeMode =
    deploymentTarget !== 'production' ||
    readRuntimeBoolean(event, 'NARDUK_PREVIEW_SAFE_MODE', {
      config,
      fallback: readPublic(config, 'previewSafeMode'),
    })

  return {
    appUrl,
    siteUrl: appUrl,
    appName: trimRuntimeString(readPublic(config, 'appName')),
    deploymentTarget,
    previewSafeMode,
    analyticsLoadStrategy: previewSafeMode
      ? 'off'
      : normalizeAnalyticsLoadStrategy(
          readRuntimeStringFromKeys(
            event,
            ['NUXT_PUBLIC_ANALYTICS_LOAD_STRATEGY', 'ANALYTICS_LOAD_STRATEGY'],
            {
              config,
              fallback: readPublic(config, 'analyticsLoadStrategy'),
            },
          ),
        ),
    posthogPublicKey: previewSafeMode
      ? ''
      : readRuntimeStringFromKeys(event, ['POSTHOG_PUBLIC_KEY', 'NUXT_PUBLIC_POSTHOG_PUBLIC_KEY'], {
          config,
          fallbacks: [readPublic(config, 'posthogPublicKey')],
        }),
    posthogHost:
      readRuntimeStringFromKeys(event, ['POSTHOG_HOST', 'NUXT_PUBLIC_POSTHOG_HOST'], {
        config,
        fallbacks: [readPublic(config, 'posthogHost')],
      }) || DEFAULT_POSTHOG_HOST,
    gaMeasurementId: previewSafeMode
      ? ''
      : readRuntimeStringFromKeys(event, ['GA_MEASUREMENT_ID', 'NUXT_PUBLIC_GA_MEASUREMENT_ID'], {
          config,
          fallbacks: [readPublic(config, 'gaMeasurementId')],
        }),
    allowGeolocation: readRuntimeBoolean(event, 'NUXT_PUBLIC_ALLOW_GEOLOCATION', {
      config,
      fallback: readPublic(config, 'allowGeolocation'),
    }),
    posthogDeadClicksEnabled: readRuntimeBoolean(event, 'POSTHOG_DEAD_CLICKS_ENABLED', {
      config,
      fallback: readPublic(config, 'posthogDeadClicksEnabled'),
    }),
    posthogExternalDependencyLoadingEnabled: readRuntimeBoolean(
      event,
      'POSTHOG_EXTERNAL_DEPENDENCY_LOADING_ENABLED',
      {
        config,
        fallback: readPublic(config, 'posthogExternalDependencyLoadingEnabled'),
      },
    ),
    posthogFeatureFlagsEnabled: readRuntimeBoolean(event, 'POSTHOG_FEATURE_FLAGS_ENABLED', {
      config,
      fallback: readPublic(config, 'posthogFeatureFlagsEnabled'),
    }),
    posthogSessionReplayEnabled:
      !previewSafeMode &&
      readRuntimeBoolean(event, 'POSTHOG_SESSION_REPLAY_ENABLED', {
        config,
        fallback: readPublic(config, 'posthogSessionReplayEnabled'),
      }),
    posthogSurveysEnabled: readRuntimeBoolean(event, 'POSTHOG_SURVEYS_ENABLED', {
      config,
      fallback: readPublic(config, 'posthogSurveysEnabled'),
    }),
    publicCatalogBaseUrl:
      normalizeUrl(
        readRuntimeString(event, 'PUBLIC_CATALOG_BASE_URL', {
          config,
          fallback: readPublic(config, 'publicCatalogBaseUrl'),
        }),
      ) || DEFAULT_PUBLIC_CATALOG_BASE_URL,
    twitterSite: readRuntimeString(event, 'NUXT_PUBLIC_TWITTER_SITE', {
      config,
      fallback: readPublic(config, 'twitterSite'),
    }),
    seoSearchActionUrlTemplate: readRuntimeString(
      event,
      'NUXT_PUBLIC_SEO_SEARCH_ACTION_URL_TEMPLATE',
      {
        config,
        fallback: readPublic(config, 'seoSearchActionUrlTemplate'),
      },
    ),
    authBackend,
    authProviders:
      authBackend === 'supabase'
        ? authProviders.length > 0
          ? authProviders
          : ['apple', 'email']
        : ['email'],
    authPublicSignup: readRuntimeBoolean(event, 'AUTH_PUBLIC_SIGNUP', {
      config,
      fallback: readPublic(config, 'authPublicSignup'),
      defaultValue: true,
    }),
    authRequireMfa: readRuntimeBoolean(event, 'AUTH_REQUIRE_MFA', {
      config,
      fallback: readPublic(config, 'authRequireMfa'),
    }),
    authTurnstileSiteKey: readRuntimeString(event, 'TURNSTILE_SITE_KEY', {
      config,
      fallback: readPublic(config, 'authTurnstileSiteKey'),
    }),
    enforceCanonicalHost: readRuntimeBoolean(event, 'ENFORCE_CANONICAL_HOST', {
      config,
      fallback: readPublic(config, 'enforceCanonicalHost'),
    }),
    authEnforceCanonicalHost: readRuntimeBoolean(event, 'AUTH_ENFORCE_CANONICAL_HOST', {
      config,
      fallback: readPublic(config, 'authEnforceCanonicalHost'),
    }),
    appBackendPreset,
    authAuthorityUrl,
    supabaseUrl,
    supabasePublishableKey,
  }
}

/**
 * Copy the request-time overlay onto `useRuntimeConfig(event).public`.
 *
 * Workers Builds does not export `wrangler.json` `vars` into `nuxt build`, so
 * baked `runtimeConfig.public` keys are often empty strings even when the
 * Worker already has the live bindings. Nuxt serializes that bake into
 * `__NUXT__` unless this overlay runs before SSR. `/api/runtime/public` and
 * the `00-runtime-public` Nitro plugin both use this so the HTML payload and
 * the JSON route stay on one contract.
 *
 * Apps should not read `wrangler.json` from `nuxt.config.ts` to paper over
 * the empty bake. Short Worker names (`GA_MEASUREMENT_ID`,
 * `POSTHOG_PUBLIC_KEY`) are enough; optional `NUXT_PUBLIC_*` aliases are
 * accepted for Nuxt's native env overlay.
 */
export function applyRuntimePublicOverlay(event: H3Event): RuntimePublicOverlay {
  const overlay = resolveRuntimePublicOverlay(event)
  const config = useRuntimeConfig(event) as { public?: Record<string, unknown> }
  config.public = Object.assign(config.public ?? {}, overlay)
  return overlay
}
