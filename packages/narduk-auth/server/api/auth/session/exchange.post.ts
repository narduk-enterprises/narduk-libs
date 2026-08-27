import { z } from 'zod'

import {
  definePublicMutation,
  requireMutationBody,
  withValidatedBody,
} from '#layer/server/utils/mutation'
import { RATE_LIMIT_POLICIES } from '#layer/server/utils/rateLimit'
import { exchangeSupabaseCode } from '#narduk-auth-server/utils/app-auth'
import { logAuthCallbackFailure } from '#narduk-auth-server/utils/auth-callback'

const emailVerificationTypeSchema = z.enum([
  'signup',
  'invite',
  'magiclink',
  'recovery',
  'email_change',
  'email',
])

// Mirrors the GET route's union so both transports accept the same two shapes
// the client-side exchangeSession() contract advertises.
const bodySchema = z.union([
  z.object({
    code: z.string().min(1),
    next: z.string().optional(),
  }),
  z.object({
    tokenHash: z.string().min(1),
    verificationType: emailVerificationTypeSchema,
    next: z.string().optional(),
  }),
])

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
