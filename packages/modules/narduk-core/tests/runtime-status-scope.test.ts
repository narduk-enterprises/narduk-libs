/**
 * narduk-libs#971, decided 2026-09-25 as "scopes per route, opt-in": an admin
 * route names the scope a machine client needs. A key that carries scopes
 * must hold that one (or `*`), so an admin-owned key minted for something
 * narrow is no longer a full admin credential here. A key with no scopes at
 * all keeps its full admin reach until every admin route names a scope, and
 * sessions are unchanged.
 */
import { createEvent } from 'h3'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { H3Event } from 'h3'
import type { IncomingMessage, ServerResponse } from 'node:http'

const db = vi.hoisted(() => ({ rows: [] as unknown[] }))

vi.mock('nitropack/runtime', () => ({
  useRuntimeConfig: () => ({ databaseBackend: 'd1' }),
}))
vi.mock('#narduk-core/schema', () => ({ apiKeys: {}, sessions: {}, users: {} }))
vi.mock('../runtime/server/utils/user-session', () => ({
  getLayerUserSession: async () => null,
}))
vi.mock('../runtime/server/utils/worker-env', () => ({
  readCloudflareRuntimeEnv: () => ({}),
}))
vi.mock('../runtime/server/utils/database', () => {
  const chain: Record<string, () => unknown> = {}
  for (const method of ['from', 'limit', 'select', 'set', 'update', 'where']) {
    chain[method] = () => chain
  }
  return {
    executeDatabaseQuery: async () => [],
    getDatabaseRow: async () => db.rows.shift(),
    getDatabaseRows: async () => [],
    useDatabase: () => chain,
  }
})

const STATUS_SCOPE = 'runtime:status:read'
const ADMIN = { id: 'admin-1', email: 'ops@example.com', name: 'Ops', isAdmin: true }
const FUTURE = Math.floor(Date.now() / 1000) + 86_400

function bearerEvent(): H3Event {
  const request = {
    headers: { authorization: 'Bearer nk_live_token' },
    method: 'GET',
    url: '/api/runtime/status',
  } as unknown as IncomingMessage
  return createEvent(request, { setHeader: vi.fn() } as unknown as ServerResponse)
}

function keyRow(scopes: string[]) {
  return {
    id: 'key-1',
    userId: ADMIN.id,
    keyHash: 'hash',
    scopesJson: JSON.stringify(scopes),
    expiresAt: FUTURE,
    revokedAt: null,
  }
}

async function callStatus(scopes: string[], owner = ADMIN) {
  db.rows = [keyRow(scopes), owner]
  const { default: handler } = await import('../runtime/server/api/runtime/status.get')
  return handler(bearerEvent())
}

async function statusCodeOf(promise: Promise<unknown>): Promise<number> {
  try {
    await promise
    return 200
  } catch (error) {
    return (error as { statusCode: number }).statusCode
  }
}

describe('GET /api/runtime/status API-key scope (#971)', () => {
  beforeEach(() => {
    db.rows = []
  })

  it('refuses an admin-owned key minted for something else', async () => {
    expect(await statusCodeOf(callStatus(['registry:read']))).toBe(403)
  })

  it('accepts a key that holds runtime:status:read, or the wildcard', async () => {
    expect(await statusCodeOf(callStatus([STATUS_SCOPE]))).toBe(200)
    expect(await statusCodeOf(callStatus(['registry:read', STATUS_SCOPE]))).toBe(200)
    expect(await statusCodeOf(callStatus(['*']))).toBe(200)
  })

  it('keeps an unscoped admin key at full reach, as decided for #971', async () => {
    expect(await statusCodeOf(callStatus([]))).toBe(200)
  })

  it('still requires the key owner to be an admin', async () => {
    expect(await statusCodeOf(callStatus([STATUS_SCOPE], { ...ADMIN, isAdmin: false }))).toBe(403)
  })
})

describe('requireAdminRouteScopes refuses a non-admin on its own (#971)', () => {
  const base = { id: 'user-1', email: 'user@example.com', name: 'User', scopes: [] }

  it('refuses a non-admin session and a non-admin unscoped key', async () => {
    const { requireAdminRouteScopes } = await import('../runtime/server/utils/auth')
    for (const user of [
      { ...base, authMethod: 'session' as const, isAdmin: false },
      { ...base, authMethod: 'api-key' as const, isAdmin: null },
    ]) {
      expect(() => requireAdminRouteScopes(user, [STATUS_SCOPE])).toThrow(
        expect.objectContaining({ statusCode: 403 }),
      )
    }
  })

  it('passes an admin session', async () => {
    const { requireAdminRouteScopes } = await import('../runtime/server/utils/auth')
    expect(() =>
      requireAdminRouteScopes({ ...base, authMethod: 'session', isAdmin: true }, [STATUS_SCOPE]),
    ).not.toThrow()
  })
})
