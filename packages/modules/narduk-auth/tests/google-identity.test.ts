import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  GOOGLE_JWKS_URL,
  resetGoogleJwksCache,
  verifyGoogleIdToken,
} from '../server/lib/app-auth/google-identity'
import { sha256Hex } from '../server/lib/app-auth/jwt-rs256'
import { resolveAuthEnvironment } from '../shared/utils/auth-environment'
import { resolveGoogleSignInConfig } from '../shared/utils/google-sign-in-config'

import { createFakeGoogleIssuer, FAKE_GOOGLE_KID } from './fixtures/fake-google-issuer'

/** narduk-libs#1951: Google ID-token verification and the provider switch. */

const CLIENT_ID = 'unit-client.apps.googleusercontent.com'
const RAW_NONCE = 'raw-nonce-1'

describe('verifyGoogleIdToken', () => {
  let issuer: Awaited<ReturnType<typeof createFakeGoogleIssuer>>
  const fetchJwks = vi.fn()

  beforeEach(async () => {
    resetGoogleJwksCache()
    issuer = await createFakeGoogleIssuer({ clientId: CLIENT_ID, clientSecret: 'unused' })
    fetchJwks.mockReset()
    fetchJwks.mockResolvedValue({ keys: [issuer.publicJwk] })
  })

  async function claims(overrides: Record<string, unknown> = {}) {
    const now = Math.floor(Date.now() / 1000)
    return {
      iss: 'https://accounts.google.com',
      aud: CLIENT_ID,
      sub: '1234567890',
      email: 'Pat@Example.com',
      email_verified: true,
      name: ' Pat ',
      iat: now,
      exp: now + 600,
      nonce: await sha256Hex(RAW_NONCE),
      ...overrides,
    }
  }

  const verify = (token: string, rawNonce = RAW_NONCE) =>
    verifyGoogleIdToken(token, { clientId: CLIENT_ID, rawNonce, fetchJwks })

  it('accepts a good token and normalizes its claims', async () => {
    await expect(verify(await issuer.signIdToken(await claims()))).resolves.toEqual({
      googleSub: '1234567890',
      email: 'pat@example.com',
      emailVerified: true,
      name: 'Pat',
    })
  })

  it('accepts the bare accounts.google.com issuer and an aud array naming the client', async () => {
    const token = await issuer.signIdToken(
      await claims({ iss: 'accounts.google.com', aud: ['other', CLIENT_ID], azp: CLIENT_ID }),
    )
    await expect(verify(token)).resolves.toMatchObject({ googleSub: '1234567890' })
  })

  it.each([
    ['bad aud', { aud: 'other.apps.googleusercontent.com' }, 'wrong_audience'],
    ['bad issuer', { iss: 'https://appleid.apple.com' }, 'wrong_issuer'],
    ['expired', { exp: Math.floor(Date.now() / 1000) - 3600 }, 'expired'],
    ['issued in the future', { iat: Math.floor(Date.now() / 1000) + 3600 }, 'issued_in_future'],
    ['no subject', { sub: '' }, 'missing_subject'],
    ['multi-audience without azp', { aud: ['other', CLIENT_ID] }, 'wrong_authorized_party'],
    ['foreign azp', { azp: 'other.apps.googleusercontent.com' }, 'wrong_authorized_party'],
  ])('refuses a %s token', async (_label, overrides, reason) => {
    await expect(verify(await issuer.signIdToken(await claims(overrides)))).rejects.toMatchObject({
      statusCode: 401,
      data: { code: 'google_token_invalid', reason },
    })
  })

  it('refuses a token minted for another nonce', async () => {
    await expect(
      verify(await issuer.signIdToken(await claims()), 'another-raw-nonce'),
    ).rejects.toMatchObject({ data: { reason: 'nonce_mismatch' } })
  })

  it('refuses a bad signature, an unsigned token and an unknown key', async () => {
    const good = await issuer.signIdToken(await claims())
    const [header, payload] = good.split('.')
    const tampered = `${header}.${Buffer.from(JSON.stringify(await claims({ sub: 'someone-else' }))).toString('base64url')}.${good.split('.')[2]}`
    await expect(verify(tampered)).rejects.toMatchObject({ data: { reason: 'bad_signature' } })
    const none = `${Buffer.from(JSON.stringify({ alg: 'none', kid: FAKE_GOOGLE_KID })).toString('base64url')}.${payload}.`
    await expect(verify(none)).rejects.toMatchObject({ data: { reason: 'unsupported_alg' } })
    const otherKid = `${Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'rotated-away' })).toString('base64url')}.${payload}.${good.split('.')[2]}`
    await expect(verify(otherKid)).rejects.toMatchObject({ data: { reason: 'unknown_key' } })
    await expect(verify('not-a-jwt')).rejects.toMatchObject({ data: { reason: 'malformed' } })
  })

  it('does not refetch the key set for every forged kid', async () => {
    const good = await issuer.signIdToken(await claims())
    await verify(good)
    const [, payload, signature] = good.split('.')
    for (let index = 0; index < 5; index += 1) {
      const forged = `${Buffer.from(JSON.stringify({ alg: 'RS256', kid: `forged-${index}` })).toString('base64url')}.${payload}.${signature}`
      await expect(verify(forged)).rejects.toMatchObject({ data: { reason: 'unknown_key' } })
    }
    expect(fetchJwks).toHaveBeenCalledTimes(1)
  })

  it('answers 503 when Google keys cannot be fetched', async () => {
    fetchJwks.mockRejectedValue(new Error('offline'))
    await expect(verify(await issuer.signIdToken(await claims()))).rejects.toMatchObject({
      statusCode: 503,
    })
  })

  it('fetches from Google by default', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ keys: [issuer.publicJwk] })))
    vi.stubGlobal('fetch', fetch)
    try {
      await verifyGoogleIdToken(await issuer.signIdToken(await claims()), {
        clientId: CLIENT_ID,
        rawNonce: RAW_NONCE,
      })
      expect(fetch).toHaveBeenCalledWith(GOOGLE_JWKS_URL, expect.anything())
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('resolveGoogleSignInConfig', () => {
  const env = { AUTH_GOOGLE_CLIENT_ID: ' id ', AUTH_GOOGLE_CLIENT_SECRET: 'secret' }

  it('on local needs the provider advertised and both client values', () => {
    expect(
      resolveGoogleSignInConfig({ authBackend: 'local', authProviders: ['email', 'google'], env }),
    ).toEqual({ clientId: 'id', clientSecret: 'secret', webEnabled: true })
    expect(
      resolveGoogleSignInConfig({ authBackend: 'local', authProviders: ['email'], env }).webEnabled,
    ).toBe(false)
    for (const partial of [{ AUTH_GOOGLE_CLIENT_ID: 'id' }, { AUTH_GOOGLE_CLIENT_SECRET: 's' }]) {
      expect(
        resolveGoogleSignInConfig({
          authBackend: 'local',
          authProviders: ['email', 'google'],
          env: partial,
        }).webEnabled,
      ).toBe(false)
    }
  })

  it('on Supabase follows the advertised provider', () => {
    expect(
      resolveGoogleSignInConfig({ authBackend: 'supabase', authProviders: ['google'], env: {} })
        .webEnabled,
    ).toBe(true)
  })

  it('lets AUTH_LOCAL_PROVIDERS advertise google on the local backend', () => {
    expect(
      resolveAuthEnvironment({ AUTH_BACKEND: 'local', AUTH_LOCAL_PROVIDERS: 'google,passkey' })
        .authProviders,
    ).toEqual(['email', 'google', 'passkey'])
  })
})
