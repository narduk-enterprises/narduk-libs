import { z } from 'zod'

import {
  definePublicMutation,
  requireMutationBody,
  withValidatedBody,
} from '#layer/server/utils/mutation'
import { RATE_LIMIT_POLICIES } from '#layer/server/utils/rateLimit'
import { registerUser } from '#narduk-auth-server/utils/app-auth'

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(2),
  captchaToken: z.string().min(1).optional(),
  next: z.string().optional(),
})

export default definePublicMutation(
  {
    rateLimit: RATE_LIMIT_POLICIES.authRegister,
    parseBody: withValidatedBody(registerSchema.parse),
  },
  async ({ event, body }) => registerUser(event, requireMutationBody(body)),
)
