import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { H3Event } from 'h3'

const RESET_PATH = vi.hoisted(() => '/reset-password')

const state = vi.hoisted(() => ({
  ensureOptions: [] as unknown[],
  persistRecovery: [] as Array<boolean | undefined>,
  publicSignup: false,
  resetPath: RESET_PATH,
}))

vi.mock('../server/lib/app-auth/linking', () => ({
  ensureLinkedLocalUser: async (
    _event: H3Event,
    _user: unknown,
    options: Record<string, unknown> = {},
  ) => {
    state.ensureOptions.push(options)
    return {
      id: 'local-1',
      email: 'parent@example.com',
      name: 'Parent',
      isAdmin: false,
    }
  },
}))

vi.mock('../server/lib/app-auth/session', () => ({
  persistSupabaseSession: async (_event: H3Event, params: { recoveryMode?: boolean }) => {
    state.persistRecovery.push(params.recoveryMode)
    return {
      authSessionId: 'sess-1',
      aal: 'aal1',
      providers: ['email'],
      authProvider: 'email',
      emailConfirmedAt: null,
      needsPasswordSetup: false,
      recoveryMode: Boolean(params.recoveryMode),
    }
  },
  setCurrentSessionUser: vi.fn(),
  clearCurrentSession: vi.fn(),
  establishLocalSessionUser: vi.fn(),
  getCurrentSessionUser: vi.fn(),
  getCurrentSupabaseContext: vi.fn(),
}))

vi.mock('../server/lib/app-auth/supabase-client', () => ({
  getAuthConfig: () => ({
    backend: 'supabase',
    publicSignup: state.publicSignup,
    providers: ['apple'],
    appUrl: 'https://app.test',
    callbackPath: '/auth/callback',
    resetPath: state.resetPath,
    redirectPath: '/dashboard/',
    confirmPath: '/auth/confirm',
  }),
  isSupabaseConfigured: () => true,
  createSupabaseUserClient: () => ({
    signInWithIdToken: async () => ({
      data: {
        user: { id: 'auth-1', email: 'parent@example.com', app_metadata: {}, user_metadata: {} },
        session: {
          access_token: 't',
          refresh_token: 'r',
          expires_in: 3600,
          user: { id: 'auth-1' },
        },
      },
      error: null,
    }),
    exchangeCodeForSession: async () => ({
      data: {
        user: { id: 'auth-1', email: 'parent@example.com', app_metadata: {}, user_metadata: {} },
        session: {
          access_token: 't',
          refresh_token: 'r',
          expires_in: 3600,
          user: { id: 'auth-1' },
        },
      },
      error: null,
    }),
    verifyOtp: async () => ({
      data: {
        user: { id: 'auth-1', email: 'parent@example.com', app_metadata: {}, user_metadata: {} },
        session: {
          access_token: 't',
          refresh_token: 'r',
          expires_in: 3600,
          user: { id: 'auth-1' },
        },
      },
      error: null,
    }),
  }),
  createSupabaseClient: vi.fn(),
  toSupabaseHttpError: (error: unknown) => {
    throw error
  },
}))

vi.mock('../server/utils/verified-email', () => ({
  getLocalEmailVerification: async () => null,
}))

function event(): H3Event {
  return { context: {}, path: '/api/auth/session/exchange' } as H3Event
}

describe('closed signup and recovery linking', () => {
  beforeEach(() => {
    state.ensureOptions = []
    state.persistRecovery = []
    state.publicSignup = false
    vi.resetModules()
  })

  it('requires an existing link for native Apple when public signup is closed', async () => {
    const { signInWithNativeApple } = await import('../server/lib/app-auth/auth-flows')

    await signInWithNativeApple(event(), { identityToken: 'identity-token' })

    expect(state.ensureOptions).toEqual([{ requireExistingLink: true }])
  })

  it('never creates a local user on a recovery exchange', async () => {
    const { exchangeSupabaseCode } = await import('../server/lib/app-auth/auth-flows')

    await exchangeSupabaseCode(event(), {
      code: 'pkce-code',
      redirectType: 'recovery',
      next: RESET_PATH,
    })

    expect(state.ensureOptions).toEqual([{ requireExistingUser: true, requireExistingLink: true }])
    expect(state.persistRecovery).toEqual([true])
  })

  it('does not treat a PKCE login whose next is the reset page as recovery', async () => {
    const { exchangeSupabaseCode } = await import('../server/lib/app-auth/auth-flows')

    await exchangeSupabaseCode(event(), {
      code: 'pkce-code',
      next: RESET_PATH,
    })

    expect(state.ensureOptions).toEqual([{ requireExistingLink: true }])
    expect(state.persistRecovery).toEqual([false])
  })

  it('keeps invite as the closed-signup exception and does not set recovery_mode', async () => {
    const { exchangeSupabaseCode } = await import('../server/lib/app-auth/auth-flows')

    await exchangeSupabaseCode(event(), {
      tokenHash: 'digest',
      verificationType: 'invite',
    })

    expect(state.ensureOptions).toEqual([{ requireExistingLink: false }])
    expect(state.persistRecovery).toEqual([false])
  })

  it('still requires an existing link for a normal PKCE exchange when signup is closed', async () => {
    const { exchangeSupabaseCode } = await import('../server/lib/app-auth/auth-flows')

    await exchangeSupabaseCode(event(), {
      code: 'pkce-code',
      next: '/dashboard/',
    })

    expect(state.ensureOptions).toEqual([{ requireExistingLink: true }])
    expect(state.persistRecovery).toEqual([false])
  })
})

describe('password-recovery exchange detection', () => {
  it('recognizes type, token_hash recovery, and reset-path next', async () => {
    const { resolvePasswordRecoveryExchange } = await import('../server/lib/app-auth/auth-flows')

    expect(
      resolvePasswordRecoveryExchange({
        redirectType: 'recovery',
        resetPath: RESET_PATH,
      }),
    ).toBe(true)
    expect(
      resolvePasswordRecoveryExchange({
        verificationType: 'password_recovery',
        resetPath: RESET_PATH,
      }),
    ).toBe(true)
    expect(
      resolvePasswordRecoveryExchange({
        next: RESET_PATH,
        resetPath: RESET_PATH,
      }),
    ).toBe(true)
    expect(
      resolvePasswordRecoveryExchange({
        hasAuthCode: true,
        next: RESET_PATH,
        resetPath: RESET_PATH,
      }),
    ).toBe(false)
    expect(
      resolvePasswordRecoveryExchange({
        next: '/dashboard/',
        resetPath: RESET_PATH,
      }),
    ).toBe(false)
  })
})
