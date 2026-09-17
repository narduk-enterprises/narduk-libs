import { defineNuxtPlugin, useRequestId, useRouter, useRuntimeConfig } from '#imports'

import { installClientExceptionCapture } from '../../shared/exception-capture'

import type { ExceptionHookHost } from '../../shared/exception-report'

/**
 * Publishes every Vue component error and every fatal app error on the shared
 * `narduk:exception` hook. It reports; it does not decide where a report goes —
 * narduk-analytics subscribes a PostHog reporter, an app can subscribe its own,
 * and with no subscriber at all this costs one no-op hook call per error.
 */
export default defineNuxtPlugin({
  name: 'narduk-exception-capture',
  setup(nuxtApp) {
    const runtimeConfig = useRuntimeConfig()
    const router = useRouter()
    const requestId = useRequestId()

    installClientExceptionCapture(
      // `narduk:exception` is not a name Nuxt's own hook types know, so the app
      // is narrowed to the structural bus the seam declares.
      nuxtApp as unknown as ExceptionHookHost,
      {
        resolveBuildVersion: () => {
          const value = runtimeConfig.public.buildVersion
          return typeof value === 'string' && value !== '' ? value : undefined
        },
        resolveRequestId: () => requestId.value || undefined,
        resolveRoute: () => router.currentRoute.value.matched.at(-1)?.path,
      },
    )
  },
})
