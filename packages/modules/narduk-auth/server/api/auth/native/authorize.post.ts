import { eq } from 'drizzle-orm'
import { createError } from 'h3'

import { useDatabase } from '#layer/server/utils/database'
import {
  definePublicMutation,
  requireMutationBody,
  withValidatedBody,
} from '#layer/server/utils/mutation'
import { RATE_LIMIT_POLICIES } from '#layer/server/utils/rateLimit'
import { users } from '#narduk-core/schema'

import { nativeAuthorizationSchema } from '../../../lib/app-auth/native-validation'
import { requireNativeAuthorizationOrigin, useNativeAuth } from '../../../utils/native-auth'
import { useRefreshedSessionUser } from '../../../utils/session-user'

export default definePublicMutation(
  {
    rateLimit: RATE_LIMIT_POLICIES.authLogin,
    parseBody: withValidatedBody(nativeAuthorizationSchema.parse),
  },
  async ({ event, body }) => {
    requireNativeAuthorizationOrigin(event)
    const user = await useRefreshedSessionUser(event)
    if (!user || user.authBackend !== 'local' || user.recoveryMode || user.needsPasswordSetup) {
      throw createError({ statusCode: 401, statusMessage: 'Sign in before connecting your app.' })
    }
    // AUTH_REQUIRE_MFA is ignored on the local backend (no TOTP stack).
    const [account] = await useDatabase(event)
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1)
    if (!account)
      throw createError({ statusCode: 401, statusMessage: 'Account is no longer available.' })
    return { redirectTo: await useNativeAuth(event).issueCode(user.id, requireMutationBody(body)) }
  },
)
