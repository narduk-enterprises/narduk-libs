import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AppSessionUser } from '../server/lib/app-auth/types'
import type { H3Event } from 'h3'

const replaceLayerUserSession = vi.hoisted(() => vi.fn())
const commitSupabaseSessionFromClient = vi.hoisted(() =>
  vi.fn(async () => ({ aal: 'aal2' as const })),
)

vi.mock('nitropack/runtime', () => ({
  useRuntimeConfig: () => ({ public: { appName: 'Test' } }),
}))

vi.mock('#layer/server/utils/user-session', () => ({
  replaceLayerUserSession,
}))

vi.mock('../server/lib/app-auth/session', () => ({
  commitSupabaseSessionFromClient,
  getCurrentSessionUser: async () => null,
  getCurrentSupabaseContext: async () => ({
    client: {
      mfa: {
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
})
