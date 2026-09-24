import { and, desc, eq, isNull } from 'drizzle-orm'

import { AUTH_API_KEY_SCOPES, parseApiKeyScopes } from '#layer/server/utils/auth'
import { getDatabaseRows, useDatabase } from '#layer/server/utils/database'
import { useLogger } from '#layer/server/utils/logger'
import { defineUserQuery } from '#layer/server/utils/mutation'
import { RATE_LIMIT_POLICIES } from '#layer/server/utils/rateLimit'
import { apiKeys } from '#narduk-core/schema'

/**
 * Nothing caps how many keys a user may create (api-keys.post.ts is only rate
 * limited), so the list is bounded here: the newest keys first, at most this
 * many. A user past it still sees every key they are likely to manage.
 */
const API_KEY_LIST_LIMIT = 100

/**
 * GET /api/auth/api-keys
 * List the current user's live API keys (never returns the full key), newest
 * first. A revoked key keeps its row for audit (narduk-libs#806) but is not
 * listed: it can no longer authenticate or be revoked again.
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
      db
        .select()
        .from(apiKeys)
        .where(and(eq(apiKeys.userId, user.id), isNull(apiKeys.revokedAt)))
        .orderBy(desc(apiKeys.createdAt))
        .limit(API_KEY_LIST_LIMIT),
    )

    log.debug('API keys listed', { count: keys.length, userId: user.id })
    return keys.map((key) => ({
      id: key.id,
      name: key.name,
      keyPrefix: key.keyPrefix,
      scopes: parseApiKeyScopes(key.scopesJson),
      lastUsedAt: key.lastUsedAt,
      expiresAt: key.expiresAt,
      createdAt: key.createdAt,
    }))
  },
)
