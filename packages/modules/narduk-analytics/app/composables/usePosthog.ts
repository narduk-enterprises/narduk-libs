import { useNuxtApp } from '#imports'

import type { PostHog } from 'posthog-js'

/**
 * Client-side PostHog helper. Prefer this over `window.$nuxt.$posthog` or raw
 * `posthog` imports so calls no-op when analytics is disabled (no key, SSR,
 * localhost).
 */
export function usePosthog() {
  const getClient = () =>
    typeof window !== 'undefined' ? (useNuxtApp().$posthog as PostHog | undefined) : undefined

  return {
    /** Raw posthog-js instance when initialized; otherwise undefined. */
    get client() {
      return getClient() ?? null
    },
    capture: (event: string, properties?: Record<string, unknown>) => {
      getClient()?.capture(event, properties)
    },
    identify: (distinctId: string, properties?: Record<string, unknown>) => {
      getClient()?.identify(distinctId, properties)
    },
    reset: () => {
      getClient()?.reset()
    },
  }
}
