import { defineNitroPlugin, useRuntimeConfig } from 'nitropack/runtime'

import { attachAuthSessionGrantValidator } from '../utils/session-grant-validator'

/**
 * The narduk-auth module sets `runtimeConfig.nardukSessionGrantRequired` at
 * build time, but Nitro lets `NUXT_NARDUK_SESSION_GRANT_REQUIRED` override it
 * at runtime. Anything but `true` means a narduk-auth app could fall back to
 * cookie-as-grant, so it is refused (narduk-libs#1040).
 */
function assertSessionGrantRequired(config: { nardukSessionGrantRequired?: unknown }): void {
  if (config.nardukSessionGrantRequired !== true) {
    throw new Error(
      '[narduk-auth] runtimeConfig.nardukSessionGrantRequired must be true on an app with narduk-auth installed; remove the NUXT_NARDUK_SESSION_GRANT_REQUIRED override.',
    )
  }
}

/**
 * Register the auth-session grant validator on every request.
 *
 * narduk-core's `requireAuth` consults this seam. Core never imports this
 * package; the validator is placed on `event.context` at request start.
 *
 * The grant-required flag is checked at startup and again on each request,
 * because Cloudflare applies env overrides to the runtime config per request.
 */
export default defineNitroPlugin((nitroApp) => {
  assertSessionGrantRequired(useRuntimeConfig())
  nitroApp.hooks.hook('request', (event) => {
    assertSessionGrantRequired(useRuntimeConfig(event))
    attachAuthSessionGrantValidator(event)
  })
})
