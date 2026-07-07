import { z } from 'zod'

import {
  defineUserMutation,
  requireMutationBody,
  withOptionalValidatedBody,
} from '#layer/server/utils/mutation'
import { RATE_LIMIT_POLICIES } from '#layer/server/utils/rateLimit'
import { deleteCurrentUserAccountBridge } from '#narduk-auth-server/utils/accountDeletionBridge'
import { type AppSessionUser, deleteSupabaseAuthUser } from '#narduk-auth-server/utils/app-auth'

const deleteAccountSchema = z.object({
  currentPassword: z.string().min(1).optional(),
})

export default defineUserMutation(
  {
    rateLimit: RATE_LIMIT_POLICIES.authDeleteAccount,
    parseBody: withOptionalValidatedBody(deleteAccountSchema.parse, {}),
  },
  async ({ event, user, body }) => {
    await deleteCurrentUserAccountBridge(event, user, requireMutationBody(body), {
      beforeDelete: async (evt, userId) => {
        if ((user as AppSessionUser).authBackend === 'supabase') {
          await deleteSupabaseAuthUser(evt, userId)
        }
      },
    })

    return { success: true }
  },
)
