import { decodeJwt } from '../src/token/index.js'
import { issueMapKitTokenForRequest, mapKitTokenResponse } from '../src/server/index.js'
import { createTestPrivateKeyPem } from './test-keys.js'

describe('MapKit token request handler', () => {
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
    const response = await mapKitTokenResponse(new Request('http://local.test/api/mapkit-token'))

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      configured: false,
      token: '',
    })
  })
})
