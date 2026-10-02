/**
 * The notification routes are session-or-scoped-key (harbor#841). A household
 * MCP key (`harbor:mcp:household:…`) or an unscoped `nk_` key must not read or
 * change its owner's notifications; a session and a key that carries the
 * route's scope must still work.
 */
import { createApp, toWebHandler } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { hasRequiredApiKeyScopes } from '../../narduk-core/runtime/server/utils/authApiKeyText'
import notificationDeleteRoute from '../server/api/notifications/[id].delete'
import notificationReadRoute from '../server/api/notifications/[id].patch'
import notificationListRoute from '../server/api/notifications/index.get'
import notificationCreateRoute from '../server/api/notifications/index.post'
import notificationReadAllRoute from '../server/api/notifications/read-all.post'
import unreadCountRoute from '../server/api/notifications/unread-count.get'
import { AUTH_NOTIFICATION_SCOPES } from '../server/utils/notifications'

import { authStub } from './stubs/layer-auth'

import type { EventHandler } from 'h3'

// The read helpers' queries are not under test here: the access rule is. Keep
// the real scope constants and answer the two reads from memory, recording each
// call so a refusal can prove no read happened.
const reads = vi.hoisted(() => ({ calls: 0 }))

vi.mock('#narduk-auth-server/utils/notifications', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getUnreadCount: async () => {
    reads.calls += 1
    return 0
  },
  getUserNotifications: async () => {
    reads.calls += 1
    return []
  },
}))

interface CapturedMutation {
  __options: { requiredScopes?: string[] }
}

const sessionUser = { ...authStub.user, isAdmin: false }
const HOUSEHOLD_KEY_SCOPES = ['harbor:mcp:household:hh_example']

function apiKeyUser(scopes: string[]) {
  return { ...sessionUser, authMethod: 'api-key', scopes }
}

async function status(handler: EventHandler, url: string) {
  const response = await toWebHandler(createApp().use(handler))(
    new Request(`http://notifications.test${url}`),
  )
  return response.status
}

beforeEach(() => {
  reads.calls = 0
  authStub.user = { ...sessionUser }
})

afterEach(() => {
  authStub.user = { ...sessionUser }
})

describe.each([
  ['GET /api/notifications', notificationListRoute, '/api/notifications'],
  ['GET /api/notifications/unread-count', unreadCountRoute, '/api/notifications/unread-count'],
])('%s', (_name, handler, path) => {
  it.each([
    ['a household MCP scope only', HOUSEHOLD_KEY_SCOPES],
    ['no scopes', []],
    ['the write scope only', [AUTH_NOTIFICATION_SCOPES.write]],
  ])('refuses an API key with %s, before any read', async (_label, scopes) => {
    authStub.user = apiKeyUser(scopes)
    expect(await status(handler, path)).toBe(403)
    expect(reads.calls).toBe(0)
  })

  it('serves a session without any scope', async () => {
    expect(await status(handler, path)).toBe(200)
  })

  it('serves an API key that carries auth:notifications:read', async () => {
    authStub.user = apiKeyUser([AUTH_NOTIFICATION_SCOPES.read])
    expect(await status(handler, path)).toBe(200)
  })

  it('serves an API key with the wildcard scope', async () => {
    authStub.user = apiKeyUser(['*'])
    expect(await status(handler, path)).toBe(200)
  })
})

// The mutation routes are enforced by narduk-core's defineUserMutation, which
// this package's tests stub; pin that each names the write scope and that the
// real scope rule refuses a household key against it.
describe.each([
  ['POST /api/notifications', notificationCreateRoute],
  ['PATCH /api/notifications/:id', notificationReadRoute],
  ['POST /api/notifications/read-all', notificationReadAllRoute],
  ['DELETE /api/notifications/:id', notificationDeleteRoute],
])('%s', (_name, route) => {
  const required = (route as unknown as CapturedMutation).__options.requiredScopes ?? []

  it('names auth:notifications:write', () => {
    expect(required).toEqual([AUTH_NOTIFICATION_SCOPES.write])
  })

  it('refuses a household MCP key and an unscoped key, accepts the write scope and *', () => {
    expect(hasRequiredApiKeyScopes(HOUSEHOLD_KEY_SCOPES, required)).toBe(false)
    expect(hasRequiredApiKeyScopes([], required)).toBe(false)
    expect(hasRequiredApiKeyScopes([AUTH_NOTIFICATION_SCOPES.read], required)).toBe(false)
    expect(hasRequiredApiKeyScopes([AUTH_NOTIFICATION_SCOPES.write], required)).toBe(true)
    expect(hasRequiredApiKeyScopes(['*'], required)).toBe(true)
  })
})
