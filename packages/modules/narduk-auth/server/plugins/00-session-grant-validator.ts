import { defineNitroPlugin } from 'nitropack/runtime'

import { attachAuthSessionGrantValidator } from '../utils/session-grant-validator'

/**
 * Register the auth-session grant validator on every request.
 *
 * narduk-core's `requireAuth` consults this seam. Core never imports this
 * package; the validator is placed on `event.context` at request start.
 */
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('request', (event) => {
    attachAuthSessionGrantValidator(event)
  })
})
