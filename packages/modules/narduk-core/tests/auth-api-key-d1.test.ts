/// <reference types="@cloudflare/workers-types" />
import { describe, expect, it, vi } from 'vitest'

import { authenticateD1ApiKey } from '../runtime/server/utils/authApiKeyD1'
import { hashApiKeyText } from '../runtime/server/utils/authApiKeyText'

const OPERATOR_SCOPE = 'control:operator'
const USER_EMAIL = 'logan@nard.uk'
const USER_ID = 'user-1'

function createApiKeyDb(options: {
  expiresAt?: number | null
  keyHash: string
  scopesJson?: string
}) {
  const run = vi.fn(async () => ({}))

  return {
    prepare: (sql: string) => ({
      bind: (...values: unknown[]) => ({
        first: async () => {
          if (!sql.includes('FROM api_keys')) return null
          if (values[0] !== options.keyHash) return null

          return {
            api_key_id: 'api-key-1',
            api_key_name: 'operator',
            email: USER_EMAIL,
            expires_at: options.expiresAt ?? null,
            is_admin: 0,
            scopes_json: options.scopesJson ?? JSON.stringify([OPERATOR_SCOPE]),
            user_id: USER_ID,
            user_name: 'Logan',
          }
        },
        run,
      }),
    }),
  } as unknown as D1Database
}

describe('D1 API key auth', () => {
  it('authenticates a valid key and updates last-used metadata', async () => {
    const rawKey = 'nk_valid_operator_key'
    const db = createApiKeyDb({
      keyHash: await hashApiKeyText(rawKey),
      scopesJson: JSON.stringify([OPERATOR_SCOPE]),
    })

    await expect(
      authenticateD1ApiKey(db, rawKey, {
        requiredScopes: [OPERATOR_SCOPE],
      }),
    ).resolves.toMatchObject({
      apiKey: {
        id: 'api-key-1',
        scopes: [OPERATOR_SCOPE],
      },
      ok: true,
      user: {
        email: USER_EMAIL,
        id: USER_ID,
      },
    })
  })

  it('rejects valid keys that lack required scopes', async () => {
    const rawKey = 'nk_readonly_key'
    const db = createApiKeyDb({
      keyHash: await hashApiKeyText(rawKey),
      scopesJson: JSON.stringify(['auth:api-keys:read']),
    })

    await expect(
      authenticateD1ApiKey(db, rawKey, {
        requiredScopes: [OPERATOR_SCOPE],
      }),
    ).resolves.toEqual({
      ok: false,
      reason: 'missing_scope',
    })
  })

  it('rejects expired keys', async () => {
    const rawKey = 'nk_expired_key'
    const db = createApiKeyDb({
      expiresAt: 100,
      keyHash: await hashApiKeyText(rawKey),
    })

    await expect(
      authenticateD1ApiKey(db, rawKey, {
        nowSeconds: () => 200,
        requiredScopes: [OPERATOR_SCOPE],
      }),
    ).resolves.toEqual({
      ok: false,
      reason: 'expired',
    })
  })
})
