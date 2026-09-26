import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as SimpleWebauthnServer from '@simplewebauthn/server'
import type { H3Event } from 'h3'

/**
 * narduk-libs#1060: `@simplewebauthn/server` can load and still throw when a
 * ceremony first calls into it, for example a crypto primitive the runtime
 * lacks. #892 answers a load failure 503; this is the same misconfiguration
 * met one step later, so starting a ceremony answers the same 503 and logs the
 * cause, instead of an opaque 500. The finish ceremonies already map a
 * verification throw to their own 400 or 401.
 */

const CALL_FAILURE = vi.hoisted(() => 'crypto.subtle is not available in this runtime')

const logMocks = vi.hoisted(() => ({ error: vi.fn() }))

vi.mock('@simplewebauthn/server', async (importOriginal) => ({
  ...(await importOriginal<typeof SimpleWebauthnServer>()),
  generateAuthenticationOptions: () => Promise.reject(new Error(CALL_FAILURE)),
  generateRegistrationOptions: () => Promise.reject(new Error(CALL_FAILURE)),
}))

vi.mock('#layer/server/utils/logger', () => ({
  useLogger: () => ({
    child: () => ({
      debug: () => {},
      error: logMocks.error,
      info: () => {},
      warn: () => {},
    }),
  }),
}))

vi.mock('#layer/server/utils/database', () => ({
  executeDatabaseQuery: async () => [],
  getDatabaseRow: async () => null,
  useDatabase: () => ({}),
}))

vi.mock('#narduk-auth-server/utils/auth-bridge-database', () => ({
  useAuthBridgeDatabase: () => ({
    select: () => ({ from: () => ({ where: () => ({}) }) }),
  }),
}))

vi.mock('#narduk-auth-server/utils/auth-runtime-env', () => ({
  readAuthRuntimeEnv: () => ({
    AUTH_BACKEND: 'local',
    AUTH_LOCAL_PROVIDERS: 'passkey',
    AUTH_WEBAUTHN_ORIGIN: 'http://localhost',
    AUTH_WEBAUTHN_RP_ID: 'localhost',
  }),
  resolveAuthEnvironmentForEvent: () => ({
    appBackendPreset: 'default',
    authAuthorityUrl: '',
    authBackend: 'local',
    authProviders: ['email', 'passkey'],
    supabasePublishableKey: '',
    supabaseServiceRoleKey: '',
    supabaseUrl: '',
  }),
}))

vi.mock('../server/lib/app-auth/session', () => ({
  establishLocalSessionUser: vi.fn(),
}))

const challengeMocks = vi.hoisted(() => ({ issue: vi.fn() }))

vi.mock('../server/lib/app-auth/webauthn-challenges', () => ({
  consumeWebauthnChallenge: vi.fn(),
  issueWebauthnChallenge: challengeMocks.issue,
}))

const event = { context: {}, path: '/api/auth/passkeys/authentication/options' } as H3Event

const UNAVAILABLE = {
  statusCode: 503,
  statusMessage: 'Passkeys unavailable: server misconfiguration',
}

describe('passkey ceremonies when @simplewebauthn/server throws at call time (#1060)', () => {
  beforeEach(() => {
    logMocks.error.mockReset()
    challengeMocks.issue.mockReset()
  })

  it('answers 503 and logs the cause when starting sign-in', async () => {
    const { startPasskeyAuthentication } = await import('../server/lib/app-auth/webauthn-core')

    await expect(startPasskeyAuthentication(event)).rejects.toMatchObject(UNAVAILABLE)
    expect(logMocks.error).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(logMocks.error.mock.calls[0])).toContain(CALL_FAILURE)
    expect(challengeMocks.issue).not.toHaveBeenCalled()
  })

  it('answers 503 and logs the cause when starting registration', async () => {
    const { startPasskeyRegistration } = await import('../server/lib/app-auth/webauthn-core')

    await expect(
      startPasskeyRegistration(event, { email: 'parent@example.com', id: 'user-1' }),
    ).rejects.toMatchObject(UNAVAILABLE)
    expect(logMocks.error).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(logMocks.error.mock.calls[0])).toContain(CALL_FAILURE)
    expect(challengeMocks.issue).not.toHaveBeenCalled()
  })
})
