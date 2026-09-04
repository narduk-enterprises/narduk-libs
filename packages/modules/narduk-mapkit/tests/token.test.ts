import { createAppleMapsAuthToken, createMapKitToken, decodeJwt, isJwtExpired } from '../src/token/index.js'
import { createTestPrivateKeyPem } from './test-keys.js'

describe('MapKit JWT signing', () => {
  it('creates an origin-scoped MapKit JS token', async () => {
    const privateKey = await createTestPrivateKeyPem()
    const token = await createMapKitToken({
      issuedAtSeconds: 100,
      keyId: 'KEY123',
      origin: 'http://localhost:3000',
      privateKey,
      teamId: 'TEAM123',
    })

    const decoded = decodeJwt(token)
    expect(decoded.header).toMatchObject({ alg: 'ES256', kid: 'KEY123', typ: 'JWT' })
    expect(decoded.payload).toMatchObject({
      exp: 86500,
      iat: 100,
      iss: 'TEAM123',
      origin: 'http://localhost:3000',
    })
    expect(token.split('.')).toHaveLength(3)
  })

  it('creates an Apple Maps Server API auth token with appid', async () => {
    const privateKey = await createTestPrivateKeyPem()
    const token = await createAppleMapsAuthToken({
      appId: 'maps.example',
      issuedAtSeconds: 200,
      keyId: 'KEY123',
      privateKey,
      teamId: 'TEAM123',
    })

    expect(decodeJwt(token).payload).toMatchObject({
      appid: 'maps.example',
      exp: 2000,
      iat: 200,
      iss: 'TEAM123',
    })
  })

  it('detects expired JWTs with a refresh window', async () => {
    const privateKey = await createTestPrivateKeyPem()
    const token = await createMapKitToken({
      expiresInSeconds: 10,
      issuedAtSeconds: 100,
      keyId: 'KEY123',
      origin: 'http://localhost:3000',
      privateKey,
      teamId: 'TEAM123',
    })

    expect(isJwtExpired(token, 105_000)).toBe(false)
    expect(isJwtExpired(token, 105_000, 6_000)).toBe(true)
  })
})
