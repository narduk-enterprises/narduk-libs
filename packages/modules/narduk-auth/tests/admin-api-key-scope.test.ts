/**
 * The admin routes hold an admin-owned API key to more than its owner's admin
 * flag (narduk-libs#918). Changing a role is session-only, whatever the key's
 * scopes, and listing users needs `auth:admin:users:read` on the key.
 */
import { createApp, toWebHandler } from 'h3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import listUsersRoute from '../server/api/admin/users/index.get'
import roleRoute from '../server/api/admin/users/role.put'
import usersAliasRoute from '../server/api/users.get'
import { AUTH_ADMIN_SCOPES } from '../server/utils/admin-scopes'

import { authStub } from './stubs/layer-auth'
import { databaseStub } from './stubs/layer-database'

import type { EventHandler } from 'h3'

interface CapturedMutation {
  __handler: (context: Record<string, unknown>) => Promise<unknown>
}

const roleHandler = (roleRoute as unknown as CapturedMutation).__handler
const sessionAdmin = { ...authStub.user }

function apiKeyAdmin(scopes: string[]) {
  return { ...sessionAdmin, authMethod: 'api-key', scopes }
}

async function status(handler: EventHandler, url: string) {
  const response = await toWebHandler(createApp().use(handler))(
    new Request(`http://admin.test${url}`),
  )
  return response.status
}

beforeEach(() => {
  databaseStub.reset()
  databaseStub.rows = [{ id: 'user-2', count: 1 }]
})

afterEach(() => {
  authStub.user = { ...sessionAdmin }
})

describe('PUT /api/admin/users/role', () => {
  it.each([
    ['no scopes', []],
    ['an unrelated scope', ['registry:read']],
    ['the admin read scope', [AUTH_ADMIN_SCOPES.usersRead]],
    ['the wildcard scope', ['*']],
  ])('refuses an admin-owned API key with %s, before any write', async (_label, scopes) => {
    await expect(
      roleHandler({
        event: {},
        admin: apiKeyAdmin(scopes),
        body: { userId: 'attacker', isAdmin: true },
      }),
    ).rejects.toMatchObject({ statusCode: 403 })
    expect(databaseStub.executedQueries).toHaveLength(0)
  })

  it('still lets an admin session change a role', async () => {
    await expect(
      roleHandler({
        event: {},
        admin: sessionAdmin,
        body: { userId: 'user-2', isAdmin: true },
      }),
    ).resolves.toEqual({ success: true })
  })
})

describe.each([
  ['/api/admin/users', listUsersRoute],
  ['/api/users', usersAliasRoute],
])('GET %s', (path, handler) => {
  it.each([
    ['no scopes', []],
    ['an unrelated scope', ['registry:read']],
  ])('refuses an admin-owned API key with %s', async (_label, scopes) => {
    authStub.user = apiKeyAdmin(scopes)
    expect(await status(handler, path)).toBe(403)
    expect(databaseStub.executedQueries).toHaveLength(0)
  })

  it('serves an API key that carries auth:admin:users:read', async () => {
    authStub.user = apiKeyAdmin([AUTH_ADMIN_SCOPES.usersRead])
    expect(await status(handler, path)).toBe(200)
  })

  it('serves an admin session without any scope', async () => {
    expect(await status(handler, path)).toBe(200)
  })
})
