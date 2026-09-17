import { z } from 'zod'

import {
  defineUserMutation,
  requireMutationBody,
  withValidatedBody,
} from '#layer/server/utils/mutation'
import { RATE_LIMIT_POLICIES } from '#layer/server/utils/rateLimit'
import { verifyMfa } from '#narduk-auth-server/utils/app-auth'
import { assertInteractiveSessionPrincipal } from '#narduk-auth-server/utils/interactive-principal'

const bodySchema = z.object({
  factorId: z.string().min(1),
  code: z.string().min(6).max(12),
})

export default defineUserMutation(
  {
    rateLimit: RATE_LIMIT_POLICIES.authProfile,
    parseBody: withValidatedBody(bodySchema.parse),
  },
  async ({ event, user, body }) => {
    assertInteractiveSessionPrincipal(user, 'MFA verification')
    return verifyMfa(event, requireMutationBody(body))
  },
)
