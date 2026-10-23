import { describe, expect, it } from 'vitest'

import {
  createApnsProviderToken,
  createApnsTokenProvider,
  importApnsPrivateKey,
} from '../src/apns-token'
import { NotifyError } from '../src/errors'

import { generateTestApnsKey, verifyJwt } from './support/keys'

const TEAM = 'TEAM123456'
const KID = 'KEY1234567'

describe('APNs provider token (ES256)', () => {
  it('signs a JWT APNs can verify: ES256, kid header, iss and iat claims only', async () => {
    const key = await generateTestApnsKey()
    const token = await createApnsProviderToken(
      { teamId: TEAM, keyId: KID, privateKey: key.p8 },
      1_800_000_000,
    )
    const jwt = await verifyJwt(token, key.publicKey)
    expect(jwt.valid).toBe(true)
    expect(jwt.header).toEqual({ alg: 'ES256', kid: KID })
    expect(jwt.payload).toEqual({ iss: TEAM, iat: 1_800_000_000 })
    // JWS ES256 is the raw 64-byte r||s signature, not DER.
    expect(Buffer.from(token.split('.')[2] ?? '', 'base64url')).toHaveLength(64)
  })

  it('fails verification against a different key', async () => {
    const signer = await generateTestApnsKey()
    const other = await generateTestApnsKey()
    const token = await createApnsProviderToken({ teamId: TEAM, keyId: KID, privateKey: signer.p8 })
    expect((await verifyJwt(token, other.publicKey)).valid).toBe(false)
  })

  it('accepts escaped newlines and a bare base64 body, as secret stores keep them', async () => {
    const key = await generateTestApnsKey()
    await expect(importApnsPrivateKey(key.p8.replaceAll('\n', '\\n'))).resolves.toBeDefined()
    const body = key.p8.split('\n').slice(1, -1).join('')
    await expect(importApnsPrivateKey(body)).resolves.toBeDefined()
  })

  it.each([
    ['/Users/me/AuthKey_ABC.p8'],
    ['./AuthKey_ABC.p8'],
    ['AuthKey_ABC.p8'],
    ['~/keys/apns'],
  ])('refuses a file path (%s): the key comes from a secret binding by name', async (path) => {
    const error = await importApnsPrivateKey(path).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(NotifyError)
    expect((error as NotifyError).code).toBe('invalid_credentials')
    expect((error as NotifyError).message).toMatch(/never a file path/u)
  })

  it('refuses SEC1 keys, garbage and blank fields', async () => {
    await expect(
      importApnsPrivateKey('-----BEGIN EC PRIVATE KEY-----\nAAAA\n-----END EC PRIVATE KEY-----'),
    ).rejects.toThrow(/PKCS#8/u)
    await expect(importApnsPrivateKey('not base64 !!')).rejects.toThrow(/base64/u)
    await expect(importApnsPrivateKey('QUJD')).rejects.toThrow(/P-256 PKCS#8/u)
    await expect(importApnsPrivateKey('  ')).rejects.toThrow(/empty/u)
    const key = await generateTestApnsKey()
    await expect(
      createApnsProviderToken({ teamId: ' ', keyId: KID, privateKey: key.p8 }),
    ).rejects.toThrow(/teamId is required/u)
  })

  it('reuses one token inside the refresh window and re-signs after it', async () => {
    const key = await generateTestApnsKey()
    let now = 1_800_000_000_000
    const provider = createApnsTokenProvider(
      { teamId: TEAM, keyId: KID, privateKey: key.p8 },
      { now: () => now },
    )
    const [a, b] = await Promise.all([provider.token(), provider.token()])
    expect(a).toBe(b)
    now += 39 * 60 * 1000
    expect(await provider.token()).toBe(a)
    now += 60 * 1000
    const refreshed = await provider.token()
    expect(refreshed).not.toBe(a)
    expect((await verifyJwt(refreshed, key.publicKey)).payload.iat).toBe(now / 1000)
    provider.invalidate()
    now += 1000
    expect(await provider.token()).not.toBe(refreshed)
  })

  it('does not cache a failed signature', async () => {
    const provider = createApnsTokenProvider({ teamId: TEAM, keyId: KID, privateKey: 'QUJD' })
    await expect(provider.token()).rejects.toThrow(NotifyError)
    await expect(provider.token()).rejects.toThrow(NotifyError)
    expect(() =>
      createApnsTokenProvider(
        { teamId: TEAM, keyId: KID, privateKey: 'x' },
        { refreshAfterSeconds: 0 },
      ),
    ).toThrow(RangeError)
  })
})
