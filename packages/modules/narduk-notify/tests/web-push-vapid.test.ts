import { describe, expect, it } from 'vitest'

import { NotifyError } from '../src/errors'
import { createVapidAuthorization, generateVapidKeys } from '../src/web-push'

import { verifyJwt } from './support/keys'

const NOW_MS = 1_800_000_000_000
const NOW_S = NOW_MS / 1000
const SUBJECT = 'mailto:ops@nardukenterprises.com'

async function verifyingKey(publicKey: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    Buffer.from(publicKey, 'base64url'),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  )
}

function parse(authorization: string): { jwt: string; k: string } {
  const match = /^vapid t=([\w-]+\.[\w-]+\.[\w-]+), k=([\w-]+)$/u.exec(authorization)
  if (!match) throw new Error(`not a vapid Authorization value: ${authorization}`)
  return { jwt: match[1] ?? '', k: match[2] ?? '' }
}

describe('VAPID (RFC 8292)', () => {
  it('generates a 65-byte public point and a 32-byte scalar, base64url', async () => {
    const keys = await generateVapidKeys()
    expect(Buffer.from(keys.publicKey, 'base64url')).toHaveLength(65)
    expect(Buffer.from(keys.publicKey, 'base64url')[0]).toBe(4)
    expect(Buffer.from(keys.privateKey, 'base64url')).toHaveLength(32)
    expect(keys.publicKey).toMatch(/^[\w-]+$/u)
    expect(keys.privateKey).toMatch(/^[\w-]+$/u)
  })

  it('signs an ES256 JWT the public key verifies, with aud, exp and sub', async () => {
    const keys = await generateVapidKeys()
    const header = await createVapidAuthorization(
      'https://fcm.googleapis.com/fcm/send/abc123?x=1',
      { subject: SUBJECT, ...keys },
      { now: () => NOW_MS },
    )
    const { jwt, k } = parse(header)
    expect(k).toBe(keys.publicKey)
    const verified = await verifyJwt(jwt, await verifyingKey(keys.publicKey))
    expect(verified.valid).toBe(true)
    expect(verified.header).toEqual({ typ: 'JWT', alg: 'ES256' })
    expect(verified.payload).toEqual({
      aud: 'https://fcm.googleapis.com',
      exp: NOW_S + 12 * 3600,
      sub: SUBJECT,
    })
    // JWS ES256 is the raw 64-byte r||s signature, not DER.
    expect(Buffer.from(jwt.split('.')[2] ?? '', 'base64url')).toHaveLength(64)
  })

  it('does not verify against another key', async () => {
    const keys = await generateVapidKeys()
    const other = await generateVapidKeys()
    const { jwt } = parse(
      await createVapidAuthorization('https://web.push.apple.com/x', { subject: SUBJECT, ...keys }),
    )
    expect((await verifyJwt(jwt, await verifyingKey(other.publicKey))).valid).toBe(false)
  })

  it('honours expiresInSeconds up to 24 hours and refuses more', async () => {
    const keys = await generateVapidKeys()
    const vapid = { subject: 'https://narduk.example/contact', ...keys }
    const { jwt } = parse(
      await createVapidAuthorization('https://web.push.apple.com/x', vapid, {
        now: () => NOW_MS,
        expiresInSeconds: 24 * 3600,
      }),
    )
    const payload = (await verifyJwt(jwt, await verifyingKey(keys.publicKey))).payload
    expect(payload.exp).toBe(NOW_S + 24 * 3600)
    for (const expiresInSeconds of [24 * 3600 + 1, 0, -1, Number.NaN]) {
      await expect(
        createVapidAuthorization('https://web.push.apple.com/x', vapid, { expiresInSeconds }),
      ).rejects.toThrow(RangeError)
    }
  })

  it('rejects a bad subject and malformed keys as invalid_credentials', async () => {
    const keys = await generateVapidKeys()
    const endpoint = 'https://web.push.apple.com/x'
    for (const bad of [
      { subject: 'ops@nardukenterprises.com', ...keys },
      { subject: 'http://insecure.example', ...keys },
      { subject: SUBJECT, ...keys, privateKey: 'AAAA' },
      { subject: SUBJECT, ...keys, publicKey: 'AAAA' },
      { subject: SUBJECT, ...keys, privateKey: keys.privateKey.replace(/.$/u, '!') },
    ]) {
      const error = await createVapidAuthorization(endpoint, bad).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(NotifyError)
      expect((error as NotifyError).code).toBe('invalid_credentials')
    }
  })

  it('accepts padded keys and rejects a long run of padding in linear time', async () => {
    const keys = await generateVapidKeys()
    const endpoint = 'https://web.push.apple.com/x'
    await expect(
      createVapidAuthorization(endpoint, {
        subject: SUBJECT,
        ...keys,
        publicKey: `${keys.publicKey}=`,
      }),
    ).resolves.toMatch(/^vapid t=/u)
    const started = performance.now()
    const error = await createVapidAuthorization(endpoint, {
      subject: SUBJECT,
      ...keys,
      publicKey: `${'='.repeat(200_000)}x`,
    }).catch((e: unknown) => e)
    expect((error as NotifyError).code).toBe('invalid_credentials')
    expect(performance.now() - started).toBeLessThan(1000)
  })
})

describe('VAPID key pair consistency', () => {
  it('refuses a private key that belongs to a different public key', async () => {
    const a = await generateVapidKeys()
    const b = await generateVapidKeys()
    await expect(
      createVapidAuthorization('https://web.push.apple.com/x', {
        subject: SUBJECT,
        publicKey: a.publicKey,
        privateKey: b.privateKey,
      }),
    ).rejects.toThrow(/does not match|not a valid P-256/u)
  })
})
