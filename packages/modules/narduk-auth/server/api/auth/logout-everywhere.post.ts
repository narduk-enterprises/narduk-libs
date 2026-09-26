import { defineUserMutation } from '#layer/server/utils/mutation'
import { RATE_LIMIT_POLICIES } from '#layer/server/utils/rateLimit'
import { logoutEverywhere } from '#narduk-auth-server/utils/app-auth'
import { assertInteractiveSessionPrincipal } from '#narduk-auth-server/utils/interactive-principal'

/**
 * POST /api/auth/logout-everywhere
 * Ends every session the signed-in user holds, this browser's included, and
 * revokes their native-client tokens (narduk-libs#1043). Session-only: an API
 * key cannot sign its owner out.
 */
export default defineUserMutation(
  {
    rateLimit: RATE_LIMIT_POLICIES.authLogout,
  },
  async ({ event, user }) => {
    assertInteractiveSessionPrincipal(user, 'Logging out everywhere')
    return logoutEverywhere(event)
  },
)
