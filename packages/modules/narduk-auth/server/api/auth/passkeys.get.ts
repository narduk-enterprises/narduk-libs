import { defineUserQuery } from '#layer/server/utils/mutation'
import { RATE_LIMIT_POLICIES } from '#layer/server/utils/rateLimit'
import {
  assertPasskeyManagementPrincipal,
  listPasskeys,
} from '#narduk-auth-server/lib/app-auth/webauthn-core'

/**
 * GET /api/auth/passkeys — list the current user's passkeys.
 *
 * Never returns a public key or any credential material a caller could use;
 * only the labels and dates the settings panel renders.
 */
export default defineUserQuery(
  { rateLimit: RATE_LIMIT_POLICIES.authApiKeys },
  async ({ event, user }) => {
    assertPasskeyManagementPrincipal(user)
    return listPasskeys(event, user.id)
  },
)
