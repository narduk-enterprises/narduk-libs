import { z } from 'zod'

import {
  definePublicMutation,
  requireMutationBody,
  withValidatedBody,
} from '#layer/server/utils/mutation'
import { RATE_LIMIT_POLICIES } from '#layer/server/utils/rateLimit'
import { completeLocalEmailPassword } from '#narduk-auth-server/utils/app-auth'

const bodySchema = z.object({
  token: z.string().min(32).max(256),
  newPassword: z.string().min(8).max(200),
})

export default definePublicMutation(
  {
    rateLimit: RATE_LIMIT_POLICIES.authPasswordReset,
    parseBody: withValidatedBody(bodySchema.parse),
  },
  async ({ event, body }) => completeLocalEmailPassword(event, requireMutationBody(body)),
)
