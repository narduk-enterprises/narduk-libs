/// <reference types="@cloudflare/workers-types" />
import {
  getApiKeyFromAuthorization,
  hashApiKeyText,
  hasRequiredApiKeyScopes,
  parseApiKeyScopeText,
} from './authApiKeyText'

import type { H3Event } from 'h3'

export interface D1ApiKeyUser {
  email: string
  id: string
  isAdmin: boolean
  name: string | null
}

export interface D1ApiKeyMetadata {
  expiresAt: number | null
  id: string
  name: string
  scopes: string[]
  userId: string
}

export type D1ApiKeyAuthFailureReason = 'expired' | 'invalid' | 'missing_scope'

export type D1ApiKeyAuthResult =
  | {
      apiKey: D1ApiKeyMetadata
      ok: true
      user: D1ApiKeyUser
    }
  | {
      ok: false
      reason: D1ApiKeyAuthFailureReason
    }

interface ApiKeyRow {
  api_key_id: string
  api_key_name: string
  email: string
  expires_at: number | null
  is_admin: number | null
  scopes_json: string | null
  user_id: string
  user_name: string | null
}

export interface AuthenticateD1ApiKeyOptions {
  nowSeconds?: () => number
  requiredScopes?: readonly string[]
  updateLastUsed?: boolean
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

export async function authenticateD1ApiKey(
  db: D1Database,
  rawKey: string,
  options: AuthenticateD1ApiKeyOptions = {},
): Promise<D1ApiKeyAuthResult> {
  const keyHash = await hashApiKeyText(rawKey)
  const row = await db
    .prepare(
      `SELECT
        api_keys.id AS api_key_id,
        api_keys.name AS api_key_name,
        api_keys.expires_at AS expires_at,
        api_keys.scopes_json AS scopes_json,
        users.id AS user_id,
        users.email AS email,
        users.name AS user_name,
        users.is_admin AS is_admin
      FROM api_keys
      INNER JOIN users ON users.id = api_keys.user_id
      WHERE api_keys.key_hash = ?
      LIMIT 1`,
    )
    .bind(keyHash)
    .first<ApiKeyRow>()

  if (!row) {
    return { ok: false, reason: 'invalid' }
  }

  const currentTime = options.nowSeconds?.() ?? nowSeconds()
  if (row.expires_at && row.expires_at < currentTime) {
    return { ok: false, reason: 'expired' }
  }

  const scopes = parseApiKeyScopeText(row.scopes_json)
  if (!hasRequiredApiKeyScopes(scopes, options.requiredScopes ?? [])) {
    return { ok: false, reason: 'missing_scope' }
  }

  if (options.updateLastUsed ?? true) {
    await db
      .prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?')
      .bind(new Date().toISOString(), row.api_key_id)
      .run()
  }

  return {
    apiKey: {
      expiresAt: row.expires_at,
      id: row.api_key_id,
      name: row.api_key_name,
      scopes,
      userId: row.user_id,
    },
    ok: true,
    user: {
      email: row.email,
      id: row.user_id,
      isAdmin: Boolean(row.is_admin),
      name: row.user_name,
    },
  }
}

export async function authenticateD1ApiKeyFromEvent(
  event: H3Event,
  db: D1Database,
  options: AuthenticateD1ApiKeyOptions = {},
): Promise<D1ApiKeyAuthResult | null> {
  const rawKey = getApiKeyFromAuthorization(event)
  return rawKey ? authenticateD1ApiKey(db, rawKey, options) : null
}
