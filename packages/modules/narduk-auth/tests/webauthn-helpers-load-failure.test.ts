import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { H3Event } from 'h3'

/**
 * narduk-libs#1060: `webauthn-load-failure.test.ts` with the failure moved to
 * the second entry the loader imports, `@simplewebauthn/server/helpers`. It
 * reaches the same `@peculiar/x509` → `tsyringe` chain, so it can fail the
 * same way, and must answer the same 503.
 */

const LOAD_FAILURE = vi.hoisted(
  () =>
    'tsyringe requires a reflect polyfill. Please add \'import "reflect-metadata"\' to the top of your entry point.',
)

const logMocks = vi.hoisted(() => ({ error: vi.fn() }))

vi.mock('@simplewebauthn/server/helpers', () => {
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

describe('passkey routes when @simplewebauthn/server/helpers fails to load (#1060)', () => {
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

  // narduk-libs#1060: the finish ceremonies load the library before reading
  // the response, so a load failure answers 503 before anything else runs.
  it('answers 503 on both finish ceremonies too', async () => {
    const { finishPasskeyAuthentication, finishPasskeyRegistration } =
      await import('../server/lib/app-auth/webauthn-core')
    const unavailable = {
      statusCode: 503,
      statusMessage: 'Passkeys unavailable: server misconfiguration',
    }
    const response = { id: 'cred-1', response: { clientDataJSON: 'e30' } }

    await expect(finishPasskeyAuthentication(event, response as never)).rejects.toMatchObject(
      unavailable,
    )
    await expect(
      finishPasskeyRegistration(
        event,
        { email: 'parent@example.com', id: 'user-1' },
        { response: response as never },
      ),
    ).rejects.toMatchObject(unavailable)
    expect(logMocks.error).toHaveBeenCalledTimes(2)
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
