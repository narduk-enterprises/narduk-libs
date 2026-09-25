import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AppSessionUser } from '../server/lib/app-auth/types'
import type { H3Event } from 'h3'

const state = vi.hoisted(() => ({
  apiKey: null as null | {
    scopes: string[]
    user: { email: string; id: string }
  },
  backend: 'supabase' as 'local' | 'supabase',
  native: null as null | { sessionId: string; userId: string },
  nativeUser: null as null | { email: string; id: string },
  requireMfa: false,
  user: null as AppSessionUser | null,
  verified: new Set<string>(),
}))

vi.mock('../server/utils/session-user', () => ({
  useRefreshedSessionUser: async () => state.user,
}))

vi.mock('../server/utils/native-auth', () => ({
  getNativeAuthSession: async () => state.native,
}))

vi.mock('../server/lib/app-auth/session', () => ({
  loadAuthUserRow: async (_event: unknown, id: string) =>
    state.nativeUser?.id === id ? state.nativeUser : null,
}))

vi.mock('../server/utils/verified-email', () => ({
  getLocalEmailVerification: async (_event: unknown, userId: string, email: string) =>
    state.verified.has(`${userId}:${email}`) ? '2026-09-25T00:00:00.000Z' : null,
}))

vi.mock('#layer/server/utils/auth', () => ({
  authenticateApiKey: async () => state.apiKey,
}))

vi.mock('nitropack/runtime', () => ({
  useRuntimeConfig: () => ({
    authBackend: state.backend,
    public: { authBackend: state.backend, authRequireMfa: state.requireMfa },
  }),
}))

function sessionUser(overrides: Partial<AppSessionUser> = {}): AppSessionUser {
  return {
    id: 'user-1',
    email: 'crew@example.com',
    name: 'Crew',
    isAdmin: false,
    authBackend: 'supabase',
    authSessionId: 'sess-1',
    aal: 'aal1',
    emailConfirmedAt: '2026-09-01T00:00:00.000Z',
    recoveryMode: false,
    ...overrides,
  }
}

function event(path: string, method = 'GET', authorization?: string): H3Event {
  return {
    context: {},
    method,
    path,
    node: { req: { headers: authorization ? { authorization } : {} } },
  } as unknown as H3Event
}

const NATIVE_TOKEN = 'a'.repeat(43)
const FARM_PATH = '/api/farms/1'

async function load() {
  return import('../server/utils/request-principal')
}

describe('resolveRequestPrincipal (narduk-libs#980)', () => {
  beforeEach(() => {
    state.apiKey = null
    state.backend = 'supabase'
    state.native = null
    state.nativeUser = null
    state.requireMfa = false
    state.user = null
    state.verified = new Set()
    vi.resetModules()
  })

  it('returns null for an anonymous caller instead of throwing', async () => {
    const { resolveRequestPrincipal, resolveTenancyUserId } = await load()
    await expect(resolveRequestPrincipal(event(FARM_PATH))).resolves.toBeNull()
    await expect(resolveTenancyUserId(event(FARM_PATH))).resolves.toBeNull()
  })

  it('resolves a plain session', async () => {
    state.user = sessionUser()
    const { resolveRequestPrincipal, resolveTenancyUserId } = await load()
    await expect(resolveRequestPrincipal(event(FARM_PATH, 'POST'))).resolves.toEqual({
      apiKeyScopes: [],
      email: 'crew@example.com',
      emailVerified: true,
      method: 'session',
      sessionId: 'sess-1',
      userId: 'user-1',
    })
    await expect(resolveTenancyUserId(event(FARM_PATH, 'POST'))).resolves.toBe('user-1')
  })

  it('refuses a recovery-mode session outside the recovery allowlist', async () => {
    state.user = sessionUser({ recoveryMode: true })
    const { resolveRequestPrincipal, resolveTenancyUserId } = await load()
    await expect(resolveTenancyUserId(event('/api/orgs/1/members', 'POST'))).resolves.toBeNull()
    await expect(resolveRequestPrincipal(event(FARM_PATH))).resolves.toBeNull()
    // The allowlist is the one requireAuth applies: change-password stays reachable.
    await expect(resolveTenancyUserId(event('/api/auth/change-password', 'POST'))).resolves.toBe(
      'user-1',
    )
  })

  it('refuses an MFA-step-up session when AUTH_REQUIRE_MFA is on', async () => {
    state.requireMfa = true
    state.user = sessionUser({ aal: 'aal1' })
    const { resolveTenancyUserId } = await load()
    await expect(resolveTenancyUserId(event('/api/orgs/1', 'PATCH'))).resolves.toBeNull()
    await expect(resolveTenancyUserId(event('/api/auth/mfa/verify', 'POST'))).resolves.toBe(
      'user-1',
    )

    state.user = sessionUser({ aal: 'aal2' })
    vi.resetModules()
    const again = await load()
    await expect(again.resolveTenancyUserId(event('/api/orgs/1', 'PATCH'))).resolves.toBe('user-1')
  })

  it('refuses a needs-password-setup session only when asked', async () => {
    state.user = sessionUser({ needsPasswordSetup: true })
    const { resolveRequestPrincipal } = await load()
    await expect(resolveRequestPrincipal(event('/api/nvr'))).resolves.toMatchObject({
      userId: 'user-1',
    })
    await expect(
      resolveRequestPrincipal(event('/api/nvr'), { refuseNeedsPasswordSetup: true }),
    ).resolves.toBeNull()
  })

  it('reads a local session email as verified only from the verified-email record', async () => {
    state.backend = 'local'
    // A stale cookie field is not proof; the auth_verified_emails row is.
    state.user = sessionUser({ authBackend: 'local', emailConfirmedAt: '2026-09-01' })
    const { resolveRequestPrincipal } = await load()
    await expect(resolveRequestPrincipal(event('/x'))).resolves.toMatchObject({
      emailVerified: false,
    })
    state.verified.add('user-1:crew@example.com')
    await expect(resolveRequestPrincipal(event('/x'))).resolves.toMatchObject({
      emailVerified: true,
    })
  })

  it('reads a Supabase session email as verified from the Supabase confirmation', async () => {
    state.user = sessionUser({ emailConfirmedAt: null })
    const { resolveRequestPrincipal } = await load()
    await expect(resolveRequestPrincipal(event('/x'))).resolves.toMatchObject({
      emailVerified: false,
    })
  })

  describe('API keys', () => {
    const bearer = 'Bearer nk_abc123'

    beforeEach(() => {
      state.apiKey = {
        scopes: ['farm:read'],
        user: { email: 'agent@example.com', id: 'agent-1' },
      }
      state.user = sessionUser()
    })

    it('refuses an nk_ bearer by default, even alongside a session cookie', async () => {
      const { resolveRequestPrincipal } = await load()
      await expect(resolveRequestPrincipal(event('/x', 'GET', bearer))).resolves.toBeNull()
    })

    it('resolves the key with allowApiKey, ahead of the session', async () => {
      const { resolveRequestPrincipal } = await load()
      await expect(
        resolveRequestPrincipal(event('/x', 'GET', bearer), { allowApiKey: true }),
      ).resolves.toEqual({
        apiKeyScopes: ['farm:read'],
        email: 'agent@example.com',
        emailVerified: false,
        method: 'api-key',
        userId: 'agent-1',
      })
    })

    it('does not fall back to the session when the key does not authenticate', async () => {
      state.apiKey = null
      const { resolveRequestPrincipal } = await load()
      await expect(
        resolveRequestPrincipal(event('/x', 'GET', bearer), { allowApiKey: true }),
      ).resolves.toBeNull()
    })

    it('holds the key to requiredApiKeyScopes', async () => {
      const { resolveRequestPrincipal } = await load()
      await expect(
        resolveRequestPrincipal(event('/x', 'GET', bearer), {
          allowApiKey: true,
          requiredApiKeyScopes: ['farm:write'],
        }),
      ).resolves.toBeNull()
      await expect(
        resolveRequestPrincipal(event('/x', 'GET', bearer), {
          allowApiKey: true,
          requiredApiKeyScopes: ['farm:read'],
        }),
      ).resolves.toMatchObject({ userId: 'agent-1' })
      // A session is not held to key scopes, as with requireAuthScopes.
      await expect(
        resolveRequestPrincipal(event('/x'), {
          allowApiKey: true,
          requiredApiKeyScopes: ['farm:write'],
        }),
      ).resolves.toMatchObject({ method: 'session' })
    })
  })

  describe('native bearers', () => {
    beforeEach(() => {
      state.native = { sessionId: 'native-1', userId: 'user-2' }
      state.nativeUser = { email: 'app@example.com', id: 'user-2' }
      state.user = sessionUser()
    })

    it('ignores a native bearer unless allowNative is set', async () => {
      const { resolveRequestPrincipal } = await load()
      await expect(
        resolveRequestPrincipal(event('/x', 'GET', `Bearer ${NATIVE_TOKEN}`)),
      ).resolves.toMatchObject({ method: 'session', userId: 'user-1' })
    })

    it('resolves the native session with allowNative', async () => {
      const { resolveRequestPrincipal } = await load()
      await expect(
        resolveRequestPrincipal(event('/x', 'GET', `Bearer ${NATIVE_TOKEN}`), {
          allowNative: true,
        }),
      ).resolves.toEqual({
        apiKeyScopes: [],
        email: 'app@example.com',
        emailVerified: false,
        method: 'native',
        sessionId: 'native-1',
        userId: 'user-2',
      })
    })

    it('returns null for a native bearer that does not resolve', async () => {
      state.native = null
      const { resolveRequestPrincipal } = await load()
      await expect(
        resolveRequestPrincipal(event('/x', 'GET', `Bearer ${NATIVE_TOKEN}`), {
          allowNative: true,
        }),
      ).resolves.toBeNull()
    })
  })
})
