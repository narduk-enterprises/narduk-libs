/**
 * Google Analytics 4 (gtag.js) — client-only plugin.
 *
 * Loads the GA4 measurement script and tracks SPA page navigations.
 * Set GA_MEASUREMENT_ID in your .env to activate.
 *
 * CRITICAL: The gtag() function MUST use `dataLayer.push(arguments)`, NOT
 * `dataLayer.push([...args])`. The gtag.js library only processes Arguments
 * objects as command tuples — regular Arrays are silently ignored.
 */

import { defineNuxtPlugin, nextTick, useRouter, useRuntimeConfig } from '#imports'

import {
  isLocalAnalyticsHost,
  normalizeAnalyticsLoadStrategy,
  runWithAnalyticsLoadStrategy,
} from '../utils/analyticsLoadStrategy'
import { normalizeAnalyticsPrivacy, templatePath, templateUrl } from '../utils/analyticsPrivacy'

export default defineNuxtPlugin({
  name: 'gtag',
  dependsOn: ['runtime-public'],
  setup() {
    const runtimeConfig = useRuntimeConfig()
    const measurementId = runtimeConfig.public.gaMeasurementId
    const previewSafeMode = runtimeConfig.public.previewSafeMode === true
    const strategy = normalizeAnalyticsLoadStrategy(runtimeConfig.public.analyticsLoadStrategy)
    const strict = normalizeAnalyticsPrivacy(runtimeConfig.public.analyticsPrivacy) === 'strict'

    if (!measurementId || previewSafeMode || import.meta.server || strategy === 'off') return

    if (isLocalAnalyticsHost(window.location.hostname)) {
      return
    }

    const router = useRouter()
    const resolveRoute = (path: string) => router.resolve(path)
    const strictPage = (path: string) => {
      const pattern = templatePath(path, resolveRoute)
      return {
        page_path: pattern,
        page_location: window.location.origin + pattern,
        page_title: pattern,
      }
    }

    runWithAnalyticsLoadStrategy(strategy, () => {
      // Queue must exist before any sync `gtag()` calls — the external gtag.js script loads async and replays it later.
      // (`??=` / `?? []` matches Google’s `window.dataLayer = window.dataLayer || []` for undefined; keeps ESLint happy.)
      window.dataLayer ??= []
      const dataLayer = window.dataLayer

      // Must push the real `arguments` object — a rest-parameter Array is not replayed
      // the same way by gtag.js. Outer type is variadic so call sites typecheck.
      const gtag: (...args: unknown[]) => void = function () {
        // eslint-disable-next-line prefer-rest-params -- gtag.js only accepts the Arguments object; rest arrays are ignored
        dataLayer.push(arguments as unknown as IArguments)
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- gtag must be attached to window for GA4 to pick it up; no type definition exists
      ;(window as any).gtag = gtag

      // Google tags accept one config command for a destination. It establishes
      // the tag without emitting a page view; this plugin owns the complete
      // initial + successful SPA navigation page-view lifecycle below.
      gtag('js', new Date())
      if (strict) {
        // Strict privacy: Google gets the route pattern as the page, never the
        // raw path, query, fragment or title, and no signals or ad
        // personalisation. `page_location` set here also overrides the address
        // Google would otherwise read from `document.location` for any event
        // the tag collects on its own (Enhanced Measurement).
        const page = strictPage(router.currentRoute.value.path)
        gtag('config', measurementId, {
          send_page_view: false,
          allow_google_signals: false,
          allow_ad_personalization_signals: false,
          page_referrer: templateUrl(document.referrer, window.location.origin, resolveRoute),
          ...page,
        })
      } else {
        gtag('config', measurementId, { send_page_view: false })
      }

      const script = document.createElement('script')
      script.async = true
      script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`
      document.head.appendChild(script)

      // `to.path` deliberately excludes query and hash data. It also lets us
      // ignore hash-only transitions and hydration's duplicate route callback.
      let lastTrackedPath: string | undefined
      const trackPageview = (path: string) => {
        if (path === lastTrackedPath) return

        lastTrackedPath = path
        if (strict) {
          const page = strictPage(path)
          gtag('set', page)
          gtag('event', 'page_view', page)
          return
        }
        gtag('event', 'page_view', {
          page_path: path,
          page_location: window.location.origin + path,
          // Standard floor: do not send document.title (page text). The path
          // is already query- and fragment-free.
          page_title: path,
        })
      }

      // Nuxt may invoke afterEach while it hydrates, or only after it becomes
      // ready. Cover both orderings and deduplicate the shared initial route.
      router.afterEach((to, _from, failure) => {
        if (failure) return
        void nextTick(() => trackPageview(to.path))
      })
      void router
        .isReady()
        .then(() => nextTick(() => trackPageview(router.currentRoute.value.path)))
    })
  },
})

declare global {
  interface Window {
    /** Present after the GA snippet runs; may be absent on first paint. */
    dataLayer?: IArguments[]
  }
}
