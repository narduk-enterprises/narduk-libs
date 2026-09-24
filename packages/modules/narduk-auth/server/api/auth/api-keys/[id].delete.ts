import { createError, getRouterParam } from 'h3'

import { AUTH_API_KEY_SCOPES, revokeApiKey } from '#layer/server/utils/auth'
import { useDatabase } from '#layer/server/utils/database'
import { useLogger } from '#layer/server/utils/logger'
import { defineUserMutation } from '#layer/server/utils/mutation'
import { RATE_LIMIT_POLICIES } from '#layer/server/utils/rateLimit'

/**
 * DELETE /api/auth/api-keys/:id
 * Revoke an API key. Users can only revoke their own keys.
 *
 * The row is kept with `revoked_at` set (narduk-core's `revokeApiKey`,
 * narduk-libs#806), so `last_used_at`, the prefix and the scopes survive for
 * audit. An unknown, foreign or already-revoked key answers 404.
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

    const revoked = await revokeApiKey(useDatabase(event), id, { userId: user.id })

    if (!revoked) {
      log.warn('API key not found for revocation', { keyId: id, userId: user.id })
      throw createError({ statusCode: 404, message: 'API key not found' })
    }

    log.info('API key revoked', { keyId: id, userId: user.id })
    return { success: true }
  },
)
