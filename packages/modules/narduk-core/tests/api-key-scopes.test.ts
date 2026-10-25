import { describe, expect, it, vi } from 'vitest'

import { requireAuthScopes } from '../runtime/server/utils/auth'
import { hasRequiredApiKeyScopes } from '../runtime/server/utils/authApiKeyText'

import type { AuthUser } from '../runtime/server/utils/auth'

vi.mock('nitropack/runtime', () => ({
  useRuntimeConfig: () => ({ databaseBackend: 'd1' }),
}))
vi.mock('#narduk-core/schema', () => ({ apiKeys: {}, sessions: {}, users: {} }))
vi.mock('../runtime/server/utils/user-session', () => ({
  peekLayerUserSession: async () => null,
}))
vi.mock('../runtime/server/utils/database', () => ({
  executeDatabaseQuery: async () => [],
  getDatabaseRow: async () => null,
  getDatabaseRows: async () => [],
  useDatabase: () => ({}),
}))

const READ = 'auth:api-keys:read'
const WRITE = 'auth:api-keys:write'

function user(authMethod: AuthUser['authMethod'], scopes: string[]): AuthUser {
  return { authMethod, scopes } as unknown as AuthUser
}

describe('hasRequiredApiKeyScopes', () => {
  it('requires every named scope, not any one of them', () => {
    expect(hasRequiredApiKeyScopes([READ], [READ, WRITE])).toBe(false)
    expect(hasRequiredApiKeyScopes([READ, WRITE], [READ, WRITE])).toBe(true)
  })
})

describe('requireAuthScopes', () => {
  it('refuses an unscoped API key when a scope is required', () => {
    expect(() => requireAuthScopes(user('api-key', []), [READ])).toThrow(
      expect.objectContaining({ statusCode: 403 }),
    )
  })

  it('does not apply to a session with the same empty scope list', () => {
    expect(() => requireAuthScopes(user('session', []), [READ])).not.toThrow()
  })

  it('refuses a key holding only one of two required scopes', () => {
    expect(() => requireAuthScopes(user('api-key', [READ]), [READ, WRITE])).toThrow(
      expect.objectContaining({ statusCode: 403 }),
    )
  })
})
