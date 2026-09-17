import { defineNuxtPlugin, nextTick, useRouter, useRuntimeConfig } from '#imports'

import {
  isInternalAnalyticsTraffic,
  isLocalAnalyticsHost,
  normalizeAnalyticsLoadStrategy,
  resolveAnalyticsEnvironment,
  runWithAnalyticsLoadStrategy,
} from '../utils/analyticsLoadStrategy'
import { createWebVitalsBeforeSend, installPostHogWebVitalsCallbacks } from '../utils/webVitals'

import type {
  AnalyticsDeploymentTarget,
  AnalyticsLoadStrategy,
} from '../utils/analyticsLoadStrategy'
import type { PostHogExtensionsHost } from '../utils/webVitals'
import type { PostHog, Properties } from 'posthog-js'

type LegacyNuxtWindow = Window & { $nuxt?: { $posthog?: PostHog } }
type PostHogExtensionsWindow = Window & PostHogExtensionsHost

export default defineNuxtPlugin<{ posthog?: PostHog }>({
  name: 'posthog',
  dependsOn: ['runtime-public'],
  setup(nuxtApp) {
    const runtimeConfig = useRuntimeConfig()
    const posthogApiKey = runtimeConfig.public.posthogPublicKey
    const posthogHost = runtimeConfig.public.posthogHost
    const appName = runtimeConfig.public.appName as string
    const previewSafeMode = runtimeConfig.public.previewSafeMode === true
    const strategy: AnalyticsLoadStrategy = normalizeAnalyticsLoadStrategy(
      runtimeConfig.public.analyticsLoadStrategy,
    )
    const isLocalhost = isLocalAnalyticsHost(window.location.hostname)
    const sessionReplayEnabled = runtimeConfig.public.posthogSessionReplayEnabled === true
    const webVitalsEnabled = runtimeConfig.public.posthogWebVitalsEnabled === true
    const webVitalsAttributionEnabled =
      webVitalsEnabled && runtimeConfig.public.posthogWebVitalsAttributionEnabled === true

    if (
      !posthogApiKey ||
      previewSafeMode ||
      import.meta.server ||
      isLocalhost ||
      strategy === 'off'
    ) {
      return {
        provide: {
          posthog: undefined,
        },
      }
    }

    const router = useRouter()

    runWithAnalyticsLoadStrategy(strategy, () => {
      void initializePosthog()
    })

    async function initializePosthog() {
      const { posthog } = await import('posthog-js')

      // PostHog's `$web_vitals` autocapture reaches for an external
      // `web-vitals.js` asset unless the callbacks are already published, and
      // `disable_external_dependency_loading` below blocks that fetch. Publish
      // them from the pinned package first, so `posthog.init` starts the
      // extension straight away. See `../utils/webVitals`.
      if (webVitalsEnabled) {
        const webVitals = webVitalsAttributionEnabled
          ? await import('web-vitals/attribution')
          : await import('web-vitals')

        installPostHogWebVitalsCallbacks(window as PostHogExtensionsWindow, {
          onCLS: webVitals.onCLS,
          onFCP: webVitals.onFCP,
          onINP: webVitals.onINP,
          onLCP: webVitals.onLCP,
        })
      }

      const posthogClient = posthog.init(posthogApiKey, {
        api_host: posthogHost === '' ? 'https://us.i.posthog.com' : posthogHost,
        capture_pageview: false, // We'll handle this manually for Nuxt SPA navigation
        capture_pageleave: true,

        disable_session_recording: !sessionReplayEnabled,
        disable_surveys: runtimeConfig.public.posthogSurveysEnabled !== true,
        disable_surveys_automatic_display: runtimeConfig.public.posthogSurveysEnabled !== true,
        capture_dead_clicks: runtimeConfig.public.posthogDeadClicksEnabled === true,
        disable_external_dependency_loading:
          !sessionReplayEnabled &&
          runtimeConfig.public.posthogExternalDependencyLoadingEnabled !== true,
        advanced_disable_flags: false,
        advanced_disable_feature_flags: runtimeConfig.public.posthogFeatureFlagsEnabled !== true,

        // Use XHR instead of sendBeacon on page unload (avoids 64KB cap entirely)
        transport: 'XHR',

        // Pinned explicitly in both directions: PostHog also accepts a
        // server-side `capturePerformance` remote config, and an app that has
        // not opted in must not start collecting vitals because a project
        // setting changed. `network_timing` stays unset, exactly as before.
        capture_performance: {
          web_vitals: webVitalsEnabled,
          web_vitals_attribution: webVitalsAttributionEnabled,
        },
        ...(webVitalsEnabled
          ? {
              before_send: createWebVitalsBeforeSend({
                buildVersion: runtimeConfig.public.buildVersion,
                navigator: typeof navigator === 'undefined' ? undefined : navigator,
                resolveRoute: (path: string) => router.resolve(path),
              }),
            }
          : {}),

        loaded: (ph) => {
          if (import.meta.dev) ph.debug()
        },
      } as Parameters<typeof posthog.init>[1])

      nuxtApp.provide('posthog', posthogClient)

      const win = window as LegacyNuxtWindow
      win.$nuxt ??= {}
      win.$nuxt.$posthog = posthogClient

      // ---------------------------------------------------------------------------
      // Super properties — registered on every event for easy filtering.
      //
      // PostHog dashboard setup:
      //   Project Settings → "Filter out internal and test users" →
      //     • is_owner — is set        (owner traffic)
      //     • is_internal_user — is set (preview deploy traffic)
      //     • environment — does not equal "production"  (optional)
      //
      // To tag yourself as owner, POST /api/owner-tag with OWNER_TAG_SECRET.
      // ---------------------------------------------------------------------------
      const superProperties: Properties = {
        app: appName,
      }

      const hostname = window.location.hostname
      const deploymentTarget = runtimeConfig.public.deploymentTarget as AnalyticsDeploymentTarget

      // Tag internal/non-production traffic (deployment target first, preview
      // hostname as a fallback for unset/misconfigured targets).
      if (isInternalAnalyticsTraffic(hostname, deploymentTarget)) {
        superProperties.is_internal_user = true
      }

      // Tag owner traffic. `narduk_owner=true` is the unsigned, client-readable
      // flag from /api/owner-tag — not the httpOnly HMAC proof used by bootstrap.
      const isOwner = document.cookie.includes('narduk_owner=true')
      superProperties.is_owner = isOwner

      // Correlate traffic with deploy versions
      const appVersion = runtimeConfig.public.appVersion
      if (appVersion) {
        superProperties.app_version = appVersion
      }

      superProperties.environment = resolveAnalyticsEnvironment(hostname, deploymentTarget)

      posthog.register(superProperties)

      // Nuxt may report the hydrated route through afterEach before the initial
      // next tick. Track the pathname once across both orderings, ignore failed
      // navigations, and leave query/hash-only state changes out of pageview totals.
      let lastTrackedPath: string | undefined
      const trackPageview = (path: string) => {
        if (path === lastTrackedPath) return

        lastTrackedPath = path
        posthog.capture('$pageview', {
          $current_url: window.location.origin + path,
        })
      }

      void nextTick(() => trackPageview(router.currentRoute.value.path))
      router.afterEach((to, _from, failure) => {
        if (failure) return
        void nextTick(() => trackPageview(to.path))
      })
    }

    return
  },
})
