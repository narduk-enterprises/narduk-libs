import {
  isLocalAnalyticsHost,
  normalizeAnalyticsLoadStrategy,
} from '../utils/analyticsLoadStrategy'

function originFromUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null

  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

export default defineNuxtPlugin({
  name: 'analytics-head',
  dependsOn: ['runtime-public'],
  setup() {
    const runtimeConfig = useRuntimeConfig()
    const strategy = normalizeAnalyticsLoadStrategy(runtimeConfig.public.analyticsLoadStrategy)
    const previewSafeMode = runtimeConfig.public.previewSafeMode === true

    if (strategy !== 'immediate' || previewSafeMode) return
    if (isLocalAnalyticsHost(window.location.hostname)) return

    const origins = new Set<string>()
    if (runtimeConfig.public.posthogPublicKey) {
      const posthogOrigin = originFromUrl(runtimeConfig.public.posthogHost)
      if (posthogOrigin) origins.add(posthogOrigin)
    }

    if (runtimeConfig.public.gaMeasurementId) {
      origins.add('https://www.googletagmanager.com')
      origins.add('https://www.google-analytics.com')
    }

    if (origins.size === 0) return

    useHead({
      link: Array.from(origins).map((href) => ({
        rel: 'preconnect',
        href,
        crossorigin: '',
      })),
    })
  },
})
