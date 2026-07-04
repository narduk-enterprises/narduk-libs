import { decodeJwt } from '../src/token/index.js'
import {
  clearMapKitTokenCacheForTests,
  issueMapKitTokenForRequest,
  mapKitTokenResponse,
  mapKitTokenResponseFromEnv,
} from '../src/server/index.js'
import { createTestPrivateKeyPem } from './test-keys.js'

describe('MapKit token request handler', () => {
  afterEach(() => {
    clearMapKitTokenCacheForTests()
  })

  it('signs a token for the request origin', async () => {
    const privateKey = await createTestPrivateKeyPem()
    const result = await issueMapKitTokenForRequest({
      config: {
        allowedOrigins: ['http://localhost:5173'],
        keyId: 'KEY123',
        privateKey,
        teamId: 'TEAM123',
      },
      request: new Request('http://local.test/api/mapkit-token', {
        headers: { origin: 'http://localhost:5173' },
      }),
    })

    expect(result.configured).toBe(true)
    expect(result.origin).toBe('http://localhost:5173')
    expect(decodeJwt(result.token).payload.origin).toBe('http://localhost:5173')
  })

  it('reuses cached signed tokens for the same origin and signing config', async () => {
    const privateKey = await createTestPrivateKeyPem()
    const config = {
      cache: { refreshWindowMs: 0 },
      keyId: 'KEY123',
      privateKey,
      teamId: 'TEAM123',
      tokenExpiresInSeconds: 3600,
    }
    const request = new Request('http://local.test/api/mapkit-token', {
      headers: { origin: 'http://localhost:5173' },
    })

    const first = await issueMapKitTokenForRequest({ config, request })
    const second = await issueMapKitTokenForRequest({ config, request })
    const otherOrigin = await issueMapKitTokenForRequest({
      config,
      request: new Request('http://local.test/api/mapkit-token', {
        headers: { origin: 'http://localhost:4173' },
      }),
    })

    expect(second.token).toBe(first.token)
    expect(second.expiresAt).toBe(first.expiresAt)
    expect(otherOrigin.token).not.toBe(first.token)
  })

  it('rejects origins outside the allowlist', async () => {
    const response = await mapKitTokenResponse(
      new Request('http://local.test/api/mapkit-token', {
        headers: { origin: 'http://blocked.example' },
      }),
      {
        allowedOrigins: ['http://localhost:5173'],
        keyId: 'KEY123',
        privateKey: await createTestPrivateKeyPem(),
        teamId: 'TEAM123',
      },
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      configured: true,
      token: '',
    })
  })

  it('reports missing credentials without throwing', async () => {
    const response = await mapKitTokenResponse(new Request('http://local.test/api/mapkit-token'), {
      doppler: false,
    })

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      configured: false,
      token: '',
    })
  })

  it('signs from a Worker-style env object and derives origin from the request', async () => {
    const response = await mapKitTokenResponseFromEnv(
      new Request('https://h2.example/api/mapkit-token'),
      {
        APPLE_TEAM_ID: 'TEAM123',
        APPLE_KEY_ID: 'KEY123',
        APPLE_PRIVATE_KEY: await createTestPrivateKeyPem(),
      },
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as { configured: boolean; token: string }
    expect(body.configured).toBe(true)
    expect(decodeJwt(body.token).payload.origin).toBe('https://h2.example')
  })
})
