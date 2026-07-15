import { and, eq } from 'drizzle-orm'
import { createError, getRouterParam } from 'h3'

import { AUTH_API_KEY_SCOPES } from '#layer/server/utils/auth'
import { executeDatabaseQuery, useDatabase } from '#layer/server/utils/database'
import { useLogger } from '#layer/server/utils/logger'
import { defineUserMutation } from '#layer/server/utils/mutation'
import { RATE_LIMIT_POLICIES } from '#layer/server/utils/rateLimit'
import { apiKeys } from '#narduk-core/schema'

/**
 * DELETE /api/auth/api-keys/:id
 * Revoke (delete) an API key. Users can only delete their own keys.
 */
export default defineUserMutation(
  {
    rateLimit: RATE_LIMIT_POLICIES.authApiKeys,
    requiredScopes: [AUTH_API_KEY_SCOPES.write],
  },
  async ({ event, user }) => {
    const log = useLogger(event).child('Auth')
    const id = getRouterParam(event, 'id')

    if (!id) {
      throw createError({ statusCode: 400, message: 'Missing key ID' })
    }

    const db = useDatabase(event)

    const deleted = await executeDatabaseQuery<Array<typeof apiKeys.$inferSelect>>(
      db
        .delete(apiKeys)
        .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, user.id)))
        .returning(),
    )

    if (deleted.length === 0) {
      log.warn('API key not found for deletion', { keyId: id, userId: user.id })
      throw createError({ statusCode: 404, message: 'API key not found' })
    }

    log.info('API key revoked', { keyId: id, userId: user.id })
    return { success: true }
  },
)
