import { defineUserMutation } from '#layer/server/utils/mutation'
import { RATE_LIMIT_POLICIES } from '#layer/server/utils/rateLimit'
import {
  assertPasskeyManagementPrincipal,
  startPasskeyRegistration,
} from '#narduk-auth-server/lib/app-auth/webauthn-core'

/**
 * POST /api/auth/passkeys/registration/options — issue a registration challenge.
 *
 * `defineUserMutation`, NOT `definePublicMutation` (narduk-libs#125 gap G5,
 * risk R2). A consumer's boundary may treat the whole `/api/auth/` prefix as
 * public — the operator portal's `PUBLIC_PATH_PREFIXES` does, and must, so
 * that sign-in works. A registration ceremony reachable anonymously is an
 * account-takeover primitive: anyone could enrol their own authenticator onto
 * an account. Enrolment therefore requires an established session here, in the
 * package, and never relies on the consumer's path list to protect it.
 */
export default defineUserMutation(
  { rateLimit: RATE_LIMIT_POLICIES.authApiKeys },
  async ({ event, user }) => {
    assertPasskeyManagementPrincipal(user)
    return startPasskeyRegistration(event, { id: user.id, email: user.email })
  },
)
