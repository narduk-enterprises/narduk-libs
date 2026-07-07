import { z } from 'zod'

import {
  defineUserMutation,
  requireMutationBody,
  withValidatedBody,
} from '#layer/server/utils/mutation'
import { RATE_LIMIT_POLICIES } from '#layer/server/utils/rateLimit'
import { changePassword } from '#narduk-auth-server/utils/app-auth'

const bodySchema = z.object({
  currentPassword: z.string().min(1).optional(),
  newPassword: z.string().min(8),
})

export default defineUserMutation(
  {
    rateLimit: RATE_LIMIT_POLICIES.authChangePassword,
    parseBody: withValidatedBody(bodySchema.parse),
  },
  async ({ event, body }) => changePassword(event, requireMutationBody(body)),
)
