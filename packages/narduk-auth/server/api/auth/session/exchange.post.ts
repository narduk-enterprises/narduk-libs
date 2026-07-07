import { z } from 'zod'

import {
  definePublicMutation,
  requireMutationBody,
  withValidatedBody,
} from '#layer/server/utils/mutation'
import { RATE_LIMIT_POLICIES } from '#layer/server/utils/rateLimit'
import { exchangeSupabaseCode } from '#narduk-auth-server/utils/app-auth'
import { logAuthCallbackFailure } from '#narduk-auth-server/utils/auth-callback'

const bodySchema = z.object({
  code: z.string().min(1),
  next: z.string().optional(),
})

export default definePublicMutation(
  {
    rateLimit: RATE_LIMIT_POLICIES.authLogin,
    parseBody: withValidatedBody(bodySchema.parse),
  },
  async ({ event, body }) => {
    const input = requireMutationBody(body)
    try {
      return await exchangeSupabaseCode(event, input)
    } catch (error) {
      logAuthCallbackFailure(event, error, {
        next: input.next ?? null,
      })
      throw error
    }
  },
)
