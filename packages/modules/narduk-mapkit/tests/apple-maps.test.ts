import {
  clearAppleMapsAccessTokenCacheForTests,
  createAppleMapsDeveloperToken,
  geocodeAppleMaps,
  getAppleMapsAccessToken,
  searchAppleMaps,
  searchAppleMapsNeighborhood,
} from '../src/server/apple-maps.js'
import { decodeJwt } from '../src/token/index.js'
import { createTestPrivateKeyPem } from './test-keys.js'

function unsignedTokenWithExp(exp: number): string {
  const payload = btoa(JSON.stringify({ exp }))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
  return `eyJhbGciOiJFUzI1NiJ9.${payload}.sig`
}

describe('Apple Maps Server API helpers', () => {
  afterEach(() => {
    clearAppleMapsAccessTokenCacheForTests()
  })

  it('signs a developer token with the required appid claim', async () => {
    const token = await createAppleMapsDeveloperToken({
      appId: 'maps.example.app',
      keyId: 'KEY123',
      privateKey: await createTestPrivateKeyPem(),
      teamId: 'TEAM123',
    })

    expect(decodeJwt(token).payload).toMatchObject({
      appid: 'maps.example.app',
      iss: 'TEAM123',
    })
  })

  it('exchanges and caches access tokens by signing configuration', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ accessToken: 'access-token', expiresInSeconds: 1800 }), {
          status: 200,
        }),
    )
    const config = {
      authToken: unsignedTokenWithExp(Math.floor(Date.now() / 1000) + 1800),
      fetch: fetchMock,
    }

    await expect(getAppleMapsAccessToken(config)).resolves.toBe('access-token')
    await expect(getAppleMapsAccessToken(config)).resolves.toBe('access-token')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://maps-api.apple.com/v1/token',
      expect.objectContaining({
        headers: { Authorization: expect.stringMatching(/^Bearer /) },
      }),
    )
  })

  it('searches and geocodes with an explicit access token', async () => {
    const requestedUrls: URL[] = []
    const fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      requestedUrls.push(new URL(String(input)))
      return new Response(JSON.stringify({ results: [{ name: 'Austin' }] }), { status: 200 })
    })

    await expect(
      searchAppleMaps('coffee', {
        accessToken: 'access-token',
        fetch: fetchMock,
        limit: 3,
        searchLocation: { lat: 30.2672, lng: -97.7431 },
      }),
    ).resolves.toMatchObject({ results: [{ name: 'Austin' }] })
    await expect(
      geocodeAppleMaps('Congress Avenue', {
        accessToken: 'access-token',
        fetch: fetchMock,
        limitToCountries: 'US',
      }),
    ).resolves.toMatchObject({ results: [{ name: 'Austin' }] })
    await expect(
      searchAppleMapsNeighborhood('Clarksville', {
        accessToken: 'access-token',
        fetch: fetchMock,
        locationContext: 'Austin, TX',
      }),
    ).resolves.toMatchObject({ results: [{ name: 'Austin' }] })

    expect(requestedUrls[0]?.pathname).toBe('/v1/search')
    expect(requestedUrls[0]?.searchParams.get('searchLocation')).toBe('30.2672,-97.7431')
    expect(requestedUrls[1]?.pathname).toBe('/v1/geocode')
    expect(requestedUrls[1]?.searchParams.get('limitToCountries')).toBe('US')
    expect(requestedUrls[2]?.searchParams.get('q')).toBe('Clarksville, Austin, TX')
    expect(requestedUrls[2]?.searchParams.get('includeAddressCategories')).toBe('SubLocality')
    for (const call of fetchMock.mock.calls) {
      expect(call[1]).toMatchObject({ headers: { Authorization: 'Bearer access-token' } })
    }
  })

  it('fails clearly when neither an access token nor server config is provided', async () => {
    await expect(searchAppleMaps('coffee')).rejects.toThrow(
      'Apple Maps accessToken or serverConfig is required',
    )
  })
})
