import { readFileSync } from 'node:fs'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'

import { drizzle } from 'drizzle-orm/d1'
import { createEvent } from 'h3'
import { Miniflare } from 'miniflare'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import appleRoute from '../server/api/auth/native/apple.post'
import appleNonceRoute from '../server/api/auth/native/apple/nonce.post'
import passkeyRoute from '../server/api/auth/native/passkey.post'
import { nativeAppleSchema, nativePasskeySchema } from '../server/lib/app-auth/native-validation'

/**
 * POST /api/auth/native/passkey and /api/auth/native/apple: a credential the
 * app proves in the request becomes a native session for a configured client,
 * never a cookie. The identity checks themselves (`verifyPasskeyAssertion`,
 * `verifyNativeAppleIdentity`, `resolveAppleIdentityUser`) are tested in the
 * webauthn and Apple suites; here they are stubs, and this proves the routes'
 * own boundary: client allowlist before any verification, local backend only,
 * the token answer, and no session cookie.
 */
const state = vi.hoisted(() => ({
  db: null as unknown,
  config: {
    authBackend: 'local',
    authNativeClients: [
      { id: 'ios', name: 'Test iPhone', redirectUris: ['com.example.test:/auth'] },
    ] as unknown[],
    public: { appUrl: 'http://localhost:3000' },
  },
  verifyPasskey: vi.fn(),
  verifyApple: vi.fn(),
  resolveApple: vi.fn(),
  consumeNonce: vi.fn(),
  issueNonce: vi.fn(),
  appleNativeEnabled: true,
}))
vi.mock('nitropack/runtime', () => ({ useRuntimeConfig: () => state.config }))
vi.mock('../server/utils/auth-bridge-database', () => ({ useAuthBridgeDatabase: () => state.db }))
vi.mock('#layer/server/utils/logger', () => ({
  useLogger: () => ({ child: () => ({ info: () => {}, warn: () => {}, error: () => {} }) }),
}))
vi.mock('../server/lib/app-auth/webauthn-core', () => ({
  verifyPasskeyAssertion: state.verifyPasskey,
}))
vi.mock('../server/lib/app-auth/auth-flows', () => ({
  verifyNativeAppleIdentity: state.verifyApple,
}))
vi.mock('../server/lib/app-auth/apple-local', () => ({
  resolveAppleIdentityUser: state.resolveApple,
}))
vi.mock('../server/lib/app-auth/native-apple-nonce', () => ({
  NATIVE_APPLE_NONCE_TTL_SECONDS: 300,
  consumeNativeAppleNonce: state.consumeNonce,
  issueNativeAppleNonce: state.issueNonce,
}))
vi.mock('../server/utils/auth-runtime-env', () => ({
  resolveAppleSignInForEvent: () => ({ nativeEnabled: state.appleNativeEnabled }),
}))

interface Handler {
  __handler: (context: unknown) => Promise<Record<string, unknown>>
}
const APPLE_PATH = '/api/auth/native/apple'
const PASSKEY_PATH = '/api/auth/native/passkey'
const NONCE_PATH = '/api/auth/native/apple/nonce'
const passkey = passkeyRoute as unknown as Handler
const apple = appleRoute as unknown as Handler
const appleNonce = appleNonceRoute as unknown as Handler

function event(path: string) {
  const req = new IncomingMessage(new Socket())
  req.url = path
  req.method = 'POST'
  req.headers = { host: 'localhost:3000' }
  return createEvent(req, new ServerResponse(req))
}

const ASSERTION = {
  id: 'cred-1',
  rawId: 'cred-1',
  type: 'public-key',
  clientExtensionResults: {},
  response: { authenticatorData: 'a', clientDataJSON: 'c', signature: 's' },
}
const APPLE_BODY = {
  identityToken: 'header.payload.signature',
  nonce: 'a'.repeat(64),
  displayName: 'Owner Name',
}

describe('native direct sign-in routes', () => {
  const runtime = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("ok") } }',
    compatibilityDate: '2026-07-01',
    d1Databases: ['DB'],
  })
  let binding: Awaited<ReturnType<Miniflare['getD1Database']>>

  beforeAll(async () => {
    binding = await runtime.getD1Database('DB')
    await binding.prepare('CREATE TABLE users (id TEXT PRIMARY KEY)').run()
    const migration = readFileSync(
      new URL('../drizzle/0004_native_auth.sql', import.meta.url),
      'utf8',
    )
    await binding.batch(
      migration
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => binding.prepare(s)),
    )
    await binding.prepare("INSERT INTO users VALUES ('owner')").run()
    state.db = drizzle(binding)
  })
  beforeEach(() => {
    state.config.authBackend = 'local'
    state.config.authNativeClients = [
      { id: 'ios', name: 'Test iPhone', redirectUris: ['com.example.test:/auth'] },
    ]
    state.verifyPasskey.mockReset().mockResolvedValue({ id: 'owner', passwordHash: 'hash' })
    state.verifyApple
      .mockReset()
      .mockResolvedValue({ appleId: 'apple-sub', email: null, emailVerified: false })
    state.consumeNonce.mockReset().mockResolvedValue(true)
    state.issueNonce.mockReset().mockResolvedValue('b'.repeat(64))
    state.appleNativeEnabled = true
    state.resolveApple.mockReset().mockResolvedValue({
      // An Apple-only account: no password. Logan (2026-11-15) allows it.
      user: { id: 'owner', passwordHash: null },
      emailConfirmedAt: null,
    })
  })
  afterAll(() => runtime.dispose())

  async function expectTokens(result: Record<string, unknown>, grant: string) {
    expect(result).toMatchObject({
      tokenType: 'Bearer',
      accessToken: expect.stringMatching(/^[\w-]{43}$/),
      refreshToken: expect.stringMatching(/^[\w-]{43}$/),
      expiresIn: 300,
      refreshExpiresAt: expect.any(Number),
      sessionId: expect.any(String),
    })
    const row = await binding
      .prepare('SELECT user_id, client_id, redirect_uri FROM auth_native_sessions WHERE id = ?')
      .bind(result.sessionId)
      .first()
    expect(row).toEqual({ user_id: 'owner', client_id: 'ios', redirect_uri: `native:${grant}` })
  }

  it('trades a verified passkey assertion for native tokens and sets no cookie', async () => {
    const e = event(PASSKEY_PATH)
    const result = await passkey.__handler({
      event: e,
      body: { clientId: 'ios', response: ASSERTION },
    })
    await expectTokens(result, 'passkey')
    expect(state.verifyPasskey).toHaveBeenCalledWith(e, ASSERTION)
    expect(e.node.res.getHeader('set-cookie')).toBeUndefined()
    expect(e.node.res.getHeader('cache-control')).toBe('private, no-store')
  })

  it('trades a verified Apple identity for native tokens, Apple-only account included', async () => {
    const e = event(APPLE_PATH)
    const result = await apple.__handler({ event: e, body: { clientId: 'ios', ...APPLE_BODY } })
    await expectTokens(result, 'apple')
    expect(state.consumeNonce).toHaveBeenCalledWith(e, APPLE_BODY.nonce)
    expect(state.verifyApple).toHaveBeenCalledWith(e, {
      identityToken: APPLE_BODY.identityToken,
      nonce: APPLE_BODY.nonce,
    })
    expect(state.resolveApple).toHaveBeenCalledWith(
      e,
      { appleId: 'apple-sub', email: null, emailVerified: false },
      { displayName: 'Owner Name' },
    )
    expect(e.node.res.getHeader('set-cookie')).toBeUndefined()
  })

  it('refuses an unconfigured client before verifying anything', async () => {
    await expect(
      passkey.__handler({
        event: event(PASSKEY_PATH),
        body: { clientId: 'other', response: ASSERTION },
      }),
    ).rejects.toMatchObject({ statusCode: 400 })
    await expect(
      apple.__handler({
        event: event(APPLE_PATH),
        body: { clientId: 'other', ...APPLE_BODY },
      }),
    ).rejects.toMatchObject({ statusCode: 400 })
    expect(state.verifyPasskey).not.toHaveBeenCalled()
    expect(state.consumeNonce).not.toHaveBeenCalled()
    expect(state.verifyApple).not.toHaveBeenCalled()
    expect(state.resolveApple).not.toHaveBeenCalled()
  })

  it('issues an Apple nonce only when native clients and native Apple are configured', async () => {
    expect(await appleNonce.__handler({ event: event(NONCE_PATH) })).toEqual({
      nonce: 'b'.repeat(64),
      expiresIn: 300,
    })
    state.appleNativeEnabled = false
    await expect(appleNonce.__handler({ event: event(NONCE_PATH) })).rejects.toMatchObject({
      statusCode: 501,
    })
    state.appleNativeEnabled = true
    state.config.authNativeClients = []
    await expect(appleNonce.__handler({ event: event(NONCE_PATH) })).rejects.toMatchObject({
      statusCode: 404,
    })
    expect(state.issueNonce).toHaveBeenCalledTimes(1)
  })

  it('refuses an Apple token whose nonce this server did not issue, before verifying it', async () => {
    state.consumeNonce.mockResolvedValue(false)
    await expect(
      apple.__handler({
        event: event(APPLE_PATH),
        body: { clientId: 'ios', ...APPLE_BODY },
      }),
    ).rejects.toMatchObject({
      statusCode: 401,
      statusMessage: 'Apple sign-in could not be verified.',
    })
    expect(state.verifyApple).not.toHaveBeenCalled()
    expect(state.resolveApple).not.toHaveBeenCalled()
  })

  it('answers every Apple token refusal with one generic 401 and passes other errors through', async () => {
    state.verifyApple.mockRejectedValueOnce(
      Object.assign(new Error('Apple sign-in could not be verified.'), {
        statusCode: 401,
        data: { code: 'apple_token_invalid', reason: 'wrong_audience' },
      }),
    )
    const refused = await apple
      .__handler({
        event: event(APPLE_PATH),
        body: { clientId: 'ios', ...APPLE_BODY },
      })
      .catch((error: unknown) => error as { data?: unknown; statusCode?: number })
    expect(refused).toMatchObject({ statusCode: 401 })
    expect(JSON.stringify(refused.data ?? null)).not.toContain('wrong_audience')
    state.verifyApple.mockRejectedValueOnce(
      Object.assign(new Error('Native Apple sign-in is not configured.'), { statusCode: 501 }),
    )
    await expect(
      apple.__handler({
        event: event(APPLE_PATH),
        body: { clientId: 'ios', ...APPLE_BODY },
      }),
    ).rejects.toMatchObject({ statusCode: 501 })
  })

  it('answers 404 with no native clients and 503 off the local backend, verifying nothing', async () => {
    state.config.authNativeClients = []
    await expect(
      passkey.__handler({
        event: event(PASSKEY_PATH),
        body: { clientId: 'ios', response: ASSERTION },
      }),
    ).rejects.toMatchObject({ statusCode: 404 })
    state.config.authNativeClients = [
      { id: 'ios', name: 'Test iPhone', redirectUris: ['com.example.test:/auth'] },
    ]
    state.config.authBackend = 'supabase'
    await expect(
      apple.__handler({
        event: event(APPLE_PATH),
        body: { clientId: 'ios', ...APPLE_BODY },
      }),
    ).rejects.toMatchObject({ statusCode: 503 })
    expect(state.verifyPasskey).not.toHaveBeenCalled()
    expect(state.verifyApple).not.toHaveBeenCalled()
  })

  it('bounds the request bodies', () => {
    expect(nativePasskeySchema.safeParse({ clientId: 'ios', response: ASSERTION }).success).toBe(
      true,
    )
    expect(
      nativePasskeySchema.safeParse({
        clientId: 'ios',
        response: { ...ASSERTION, rawId: 'cred-2' },
      }).success,
    ).toBe(false)
    expect(nativeAppleSchema.safeParse({ clientId: 'ios', ...APPLE_BODY }).success).toBe(true)
    expect(nativeAppleSchema.safeParse({ clientId: 'ios', identityToken: 'x.y.z' }).success).toBe(
      false,
    )
    expect(
      nativeAppleSchema.safeParse({ clientId: 'ios', ...APPLE_BODY, nonce: 'short' }).success,
    ).toBe(false)
    expect(
      nativeAppleSchema.safeParse({ clientId: 'ios', ...APPLE_BODY, nonce: 'A'.repeat(64) })
        .success,
    ).toBe(false)
    expect(nativeAppleSchema.parse({ clientId: 'ios', ...APPLE_BODY, displayName: null })).toEqual(
      expect.objectContaining({ displayName: null }),
    )
  })

  it('issues nothing when the credential is refused', async () => {
    const before = await binding.prepare('SELECT COUNT(*) AS n FROM auth_native_sessions').first()
    state.verifyPasskey.mockRejectedValue(
      Object.assign(new Error('Passkey sign-in failed.'), { statusCode: 401 }),
    )
    await expect(
      passkey.__handler({
        event: event(PASSKEY_PATH),
        body: { clientId: 'ios', response: ASSERTION },
      }),
    ).rejects.toMatchObject({ statusCode: 401 })
    state.verifyApple.mockRejectedValue(
      Object.assign(new Error('Apple sign-in failed.'), {
        statusCode: 401,
        data: { reason: 'nonce_mismatch' },
      }),
    )
    await expect(
      apple.__handler({
        event: event(APPLE_PATH),
        body: { clientId: 'ios', ...APPLE_BODY },
      }),
    ).rejects.toMatchObject({ statusCode: 401 })
    expect(state.resolveApple).not.toHaveBeenCalled()
    const after = await binding.prepare('SELECT COUNT(*) AS n FROM auth_native_sessions').first()
    expect(after).toEqual(before)
  })
})
