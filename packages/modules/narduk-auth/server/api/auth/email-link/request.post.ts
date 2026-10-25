import { z } from 'zod'

import {
  definePublicMutation,
  requireMutationBody,
  withValidatedBody,
} from '#layer/server/utils/mutation'
import { RATE_LIMIT_POLICIES } from '#layer/server/utils/rateLimit'
import { requestLocalEmailSignInLink } from '#narduk-auth-server/lib/app-auth/local-email-signin'

const bodySchema = z.object({
  email: z.string().email(),
  next: z.string().max(2048).optional(),
})

/**
 * POST /api/auth/email-link/request — mail a passwordless sign-in link
 * (narduk-libs#1952). Answers the same for every address.
 */
export default definePublicMutation(
  {
    rateLimit: RATE_LIMIT_POLICIES.authPasswordReset,
    parseBody: withValidatedBody(bodySchema.parse),
  },
  async ({ event, body }) => requestLocalEmailSignInLink(event, requireMutationBody(body)),
)
