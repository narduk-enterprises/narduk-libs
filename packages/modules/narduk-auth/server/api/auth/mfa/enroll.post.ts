import { z } from 'zod'

import {
  defineUserMutation,
  requireMutationBody,
  withValidatedBody,
} from '#layer/server/utils/mutation'
import { RATE_LIMIT_POLICIES } from '#layer/server/utils/rateLimit'
import { enrollMfa } from '#narduk-auth-server/utils/app-auth'

const bodySchema = z.object({
  friendlyName: z.string().min(1).max(64).optional(),
})

export default defineUserMutation(
  {
    rateLimit: RATE_LIMIT_POLICIES.authProfile,
    parseBody: withValidatedBody(bodySchema.parse),
  },
  async ({ event, body }) => enrollMfa(event, requireMutationBody(body).friendlyName),
)
