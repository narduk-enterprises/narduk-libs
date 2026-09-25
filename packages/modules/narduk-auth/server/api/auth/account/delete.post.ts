import { z } from 'zod'

import {
  defineUserMutation,
  requireMutationBody,
  withOptionalValidatedBody,
} from '#layer/server/utils/mutation'
import { RATE_LIMIT_POLICIES } from '#layer/server/utils/rateLimit'
import { deleteCurrentUserAccountBridge } from '#narduk-auth-server/utils/accountDeletionBridge'
import {
  type AppSessionUser,
  deleteSupabaseAuthUser,
  verifySupabaseAccountDeletionCredentials,
} from '#narduk-auth-server/utils/app-auth'
import { assertInteractiveSessionPrincipal } from '#narduk-auth-server/utils/interactive-principal'

const deleteAccountSchema = z.object({
  currentPassword: z.string().min(1).optional(),
})

export default defineUserMutation(
  {
    rateLimit: RATE_LIMIT_POLICIES.authDeleteAccount,
    parseBody: withOptionalValidatedBody(deleteAccountSchema.parse, {}),
  },
  async ({ event, user, body }) => {
    assertInteractiveSessionPrincipal(user, 'Account deletion')
    const supabaseSession = (user as AppSessionUser).authBackend === 'supabase'
    await deleteCurrentUserAccountBridge(event, user, requireMutationBody(body), {
      // A Supabase user's password lives upstream; the local hash is null or stale (#923).
      ...(supabaseSession ? { verifyCredentials: verifySupabaseAccountDeletionCredentials } : {}),
      beforeDelete: async (evt, userId) => {
        if (supabaseSession) {
          await deleteSupabaseAuthUser(evt, userId)
        }
      },
    })

    return { success: true }
  },
)
