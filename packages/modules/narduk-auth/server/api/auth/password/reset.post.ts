import { z } from 'zod'

import {
  definePublicMutation,
  requireMutationBody,
  withValidatedBody,
} from '#layer/server/utils/mutation'
import { RATE_LIMIT_POLICIES } from '#layer/server/utils/rateLimit'
import { requestPasswordReset } from '#narduk-auth-server/utils/app-auth'

const bodySchema = z.object({
  email: z.string().email(),
  captchaToken: z.string().min(1).optional(),
  next: z.string().max(2048).optional(),
})

export default definePublicMutation(
  {
    rateLimit: RATE_LIMIT_POLICIES.authPasswordReset,
    parseBody: withValidatedBody(bodySchema.parse),
  },
  async ({ event, body }) => requestPasswordReset(event, requireMutationBody(body)),
)
