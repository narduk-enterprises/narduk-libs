import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AppSessionUser } from '../server/lib/app-auth/types'
import type { H3Event } from 'h3'

const replaceLayerUserSession = vi.hoisted(() => vi.fn())
const commitSupabaseSessionFromClient = vi.hoisted(() =>
  vi.fn(async () => ({ aal: 'aal2' as const })),
)
const revokeUserAuthSessions = vi.hoisted(() => vi.fn(async () => {}))
const revokeNativeUser = vi.hoisted(() => vi.fn(async () => {}))
const factors = vi.hoisted(() => ({
  listFactors: vi.fn(
    async (): Promise<{
      data: { all: Array<{ id: string; status: string }> } | null
      error: unknown
    }> => ({
      data: { all: [{ id: 'factor-1', status: 'verified' }] },
      error: null,
    }),
  ),
  nativeClients: [] as string[],
}))

vi.mock('nitropack/runtime', () => ({
  useRuntimeConfig: () => ({
    public: { appName: 'Test' },
    authNativeClients: factors.nativeClients,
  }),
}))

vi.mock('../server/utils/native-auth', () => ({
  useNativeAuth: () => ({ revokeUser: revokeNativeUser }),
}))

vi.mock('#layer/server/utils/user-session', () => ({
  replaceLayerUserSession,
}))

vi.mock('../server/lib/app-auth/session', () => ({
  commitSupabaseSessionFromClient,
  getCurrentSessionUser: async () => null,
  revokeUserAuthSessions,
  getCurrentSupabaseContext: async () => ({
    client: {
      mfa: {
        listFactors: factors.listFactors,
        challengeAndVerify: async () => ({
          data: { user: { id: 'auth-1' } },
          error: null,
        }),
      },
    },
    localUser: { id: 'user-1' },
    authUser: { id: 'auth-1' },
    authSessionId: 'sess-1',
    sessionUser: {
      id: 'user-1',
      email: 'parent@example.com',
      name: 'Parent',
      isAdmin: false,
      authBackend: 'supabase',
      aal: 'aal1',
    } satisfies AppSessionUser,
  }),
}))

vi.mock('../server/lib/app-auth/supabase-client', () => ({
  getAuthConfig: () => ({ backend: 'supabase' }),
  readRuntimeConfigString: (value: unknown, fallback = '') =>
    typeof value === 'string' ? value : fallback,
  toSupabaseHttpError: (error: unknown) => {
    throw error
  },
}))

vi.mock('../server/lib/app-auth/linking', () => ({
  ensureLinkedLocalUser: vi.fn(),
}))

vi.mock('../server/lib/app-auth/helpers', () => ({
  encodeQrCodeDataUrl: (value: string) => value,
}))

describe('verifyMfa stamps aal2', () => {
  beforeEach(() => {
    replaceLayerUserSession.mockClear()
    commitSupabaseSessionFromClient.mockClear()
    commitSupabaseSessionFromClient.mockResolvedValue({ aal: 'aal2' })
    revokeUserAuthSessions.mockClear()
    revokeNativeUser.mockClear()
    factors.listFactors.mockClear()
    factors.nativeClients = []
  })

  it('writes aal2 onto the sealed session after a successful challenge', async () => {
    const { verifyMfa } = await import('../server/lib/app-auth/profile')

    await expect(
      verifyMfa({ context: {}, path: '/api/auth/mfa/verify' } as H3Event, {
        factorId: 'factor-1',
        code: '123456',
      }),
    ).resolves.toEqual({ success: true, aal: 'aal2' })

    expect(replaceLayerUserSession).toHaveBeenCalledWith(expect.anything(), {
      user: expect.objectContaining({ aal: 'aal2' }),
    })
  })

  it('revokes nothing on a login step-up with an already-verified factor', async () => {
    const { verifyMfa } = await import('../server/lib/app-auth/profile')

    await verifyMfa({ context: {} } as H3Event, { factorId: 'factor-1', code: '123456' })

    expect(revokeUserAuthSessions).not.toHaveBeenCalled()
    expect(revokeNativeUser).not.toHaveBeenCalled()
  })
})

describe('verifyMfa completing an enrollment ends the other sessions (#1043)', () => {
  beforeEach(() => {
    revokeUserAuthSessions.mockClear()
    revokeNativeUser.mockClear()
    factors.nativeClients = []
  })

  it('revokes every other session, keeping this browser, when the factor was unverified', async () => {
    factors.listFactors.mockResolvedValueOnce({
      data: { all: [{ id: 'factor-1', status: 'unverified' }] },
      error: null,
    })
    const { verifyMfa } = await import('../server/lib/app-auth/profile')

    await verifyMfa({ context: {} } as H3Event, { factorId: 'factor-1', code: '123456' })

    expect(revokeUserAuthSessions).toHaveBeenCalledWith(expect.anything(), 'user-1', {
      exceptSessionId: 'sess-1',
    })
    expect(revokeNativeUser).not.toHaveBeenCalled()
  })

  it('also revokes native-client tokens when the app has native clients', async () => {
    factors.nativeClients = ['ios']
    factors.listFactors.mockResolvedValueOnce({
      data: { all: [{ id: 'factor-1', status: 'unverified' }] },
      error: null,
    })
    const { verifyMfa } = await import('../server/lib/app-auth/profile')

    await verifyMfa({ context: {} } as H3Event, { factorId: 'factor-1', code: '123456' })

    expect(revokeNativeUser).toHaveBeenCalledWith('user-1')
  })

  it('fails closed: an unreadable factor list counts as an enrollment', async () => {
    factors.listFactors.mockResolvedValueOnce({ data: null, error: new Error('down') })
    const { verifyMfa } = await import('../server/lib/app-auth/profile')

    await verifyMfa({ context: {} } as H3Event, { factorId: 'factor-1', code: '123456' })

    expect(revokeUserAuthSessions).toHaveBeenCalledTimes(1)
  })
})
