import { describe, expect, it, vi } from 'vitest'

import type { H3Event } from 'h3'

/**
 * narduk-libs#1048: MFA is a Supabase feature. On the local backend the MFA
 * routes read a Supabase session that never exists there, and answered the
 * 401 "does not have an active shared auth session", which tells the user to
 * sign in again when nothing they do can fix it. They now answer 501, as the
 * OAuth start does on the local backend, before any session is read.
 */

const getCurrentSupabaseContext = vi.hoisted(() =>
  vi.fn(async () => {
    throw Object.assign(new Error('This account does not have an active shared auth session.'), {
      statusCode: 401,
    })
  }),
)

vi.mock('nitropack/runtime', () => ({
  useRuntimeConfig: () => ({ public: { appName: 'Test' } }),
}))

vi.mock('#layer/server/utils/user-session', () => ({
  replaceLayerUserSession: vi.fn(),
}))

vi.mock('../server/lib/app-auth/session', () => ({
  commitSupabaseSessionFromClient: vi.fn(),
  getCurrentSessionUser: async () => null,
  getCurrentSupabaseContext,
}))

vi.mock('../server/lib/app-auth/supabase-client', () => ({
  getAuthConfig: () => ({ backend: 'local' }),
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

const event = { context: {}, path: '/api/auth/mfa/enroll' } as H3Event

const UNSUPPORTED = {
  statusCode: 501,
  statusMessage: 'MFA is only available when Supabase auth is enabled.',
}

describe('MFA on the local backend (#1048)', () => {
  it('answers enrollment with 501, not the Supabase-session 401', async () => {
    const { enrollMfa } = await import('../server/lib/app-auth/profile')

    await expect(enrollMfa(event, 'Phone')).rejects.toMatchObject(UNSUPPORTED)
    expect(getCurrentSupabaseContext).not.toHaveBeenCalled()
  })

  it('answers verification with 501, not the Supabase-session 401', async () => {
    const { verifyMfa } = await import('../server/lib/app-auth/profile')

    await expect(verifyMfa(event, { factorId: 'factor-1', code: '123456' })).rejects.toMatchObject(
      UNSUPPORTED,
    )
    expect(getCurrentSupabaseContext).not.toHaveBeenCalled()
  })
})
