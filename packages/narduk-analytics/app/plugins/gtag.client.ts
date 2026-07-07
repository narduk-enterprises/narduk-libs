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

import {
  isLocalAnalyticsHost,
  normalizeAnalyticsLoadStrategy,
  runWithAnalyticsLoadStrategy,
} from '../utils/analyticsLoadStrategy'

export default defineNuxtPlugin({
  name: 'gtag',
  dependsOn: ['runtime-public'],
  setup() {
    const runtimeConfig = useRuntimeConfig()
    const measurementId = runtimeConfig.public.gaMeasurementId
    const previewSafeMode = runtimeConfig.public.previewSafeMode === true
    const strategy = normalizeAnalyticsLoadStrategy(runtimeConfig.public.analyticsLoadStrategy)

    if (!measurementId || previewSafeMode || import.meta.server || strategy === 'off') return

    if (isLocalAnalyticsHost(window.location.hostname)) {
      return
    }

    const router = useRouter()

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

      gtag('js', new Date())
      gtag('config', measurementId)

      const script = document.createElement('script')
      script.async = true
      script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`
      document.head.appendChild(script)

      // SPA navigations. The initial page_view comes from gtag('config') above.
      router.afterEach((to) => {
        void nextTick(() => {
          gtag('config', measurementId, {
            page_path: to.fullPath,
            page_location: window.location.origin + to.fullPath,
            page_title: document.title,
          })
        })
      })
    })
  },
})

declare global {
  interface Window {
    /** Present after the GA snippet runs; may be absent on first paint. */
    dataLayer?: IArguments[]
  }
}
