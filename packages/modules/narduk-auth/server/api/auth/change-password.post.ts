import { z } from 'zod'

import {
  defineUserMutation,
  requireMutationBody,
  withValidatedBody,
} from '#layer/server/utils/mutation'
import { RATE_LIMIT_POLICIES } from '#layer/server/utils/rateLimit'
import { changePassword } from '#narduk-auth-server/utils/app-auth'
import { assertInteractiveSessionPrincipal } from '#narduk-auth-server/utils/interactive-principal'

// currentPassword stays uncapped: it verifies an existing credential that may
// predate the 200-character cap on new passwords.
const bodySchema = z.object({
  currentPassword: z.string().min(1).optional(),
  newPassword: z.string().min(8).max(200),
})

export default defineUserMutation(
  {
    rateLimit: RATE_LIMIT_POLICIES.authChangePassword,
    parseBody: withValidatedBody(bodySchema.parse),
  },
  async ({ event, user, body }) => {
    assertInteractiveSessionPrincipal(user, 'Password changes')
    return changePassword(event, requireMutationBody(body))
  },
)
