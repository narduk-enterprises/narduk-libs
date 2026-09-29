import { useNuxtApp } from '#imports'

import type { AnalyticsTransport } from '../utils/analyticsTransport'
import type { PostHog } from 'posthog-js'

/**
 * Client-side PostHog helper. Prefer this over `window.$nuxt.$posthog` or raw
 * `posthog` imports so calls no-op when analytics is disabled (no key, SSR,
 * localhost).
 */
export function usePosthog() {
  const getClient = () =>
    typeof window !== 'undefined' ? (useNuxtApp().$posthog as PostHog | undefined) : undefined

  const getTransport = () =>
    typeof window !== 'undefined'
      ? (useNuxtApp() as unknown as { $analytics?: AnalyticsTransport }).$analytics
      : undefined

  return {
    /** Raw posthog-js instance when initialized; otherwise undefined. */
    get client() {
      return getClient() ?? null
    },
    capture: (event: string, properties?: Record<string, unknown>) => {
      const transport = getTransport()
      if (transport) transport.capture(event, properties)
      else getClient()?.capture(event, properties)
    },
    identify: (distinctId: string, properties?: Record<string, unknown>) => {
      const transport = getTransport()
      if (transport) transport.identify(distinctId, properties)
      else getClient()?.identify(distinctId, properties)
    },
    reset: () => {
      const transport = getTransport()
      if (transport) transport.reset()
      else getClient()?.reset()
    },
  }
}
