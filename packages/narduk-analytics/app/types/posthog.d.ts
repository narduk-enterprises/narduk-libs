import type { PostHog } from 'posthog-js'

declare module '#app' {
  interface NuxtApp {
    /** Set by `posthog.client.ts` when the public key is configured and the host is not localhost. */
    $posthog?: PostHog
  }
}

export {}
