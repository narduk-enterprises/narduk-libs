/**
 * An `api-key` principal names the key that authenticated it (narduk-libs#920),
 * so a route can bound what that key mints by the key's own lifetime.
 */
import { createEvent } from 'h3'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { requireAuth } from '../runtime/server/utils/auth'

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

const USER = { id: 'user-1', email: 'ops@example.com', name: 'Ops', isAdmin: false }
const FUTURE = Math.floor(Date.now() / 1000) + 86_400

function bearerEvent(): H3Event {
  const request = {
    headers: { authorization: 'Bearer nk_live_token' },
    method: 'POST',
    url: '/api/auth/api-keys',
  } as unknown as IncomingMessage
  return createEvent(request, { setHeader: vi.fn() } as unknown as ServerResponse)
}

function keyRow(expiresAt: number | null) {
  return {
    id: 'key-1',
    userId: USER.id,
    keyHash: 'hash',
    scopesJson: '["auth:api-keys:write"]',
    expiresAt,
    revokedAt: null,
  }
}

describe('requireAuth API-key principal', () => {
  beforeEach(() => {
    db.rows = []
  })

  it('carries the authenticating key id and expiry', async () => {
    db.rows = [keyRow(FUTURE), USER]

    await expect(requireAuth(bearerEvent())).resolves.toMatchObject({
      authMethod: 'api-key',
      scopes: ['auth:api-keys:write'],
      apiKey: { id: 'key-1', expiresAt: FUTURE },
    })
  })

  it('reports a never-expiring key as expiresAt null', async () => {
    db.rows = [keyRow(null), USER]

    await expect(requireAuth(bearerEvent())).resolves.toMatchObject({
      apiKey: { id: 'key-1', expiresAt: null },
    })
  })
})
