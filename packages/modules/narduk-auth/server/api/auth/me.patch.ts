import { z } from 'zod'

import {
  defineUserMutation,
  requireMutationBody,
  withValidatedBody,
} from '#layer/server/utils/mutation'
import { RATE_LIMIT_POLICIES } from '#layer/server/utils/rateLimit'
import { updateProfile } from '#narduk-auth-server/utils/app-auth'
import { assertInteractiveSessionPrincipal } from '#narduk-auth-server/utils/interactive-principal'

const bodySchema = z.object({
  name: z.string().max(200).optional(),
})

export default defineUserMutation(
  {
    rateLimit: RATE_LIMIT_POLICIES.authProfile,
    parseBody: withValidatedBody(bodySchema.parse),
  },
  async ({ event, user, body }) => {
    assertInteractiveSessionPrincipal(user, 'Profile updates')
    return updateProfile(event, requireMutationBody(body))
  },
)
