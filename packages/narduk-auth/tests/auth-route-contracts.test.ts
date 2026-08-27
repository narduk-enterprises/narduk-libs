import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { beforeEach, describe, expect, it } from 'vitest'

import roleRoute from '../server/api/admin/users/role.put'
import changePasswordRoute from '../server/api/auth/change-password.post'
import meRoute from '../server/api/auth/me.patch'
import registerRoute from '../server/api/auth/register.post'
import exchangeRoute from '../server/api/auth/session/exchange.post'
import { buildAppPath } from '../server/lib/app-auth/helpers'

import { databaseStub } from './stubs/layer-database'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

// The mutation stub captures each route's options and handler instead of
// wrapping them in an H3 handler, so tests can exercise the zod contract and
// the handler logic directly.
interface CapturedMutation {
  __handler: (context: Record<string, unknown>) => Promise<unknown>
  __options: { parseBody: (input: unknown) => unknown }
}

function captured(route: unknown): CapturedMutation {
  return route as unknown as CapturedMutation
}

describe('POST /api/auth/session/exchange body contract', () => {
  const parseBody = captured(exchangeRoute).__options.parseBody

  it('accepts the code shape', () => {
    expect(parseBody({ code: 'abc', next: '/dashboard/' })).toEqual({
      code: 'abc',
      next: '/dashboard/',
    })
  })

  it('accepts the token_hash shape the client contract advertises', () => {
    expect(parseBody({ tokenHash: 'digest', verificationType: 'recovery' })).toEqual({
      tokenHash: 'digest',
      verificationType: 'recovery',
    })
    for (const verificationType of [
      'signup',
      'invite',
      'magiclink',
      'recovery',
      'email_change',
      'email',
    ]) {
      expect(() => parseBody({ tokenHash: 'digest', verificationType })).not.toThrow()
    }
  })

  it('rejects incomplete or unknown shapes', () => {
    expect(() => parseBody({})).toThrow()
    expect(() => parseBody({ tokenHash: 'digest' })).toThrow()
    expect(() => parseBody({ tokenHash: 'digest', verificationType: 'bogus' })).toThrow()
    expect(() => parseBody({ verificationType: 'recovery' })).toThrow()
  })
})

describe('auth input bounds', () => {
  const registerParse = captured(registerRoute).__options.parseBody
  const meParse = captured(meRoute).__options.parseBody
  const changePasswordParse = captured(changePasswordRoute).__options.parseBody

  it('caps register password and name at 200 characters', () => {
    const valid = { email: 'a@b.co', password: 'p'.repeat(200), name: 'n'.repeat(200) }
    expect(() => registerParse(valid)).not.toThrow()
    expect(() => registerParse({ ...valid, password: 'p'.repeat(201) })).toThrow()
    expect(() => registerParse({ ...valid, name: 'n'.repeat(201) })).toThrow()
  })

  it('caps profile name updates at 200 characters', () => {
    expect(() => meParse({ name: 'n'.repeat(200) })).not.toThrow()
    expect(() => meParse({})).not.toThrow()
    expect(() => meParse({ name: 'n'.repeat(201) })).toThrow()
  })

  it('caps new passwords but not existing-credential verification', () => {
    expect(() =>
      changePasswordParse({ currentPassword: 'c'.repeat(500), newPassword: 'p'.repeat(200) }),
    ).not.toThrow()
    expect(() => changePasswordParse({ newPassword: 'p'.repeat(201) })).toThrow()
  })
})

describe('PUT /api/admin/users/role handler', () => {
  const handler = captured(roleRoute).__handler

  beforeEach(() => {
    databaseStub.reset()
  })

  it('rejects self-demotion with 403', async () => {
    await expect(
      handler({ event: {}, admin: { id: 'admin-1' }, body: { userId: 'admin-1', isAdmin: false } }),
    ).rejects.toMatchObject({ statusCode: 403 })
  })

  it('returns 404 when the target user does not exist', async () => {
    databaseStub.rows = []
    await expect(
      handler({ event: {}, admin: { id: 'admin-1' }, body: { userId: 'ghost', isAdmin: true } }),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('reports success only after a row was actually updated', async () => {
    databaseStub.rows = [{ id: 'user-2' }]
    await expect(
      handler({ event: {}, admin: { id: 'admin-1' }, body: { userId: 'user-2', isAdmin: true } }),
    ).resolves.toEqual({ success: true })
    expect(databaseStub.executedQueries).toHaveLength(1)
  })
})

describe('recovery redirect stays same-origin', () => {
  it('builds a relative path with encoded query values', () => {
    expect(buildAppPath('/reset-password', { recovery: '1', next: '/dashboard/' })).toBe(
      '/reset-password?recovery=1&next=%2Fdashboard%2F',
    )
  })

  it('skips empty query values', () => {
    expect(buildAppPath('/reset-password', { recovery: '1', next: undefined })).toBe(
      '/reset-password?recovery=1',
    )
  })

  it('is used for the Supabase password-recovery redirect', () => {
    const source = readFileSync(join(packageRoot, 'server/lib/app-auth/auth-flows.ts'), 'utf8')
    expect(source).toContain('buildAppPath(config.resetPath')
    expect(source).not.toContain('buildAppUrl(config.appUrl, config.resetPath')
  })
})

describe('reset-password recovery gating', () => {
  it('demotes bare ?recovery=1 only on a runtime-confirmed local backend', () => {
    const source = readFileSync(join(packageRoot, 'app/pages/reset-password.vue'), 'utf8')
    // Must compare against the runtime-resolved value, and fail open (recovery
    // form) while it is unresolved — never trust the build-frozen backend.
    expect(source).toContain("authRuntime.value?.authBackend !== 'local'")
    expect(source).not.toContain("=== 'supabase'")
  })
})

describe('mfa verification assurance level', () => {
  it('defaults to the weaker aal1 when the session could not be persisted', () => {
    const source = readFileSync(join(packageRoot, 'server/lib/app-auth/profile.ts'), 'utf8')
    expect(source).toContain("persisted?.aal ?? 'aal1'")
    expect(source).not.toContain("?? 'aal2'")
  })
})
