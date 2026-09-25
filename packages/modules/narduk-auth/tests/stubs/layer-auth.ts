/**
 * Layer auth stub.
 *
 * The list routes under test need an authenticated caller, not a session
 * implementation; `authStub.user` is what `requireAuth` / `requireAdmin` answer.
 *
 * API-key mint tests also need the create helpers: generate a fixed token,
 * normalise scopes, and resolve expiry without the real hasher or clock.
 */
import { createError } from 'h3'

import { hasRequiredApiKeyScopes } from '../../../narduk-core/runtime/server/utils/authApiKeyText'

export const AUTH_API_KEY_SCOPES = {
  read: 'auth:api-keys:read',
  write: 'auth:api-keys:write',
} as const

export const authStub = {
  user: {
    authMethod: 'session',
    email: 'admin@list.test',
    id: 'user-1',
    isAdmin: true,
    name: 'Admin',
    scopes: [] as string[],
  },
}

export async function requireAuth() {
  return authStub.user
}

export async function requireAdmin() {
  return authStub.user
}

/** narduk-core's rule: only an API-key caller is held to the listed scopes. */
export function requireAuthScopes(
  user: { authMethod?: string; scopes?: readonly string[] },
  requiredScopes: readonly string[] = [],
) {
  if (requiredScopes.length === 0 || user.authMethod !== 'api-key') return
  if (hasRequiredApiKeyScopes(user.scopes ?? [], requiredScopes)) return
  throw createError({
    statusCode: 403,
    message: `Forbidden — missing required API key scopes: ${requiredScopes.join(', ')}`,
  })
}

export function normalizeAuthScopes(scopes: readonly string[]) {
  return [...new Set(scopes.map((scope) => scope.trim()).filter(Boolean))]
}

export function serializeApiKeyScopes(scopes: readonly string[]) {
  return JSON.stringify(scopes)
}

export function resolveApiKeyExpiry(expiresInDays: number | null | undefined) {
  if (expiresInDays === null) return null
  return 1_700_000_000 + (expiresInDays ?? 30) * 86_400
}

export async function generateApiKey() {
  return {
    rawKey: 'nk_testkey',
    keyHash: 'test-key-hash',
    keyPrefix: 'nk_testkey',
  }
}
