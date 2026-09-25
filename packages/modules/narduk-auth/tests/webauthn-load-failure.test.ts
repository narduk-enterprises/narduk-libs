import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { H3Event } from 'h3'

/**
 * narduk-libs#892: when `@simplewebauthn/server` fails to load (#786 was
 * tsyringe throwing at module evaluation without a Reflect polyfill), every
 * passkey route answered an opaque 500 and nothing named the cause. The
 * library now loads lazily; a load failure answers 503 with a fixed message
 * and logs the cause.
 */

const LOAD_FAILURE = vi.hoisted(
  () =>
    'tsyringe requires a reflect polyfill. Please add \'import "reflect-metadata"\' to the top of your entry point.',
)

const logMocks = vi.hoisted(() => ({ error: vi.fn() }))

vi.mock('@simplewebauthn/server', () => {
  throw new Error(LOAD_FAILURE)
})

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

const event = { context: {}, path: '/api/auth/passkeys/authentication/options' } as H3Event

describe('passkey routes when @simplewebauthn/server fails to load (#892)', () => {
  beforeEach(() => {
    logMocks.error.mockReset()
  })

  it('answers 503 with a fixed message instead of an opaque 500', async () => {
    const { startPasskeyAuthentication } = await import('../server/lib/app-auth/webauthn-core')

    await expect(startPasskeyAuthentication(event)).rejects.toMatchObject({
      statusCode: 503,
      statusMessage: 'Passkeys unavailable: server misconfiguration',
    })
  })

  it('logs the load failure cause', async () => {
    const { startPasskeyRegistration } = await import('../server/lib/app-auth/webauthn-core')

    await expect(
      startPasskeyRegistration(event, {
        authMethod: 'session',
        email: 'parent@example.com',
        id: 'user-1',
        isAdmin: false,
        name: 'Parent',
      }),
    ).rejects.toMatchObject({ statusCode: 503 })

    expect(logMocks.error).toHaveBeenCalledTimes(1)
    const [message, details] = logMocks.error.mock.calls[0] ?? []
    expect(message).toMatch(/@simplewebauthn\/server/u)
    expect(JSON.stringify(details)).toContain('tsyringe requires a reflect polyfill')
  })

  it('still loads the pure ceremony helpers, which never touch the library', async () => {
    const { readPresentedChallenge } = await import('../server/lib/app-auth/webauthn-verification')
    const clientDataJSON = Buffer.from(JSON.stringify({ challenge: 'Q0hBTExFTkdF' }))
      .toString('base64')
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replaceAll('=', '')

    expect(readPresentedChallenge(clientDataJSON)).toBe('Q0hBTExFTkdF')
  })
})
