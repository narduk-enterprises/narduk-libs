import { definePublicMutation } from '#layer/server/utils/mutation'
import { RATE_LIMIT_POLICIES } from '#layer/server/utils/rateLimit'
import { logoutUser } from '#narduk-auth-server/utils/app-auth'

export default definePublicMutation(
  {
    rateLimit: RATE_LIMIT_POLICIES.authLogout,
  },
  async ({ event }) => logoutUser(event),
)
