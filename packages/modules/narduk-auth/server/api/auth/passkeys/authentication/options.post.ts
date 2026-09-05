import { definePublicMutation } from '#layer/server/utils/mutation'
import { RATE_LIMIT_POLICIES } from '#layer/server/utils/rateLimit'
import { startPasskeyAuthentication } from '#narduk-auth-server/lib/app-auth/webauthn-core'

/**
 * POST /api/auth/passkeys/authentication/options — issue a sign-in challenge.
 *
 * Public, like `login.post.ts`, and under the same `authLogin` rate-limit
 * policy. It takes no body at all: authentication is discoverable-credential
 * only, so this endpoint never learns an email and can therefore never confirm
 * or deny that an account exists.
 */
export default definePublicMutation(
  { rateLimit: RATE_LIMIT_POLICIES.authLogin },
  async ({ event }) => startPasskeyAuthentication(event),
)
