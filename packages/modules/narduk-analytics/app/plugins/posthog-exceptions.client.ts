import { onNardukException } from '@narduk-enterprises/narduk-core/shared/exception-report'
import { defineNuxtPlugin } from '#imports'

import { reportExceptionToPostHog } from '../utils/exceptionReporting'

import type { ExceptionHookHost } from '@narduk-enterprises/narduk-core/shared/exception-report'
import type { PostHogExceptionClient } from '../utils/exceptionReporting'

/**
 * Subscribes PostHog to narduk-core's `narduk:exception` seam. It registers a
 * destination; it never captures. See `../utils/exceptionReporting` for why
 * `captureException` is used rather than `capture_exceptions` autocapture.
 */
export default defineNuxtPlugin({
  name: 'posthog-exceptions',
  dependsOn: ['posthog'],
  setup(nuxtApp) {
    onNardukException(
      // `narduk:exception` is not a name Nuxt's own hook types know, so the app
      // is narrowed to the structural bus the seam declares.
      nuxtApp as unknown as ExceptionHookHost,
      (report) => {
        // Read at report time, not at setup time: `posthog.client` provides the
        // client asynchronously under the idle/interaction load strategies.
        const posthog = (nuxtApp as unknown as { $posthog?: PostHogExceptionClient }).$posthog
        reportExceptionToPostHog(posthog, report)
      },
    )
  },
})
