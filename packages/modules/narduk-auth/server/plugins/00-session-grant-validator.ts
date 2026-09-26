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
 * The grant-required flag is checked once, at startup. The validator is then
 * attached to every request whatever the flag says: core runs a present
 * validator regardless of the flag, so an override that only reaches the
 * per-request config still fails closed. Throwing from this hook instead
 * would not refuse the request; Nitro logs a `request` hook error and carries
 * on without the validator, accepting the cookie as the grant.
 */
export default defineNitroPlugin((nitroApp) => {
  assertSessionGrantRequired(useRuntimeConfig())
  nitroApp.hooks.hook('request', (event) => {
    attachAuthSessionGrantValidator(event)
  })
})
