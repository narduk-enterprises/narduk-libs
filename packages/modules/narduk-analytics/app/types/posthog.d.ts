import type { PostHog } from 'posthog-js'
import type { AnalyticsTransport } from '../utils/analyticsTransport'

declare module '#app' {
  interface NuxtApp {
    $analytics?: AnalyticsTransport
    /** Set by `posthog.client.ts` when the public key is configured and the host is not localhost. */
    $posthog?: PostHog
  }
}

export {}
