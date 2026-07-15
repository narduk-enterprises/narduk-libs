import { eq } from 'drizzle-orm'

import { AUTH_API_KEY_SCOPES, parseApiKeyScopes } from '#layer/server/utils/auth'
import { getDatabaseRows, useDatabase } from '#layer/server/utils/database'
import { useLogger } from '#layer/server/utils/logger'
import { defineUserQuery } from '#layer/server/utils/mutation'
import { RATE_LIMIT_POLICIES } from '#layer/server/utils/rateLimit'
import { apiKeys } from '#narduk-core/schema'

/**
 * GET /api/auth/api-keys
 * List the current user's API keys (never returns the full key).
 */
export default defineUserQuery(
  {
    rateLimit: RATE_LIMIT_POLICIES.authApiKeys,
    requiredScopes: [AUTH_API_KEY_SCOPES.read],
  },
  async ({ event, user }) => {
    const log = useLogger(event).child('Auth')
    const db = useDatabase(event)

    const keys = await getDatabaseRows<typeof apiKeys.$inferSelect>(
      db.select().from(apiKeys).where(eq(apiKeys.userId, user.id)),
    )

    log.debug('API keys listed', { count: keys.length, userId: user.id })
    return keys
      .map((key) => ({
        id: key.id,
        name: key.name,
        keyPrefix: key.keyPrefix,
        scopes: parseApiKeyScopes(key.scopesJson),
        lastUsedAt: key.lastUsedAt,
        expiresAt: key.expiresAt,
        createdAt: key.createdAt,
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  },
)
