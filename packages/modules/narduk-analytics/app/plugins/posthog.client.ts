import { defineNuxtPlugin, nextTick, useRouter, useRuntimeConfig } from '#imports'

import { analyticsLandingAttribution } from '../utils/analyticsAttribution'
import { createAnalyticsContext } from '../utils/analyticsContext'
import { installAnalyticsEngagement } from '../utils/analyticsEngagementBrowser'
import {
  isLocalAnalyticsHost,
  normalizeAnalyticsLoadStrategy,
  runWithAnalyticsLoadStrategy,
} from '../utils/analyticsLoadStrategy'
import {
  composeBeforeSend,
  createStandardPrivacyBeforeSend,
  createStrictPrivacyBeforeSend,
  normalizeAnalyticsPrivacy,
  sanitizeStandardUrl,
  templatePath,
} from '../utils/analyticsPrivacy'
import { createAnalyticsTransport } from '../utils/analyticsTransport'
import { ANALYTICS_SCHEMA_VERSION } from '../utils/analyticsVersion'
import { createWebVitalsBeforeSend, installPostHogWebVitalsCallbacks } from '../utils/webVitals'

import type {
  AnalyticsDeploymentTarget,
  AnalyticsLoadStrategy,
} from '../utils/analyticsLoadStrategy'
import type { PostHogExtensionsHost } from '../utils/webVitals'
import type { PostHog } from 'posthog-js'

type LegacyNuxtWindow = Window & { $nuxt?: { $posthog?: PostHog } }
type PostHogExtensionsWindow = Window & PostHogExtensionsHost

export default defineNuxtPlugin({
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
    // Strict privacy is decided in nuxt.config (`nardukAnalytics.privacy`), not
    // by the runtime-public overlay, so a Worker variable cannot switch replay,
    // surveys or attribution back on for a private app. See the README.
    const strict = normalizeAnalyticsPrivacy(runtimeConfig.public.analyticsPrivacy) === 'strict'
    const sessionReplayEnabled =
      !strict && runtimeConfig.public.posthogSessionReplayEnabled === true
    const surveysEnabled = !strict && runtimeConfig.public.posthogSurveysEnabled === true
    const webVitalsEnabled = runtimeConfig.public.posthogWebVitalsEnabled === true
    // Attribution carries element selectors and resource URLs: never in strict.
    const webVitalsAttributionEnabled =
      !strict &&
      webVitalsEnabled &&
      runtimeConfig.public.posthogWebVitalsAttributionEnabled === true

    const enabled =
      Boolean(posthogApiKey) &&
      !previewSafeMode &&
      !import.meta.server &&
      !isLocalhost &&
      strategy !== 'off'
    const router = useRouter()
    const resolveRoute = (path: string) => router.resolve(path)
    const baseContext = createAnalyticsContext({
      appName,
      appId: runtimeConfig.public.analyticsAppId,
      surface: runtimeConfig.public.analyticsSurface,
      appVersion: runtimeConfig.public.appVersion,
      buildVersion: runtimeConfig.public.buildVersion,
      hostname: window.location.hostname,
      deploymentTarget: runtimeConfig.public.deploymentTarget as AnalyticsDeploymentTarget,
      owner: () =>
        document.cookie.split(';').some((cookie) => cookie.trim() === 'narduk_owner=true'),
      route: () => templatePath(router.currentRoute.value.path, resolveRoute),
    })
    const landing = enabled
      ? analyticsLandingAttribution(window.location.href, document.referrer, strict)
      : {}
    const context = () => ({ ...baseContext(), ...landing })
    const identityEnabled = runtimeConfig.public.analyticsIdentityEnabled === true
    const transport = createAnalyticsTransport({ enabled, context, resetOnAttach: identityEnabled })
    nuxtApp.provide('analytics', transport)

    if (!enabled) return { provide: { posthog: undefined } }

    let lastTrackedPath: string | undefined
    const engagement =
      runtimeConfig.public.analyticsEngagementEnabled === true
        ? installAnalyticsEngagement(transport, router, nuxtApp.vueApp)
        : undefined
    const trackPageview = (path: string) => {
      if (path === lastTrackedPath) return
      // Flush the previous visit before changing its route context.
      engagement?.navigate(path, { ...context(), route: templatePath(path, resolveRoute) })
      lastTrackedPath = path
      const pagePath = strict ? templatePath(path, resolveRoute) : path
      transport.capture(
        '$pageview',
        {
          $current_url: sanitizeStandardUrl(window.location.origin + pagePath),
        },
        { ...context(), route: templatePath(path, resolveRoute) },
      )
    }
    void nextTick(() => trackPageview(router.currentRoute.value.path))
    const removeRouteObserver = router.afterEach((to, _from, failure) => {
      if (failure) return
      void nextTick(() => trackPageview(to.path))
    })
    nuxtApp.vueApp?.onUnmount?.(() => {
      removeRouteObserver?.()
      transport.disable()
    })
    runWithAnalyticsLoadStrategy(strategy, () => {
      void initializePosthog().catch(() => {
        if (transport.status === 'pending') transport.fail()
      })
    })

    async function initializePosthog() {
      if (transport.status !== 'pending') return
      const { posthog } = await import('posthog-js')
      if (transport.status !== 'pending') return

      // PostHog's `$web_vitals` autocapture reaches for an external
      // `web-vitals.js` asset unless the callbacks are already published, and
      // `disable_external_dependency_loading` below blocks that fetch. Publish
      // them from the pinned package first, so `posthog.init` starts the
      // extension straight away. See `../utils/webVitals`.
      if (webVitalsEnabled) {
        const webVitals = webVitalsAttributionEnabled
          ? await import('web-vitals/attribution')
          : await import('web-vitals')
        if (transport.status !== 'pending') return

        installPostHogWebVitalsCallbacks(window as PostHogExtensionsWindow, {
          onCLS: webVitals.onCLS,
          onFCP: webVitals.onFCP,
          onINP: webVitals.onINP,
          onLCP: webVitals.onLCP,
        })
      }

      // Web vitals first: it reads the raw URL on each nested metric to find the
      // route. The strict scrub runs last, so nothing an earlier hook adds escapes.
      const beforeSend = composeBeforeSend(
        (result) =>
          transport.status === 'failed' ||
          transport.status === 'disabled' ||
          (identityEnabled && transport.status === 'pending')
            ? null
            : result
              ? {
                  ...result,
                  properties: {
                    ...context(),
                    ...result.properties,
                    analytics_schema_version: ANALYTICS_SCHEMA_VERSION,
                  },
                }
              : result,
        webVitalsEnabled
          ? createWebVitalsBeforeSend({
              buildVersion: runtimeConfig.public.buildVersion,
              navigator: typeof navigator === 'undefined' ? undefined : navigator,
              resolveRoute,
            })
          : undefined,
        strict
          ? createStrictPrivacyBeforeSend({ origin: window.location.origin, resolveRoute })
          : createStandardPrivacyBeforeSend(),
      )

      const posthogClient = posthog.init(posthogApiKey, {
        api_host: posthogHost === '' ? 'https://us.i.posthog.com' : posthogHost,
        capture_pageview: false, // We'll handle this manually for Nuxt SPA navigation
        capture_pageleave: true,

        disable_session_recording: !sessionReplayEnabled,
        disable_surveys: !surveysEnabled,
        disable_surveys_automatic_display: !surveysEnabled,
        capture_dead_clicks: !strict && runtimeConfig.public.posthogDeadClicksEnabled === true,
        // Strict: no element capture of any kind — clicks, rage clicks, heatmaps
        // — and every URL-bearing property reduced to its route pattern below.
        ...(strict
          ? {
              cross_subdomain_cookie: false,
              save_campaign_params: false,
              autocapture: false,
              rageclick: false,
              capture_heatmaps: false,
              mask_all_text: true,
              mask_all_element_attributes: true,
            }
          : {}),
        // Strict never loads PostHog's remote extensions (toolbar, heatmaps,
        // exception autocapture): each one is a capture path this hook list
        // did not review.
        disable_external_dependency_loading:
          strict ||
          (!sessionReplayEnabled &&
            runtimeConfig.public.posthogExternalDependencyLoadingEnabled !== true),
        // Strict makes no /flags request at all: its payload carries person
        // properties, which include the initial URL.
        advanced_disable_flags: strict,
        advanced_disable_feature_flags:
          strict || runtimeConfig.public.posthogFeatureFlagsEnabled !== true,

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
        ...(beforeSend ? { before_send: beforeSend } : {}),

        loaded: (ph) => {
          if (import.meta.dev) ph.debug()
        },
      } as Parameters<typeof posthog.init>[1])

      if (!posthogClient) {
        transport.fail()
        return
      }
      nuxtApp.provide('posthog', posthogClient)

      const win = window as LegacyNuxtWindow
      win.$nuxt ??= {}
      win.$nuxt.$posthog = posthogClient

      transport.attach(posthog)
    }

    return
  },
})
