import { z } from 'zod'

import {
  definePublicMutation,
  requireMutationBody,
  withValidatedBody,
} from '#layer/server/utils/mutation'
import { RATE_LIMIT_POLICIES } from '#layer/server/utils/rateLimit'
import { redeemLocalEmailSignInLink } from '#narduk-auth-server/lib/app-auth/local-email-signin'

const bodySchema = z.object({
  token: z.string().min(32).max(256),
})

/**
 * POST /api/auth/email-link/redeem — spend a sign-in link and open a session
 * (narduk-libs#1952). Only this POST consumes a link; loading the page does not.
 */
export default definePublicMutation(
  {
    rateLimit: RATE_LIMIT_POLICIES.authLogin,
    parseBody: withValidatedBody(bodySchema.parse),
  },
  async ({ event, body }) => redeemLocalEmailSignInLink(event, requireMutationBody(body)),
)
