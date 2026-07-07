import { z } from 'zod'

import { apiKeys } from '#layer/orm-tables'
import {
  AUTH_API_KEY_SCOPES,
  generateApiKey,
  normalizeAuthScopes,
  resolveApiKeyExpiry,
  serializeApiKeyScopes,
} from '#layer/server/utils/auth'
import { useLogger } from '#layer/server/utils/logger'
import {
  defineUserMutation,
  requireMutationBody,
  withValidatedBody,
} from '#layer/server/utils/mutation'
import { RATE_LIMIT_POLICIES } from '#layer/server/utils/rateLimit'

const bodySchema = z.object({
  name: z.string().min(1).max(100),
  scopes: z.array(z.string().trim().min(1).max(100)).max(32).default([]),
  expiresInDays: z.number().int().min(1).max(365).nullable().optional(),
})

/**
 * POST /api/auth/api-keys
 * Create a new API key. Returns the raw key ONCE — caller must save it.
 */
export default defineUserMutation(
  {
    rateLimit: RATE_LIMIT_POLICIES.authApiKeys,
    parseBody: withValidatedBody(bodySchema.parse),
    requiredScopes: [AUTH_API_KEY_SCOPES.write],
  },
  async ({ event, user, body }) => {
    const input = requireMutationBody(body)
    const log = useLogger(event).child('Auth')
    const db = useDatabase(event)
    const { rawKey, keyHash, keyPrefix } = await generateApiKey()
    const id = crypto.randomUUID()
    const scopes = normalizeAuthScopes(input.scopes)
    const expiresAt = resolveApiKeyExpiry(input.expiresInDays)

    await db.insert(apiKeys).values({
      id,
      userId: user.id,
      name: input.name,
      keyHash,
      keyPrefix,
      scopesJson: serializeApiKeyScopes(scopes),
      expiresAt,
    })

    log.info('API key created', { keyPrefix, scopes, userId: user.id })

    return {
      id,
      name: input.name,
      keyPrefix,
      scopes,
      expiresAt,
      rawKey, // Only time the raw key is ever returned
      createdAt: new Date().toISOString(),
    }
  },
)
