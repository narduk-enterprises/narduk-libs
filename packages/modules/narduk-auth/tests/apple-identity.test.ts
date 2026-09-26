import { beforeEach, describe, expect, it } from 'vitest'

import {
  APPLE_ISSUER,
  hashAppleNonce,
  resetAppleJwksCache,
  verifyAppleIdentityToken,
} from '../server/lib/app-auth/apple-identity'

import { appleTestKeys, signAppleToken } from './fixtures/apple-tokens'

const SERVICES_ID = 'com.example.web'
const RAW_NONCE = 'raw-nonce-123'
const NOW = new Date('2026-09-25T12:00:00.000Z')
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000)

async function claims(overrides: Record<string, unknown> = {}) {
  return {
    iss: APPLE_ISSUER,
    aud: SERVICES_ID,
    sub: '001234.abcd',
    iat: NOW_SECONDS - 10,
    exp: NOW_SECONDS + 600,
    nonce: await hashAppleNonce(RAW_NONCE),
    email: 'Person@Example.com',
    email_verified: 'true',
    ...overrides,
  }
}

describe('verifyAppleIdentityToken (narduk-libs#164)', () => {
  beforeEach(() => {
    resetAppleJwksCache()
  })

  async function verify(token: string, fetches = { count: 0 }, audiences = [SERVICES_ID]) {
    const keys = await appleTestKeys()
    return verifyAppleIdentityToken(token, {
      audiences,
      rawNonce: RAW_NONCE,
      now: NOW,
      fetchJwks: async () => {
        fetches.count += 1
        return { keys: [keys.publicJwk] }
      },
    })
  }

  it('accepts a token Apple signed for this app and this nonce', async () => {
    await expect(verify(await signAppleToken(await claims()))).resolves.toEqual({
      appleId: '001234.abcd',
      email: 'person@example.com',
      emailVerified: true,
      isPrivateEmail: false,
    })
  })

  it('caches the JWKS between verifications', async () => {
    const fetches = { count: 0 }
    const token = await signAppleToken(await claims())
    await verify(token, fetches)
    await verify(token, fetches)
    expect(fetches.count).toBe(1)
  })

  it.each([
    ['another audience', { aud: 'com.other.app' }, 'wrong_audience'],
    ['another issuer', { iss: 'https://evil.example' }, 'wrong_issuer'],
    ['an expired token', { exp: NOW_SECONDS - 120 }, 'expired'],
    ['a future iat', { iat: NOW_SECONDS + 3600 }, 'issued_in_future'],
    ['a token for another nonce', { nonce: 'deadbeef' }, 'nonce_mismatch'],
    ['a raw (unhashed) nonce', { nonce: RAW_NONCE }, 'nonce_mismatch'],
    ['no subject', { sub: '' }, 'missing_subject'],
  ])('refuses %s', async (_label, overrides, reason) => {
    await expect(verify(await signAppleToken(await claims(overrides)))).rejects.toMatchObject({
      statusCode: 401,
      data: { code: 'apple_token_invalid', reason },
    })
  })

  it('refuses a token signed by a key Apple does not publish under that kid', async () => {
    const forged = await signAppleToken(await claims(), { forge: true })
    await expect(verify(forged)).rejects.toMatchObject({ data: { reason: 'bad_signature' } })
  })

  it('refuses an unknown kid and alg none', async () => {
    await expect(
      verify(await signAppleToken(await claims(), { kid: 'nope' })),
    ).rejects.toMatchObject({ data: { reason: 'unknown_key' } })
    const [, payload] = (await signAppleToken(await claims())).split('.')
    const header = Buffer.from(JSON.stringify({ alg: 'none', kid: 'test-key' })).toString(
      'base64url',
    )
    await expect(verify(`${header}.${payload}.`)).rejects.toMatchObject({
      data: { reason: 'unsupported_alg' },
    })
  })

  it('accepts an audience list and reads an unverified email as unverified', async () => {
    const token = await signAppleToken(
      await claims({ aud: 'com.example.ios', email_verified: false, is_private_email: 'true' }),
    )
    await expect(verify(token, { count: 0 }, ['com.example.ios'])).resolves.toMatchObject({
      emailVerified: false,
      isPrivateEmail: true,
    })
  })

  it('refuses when no audience is configured or no nonce is bound', async () => {
    const token = await signAppleToken(await claims())
    await expect(verify(token, { count: 0 }, [])).rejects.toMatchObject({
      data: { reason: 'no_audience_configured' },
    })
    await expect(
      verifyAppleIdentityToken(token, { audiences: [SERVICES_ID], rawNonce: '', now: NOW }),
    ).rejects.toMatchObject({ data: { reason: 'nonce_missing' } })
  })

  it('answers 503 when Apple keys cannot be fetched', async () => {
    await expect(
      verifyAppleIdentityToken(await signAppleToken(await claims()), {
        audiences: [SERVICES_ID],
        rawNonce: RAW_NONCE,
        now: NOW,
        fetchJwks: async () => {
          throw new Error('offline')
        },
      }),
    ).rejects.toMatchObject({ statusCode: 503 })
  })
})
