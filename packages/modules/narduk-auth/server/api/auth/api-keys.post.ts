import { createError } from 'h3'
import { z } from 'zod'

import {
  AUTH_API_KEY_SCOPES,
  generateApiKey,
  normalizeAuthScopes,
  resolveApiKeyExpiry,
  serializeApiKeyScopes,
} from '#layer/server/utils/auth'
import { useDatabase } from '#layer/server/utils/database'
import { useLogger } from '#layer/server/utils/logger'
import {
  defineUserMutation,
  requireMutationBody,
  withValidatedBody,
} from '#layer/server/utils/mutation'
import { RATE_LIMIT_POLICIES } from '#layer/server/utils/rateLimit'
import { apiKeys } from '#narduk-core/schema'

import {
  BOUNDARY_API_KEY_MAX_EXPIRY_DAYS,
  boundChildApiKeyExpiry,
  resolveApiKeyMintExpiry,
} from '../../../shared/utils/api-key-lifetime'
import { findScopesBeyondCaller } from '../../../shared/utils/api-key-scope-ceiling'

const bodySchema = z.object({
  name: z.string().min(1).max(100),
  scopes: z.array(z.string().trim().min(1).max(100)).max(32).default([]),
  expiresInDays: z.number().int().min(1).max(365).nullable().optional(),
})

/**
 * POST /api/auth/api-keys
 * Create a new API key. Returns the raw key ONCE — caller must save it.
 *
 * A wildcard (`*`) key is a boundary-class credential (narduk-libs#168): it
 * must expire, and the lifetime is capped at
 * {@link BOUNDARY_API_KEY_MAX_EXPIRY_DAYS}. Narrow machine keys may still
 * omit expiry. A caller authenticated by an API key may mint only scopes it
 * already holds (narduk-libs#858), so `auth:api-keys:write` alone cannot mint
 * `*`, and the key it mints may not outlive the calling key (narduk-libs#920).
 * The unique index on `api_keys.key_hash` lives in narduk-core
 * 0007 — this handler stores that digest and never the raw token.
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
    const callingKey = user.authMethod === 'api-key' ? user.apiKey : undefined
    if (user.authMethod === 'api-key') {
      if (!callingKey) {
        // Without the calling key's own expiry the child cannot be bounded by it.
        throw createError({
          statusCode: 403,
          message: 'An API key cannot mint keys when its own lifetime is unknown.',
        })
      }
      const refused = findScopesBeyondCaller(scopes, user.scopes)
      if (refused.length > 0) {
        throw createError({
          statusCode: 403,
          message: `An API key cannot mint scopes it does not hold: ${refused.join(', ')}`,
        })
      }
    }
    const mintExpiry = resolveApiKeyMintExpiry(scopes, input.expiresInDays)
    if (!mintExpiry.ok) {
      throw createError({
        statusCode: 400,
        message:
          mintExpiry.reason === 'boundary-unbounded'
            ? 'A wildcard API key must have an expiry.'
            : `A wildcard API key cannot expire more than ${BOUNDARY_API_KEY_MAX_EXPIRY_DAYS} days from now.`,
      })
    }
    let expiresAt = resolveApiKeyExpiry(mintExpiry.expiresInDays)
    if (callingKey) {
      const bounded = boundChildApiKeyExpiry(
        expiresAt,
        callingKey.expiresAt,
        input.expiresInDays !== undefined,
      )
      if (!bounded.ok) {
        throw createError({
          statusCode: 403,
          message: 'An API key cannot mint a key that outlives it.',
        })
      }
      expiresAt = bounded.expiresAt
    }

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
