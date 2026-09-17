/**
 * The same-host, fail-closed token route (narduk-libs#421 §e).
 *
 * Every rule is exercised at the `Request` level against the real handler --
 * the level at which the contract is actually stated -- with a throwaway ES256
 * key generated per test. No real credential is ever read, printed, or
 * committed.
 */
import { decodeJwt } from '../src/token/index.js'
import {
  clearMapKitTokenCacheForTests,
  createMapKitTokenHandler,
  getOriginFromRequest,
  isMapKitRequestSameOrigin,
  issueMapKitTokenForRequest,
  mapKitSelfOrigin,
  mapKitTokenResponse,
  mapKitTokenResponseFromEnv,
} from '../src/server/index.js'
import { createTestPrivateKeyPem } from './test-keys.js'

import type { MapKitTokenRouteLogEntry } from '../src/server/index.js'
import type { MapKitServerConfig } from '../src/server/index.js'

const ROUTE = 'https://app.example.com/api/mapkit-token'
const SELF = 'https://app.example.com'

async function signingConfig(
  overrides: Partial<MapKitServerConfig> = {},
): Promise<MapKitServerConfig> {
  return {
    keyId: 'KEY1234567',
    privateKey: await createTestPrivateKeyPem(),
    teamId: 'TEAM123456',
    ...overrides,
  }
}

/** A same-origin browser `fetch()`: Sec-Fetch-Site, and no Origin at all. */
function sameOriginRequest(url = ROUTE, extra: Record<string, string> = {}): Request {
  return new Request(url, { headers: { 'sec-fetch-site': 'same-origin', ...extra } })
}

async function body(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>
}

describe('§e.1 request rules', () => {
  afterEach(() => {
    clearMapKitTokenCacheForTests()
  })

  it('takes self from the routed request URL, never from a forwarding header', async () => {
    const config = await signingConfig()
    const response = await mapKitTokenResponse(
      sameOriginRequest(ROUTE, {
        origin: 'https://evil.example',
        'x-forwarded-host': 'evil.example',
        'x-forwarded-proto': 'http',
      }),
      config,
    )

    // A present Origin that disagrees with the routed origin refuses, whatever
    // X-Forwarded-Host claims.
    expect(response.status).toBe(403)
    expect(await body(response)).toMatchObject({ error: 'not-same-origin' })
  })

  it('never mints a claim naming a forged X-Forwarded-Host', async () => {
    const config = await signingConfig()
    const response = await mapKitTokenResponse(
      sameOriginRequest(ROUTE, {
        origin: SELF,
        'x-forwarded-host': 'evil.example',
        'x-forwarded-proto': 'http',
      }),
      config,
    )

    expect(response.status).toBe(200)
    const token = (await body(response)).token as string
    const { payload } = decodeJwt(token)
    expect(payload.origin).toBe(SELF)
    expect(JSON.stringify(payload)).not.toContain('evil.example')
  })

  it('accepts a same-origin fetch that sends NO Origin header', async () => {
    const response = await mapKitTokenResponse(sameOriginRequest(), await signingConfig())

    // Measured in real Chromium: a same-origin fetch() sends no Origin at all.
    // Rejecting these would reject every legitimate call.
    expect(response.status).toBe(200)
  })

  it.each(['same-site', 'cross-site', 'none'])('refuses Sec-Fetch-Site: %s', async (site) => {
    const response = await mapKitTokenResponse(
      new Request(ROUTE, { headers: { 'sec-fetch-site': site } }),
      await signingConfig(),
    )

    expect(response.status).toBe(403)
    expect(await body(response)).toMatchObject({ error: 'not-same-origin' })
  })

  it('explains the refusal in prose for the human who opened the URL in a tab', async () => {
    const response = await mapKitTokenResponse(
      new Request(ROUTE, { headers: { 'sec-fetch-site': 'none' } }),
      await signingConfig(),
    )

    expect(String((await body(response)).message)).toMatch(/same-origin/i)
  })

  it('falls back to Origin, then Referer, when Sec-Fetch-Site is absent', async () => {
    const config = await signingConfig()

    await expect(
      mapKitTokenResponse(new Request(ROUTE, { headers: { origin: SELF } }), config),
    ).resolves.toMatchObject({ status: 200 })

    await expect(
      mapKitTokenResponse(
        new Request(ROUTE, { headers: { referer: `${SELF}/map?station=42` } }),
        config,
      ),
    ).resolves.toMatchObject({ status: 200 })

    await expect(
      mapKitTokenResponse(
        new Request(ROUTE, { headers: { referer: 'https://evil.example/map' } }),
        config,
      ),
    ).resolves.toMatchObject({ status: 403 })
  })

  it('refuses when there is no same-origin evidence at all', async () => {
    const response = await mapKitTokenResponse(new Request(ROUTE), await signingConfig())
    expect(response.status).toBe(403)
  })

  it('refuses a present Origin that disagrees even when Sec-Fetch-Site says same-origin', () => {
    expect(
      isMapKitRequestSameOrigin(
        sameOriginRequest(ROUTE, { origin: 'https://evil.example' }),
        SELF,
      ),
    ).toBe(false)
  })

  it.each(['OPTIONS', 'POST', 'PUT', 'DELETE', 'HEAD'])('answers 405 to %s', async (method) => {
    const response = await mapKitTokenResponse(
      new Request(ROUTE, { method, headers: { 'sec-fetch-site': 'same-origin' } }),
      await signingConfig(),
    )

    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('GET')
    expect(await body(response)).toMatchObject({ error: 'method-not-allowed' })
  })

  it('never emits Access-Control-Allow-Origin, on any response', async () => {
    const config = await signingConfig()
    const responses = await Promise.all([
      mapKitTokenResponse(sameOriginRequest(), config),
      mapKitTokenResponse(new Request(ROUTE, { headers: { 'sec-fetch-site': 'cross-site' } }), config),
      mapKitTokenResponse(new Request(ROUTE, { method: 'OPTIONS' }), config),
      mapKitTokenResponse(sameOriginRequest(), {}),
    ])

    for (const response of responses) {
      expect(response.headers.get('access-control-allow-origin')).toBeNull()
    }
  })
})

describe('§e.2 responses', () => {
  afterEach(() => {
    clearMapKitTokenCacheForTests()
  })

  it('answers 200 with { token, expiresAt } and the required headers', async () => {
    const response = await mapKitTokenResponse(sameOriginRequest(), await signingConfig())
    const payload = await body(response)

    expect(response.status).toBe(200)
    expect(typeof payload.token).toBe('string')
    expect(typeof payload.expiresAt).toBe('number')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('vary')).toBe('origin, sec-fetch-site')
  })

  it('answers 503 unconfigured rather than a quiet 200 when the signer is absent', async () => {
    const response = await mapKitTokenResponse(sameOriginRequest(), {})

    expect(response.status).toBe(503)
    expect(await body(response)).toMatchObject({ error: 'unconfigured' })
    expect(await body(await mapKitTokenResponse(sameOriginRequest(), {}))).not.toHaveProperty(
      'token',
    )
  })

  it('ignores a configured static token instead of serving it', async () => {
    const response = await mapKitTokenResponse(sameOriginRequest(), {
      staticToken: 'eyJhbGciOiJFUzI1NiJ9.e30.sig',
    })

    expect(response.status).toBe(503)
  })

  it('answers 429 with retry-after when the limiter refuses', async () => {
    const response = await mapKitTokenResponse(sameOriginRequest(), await signingConfig(), {
      rateLimit: () => ({ allowed: false, retryAfterSeconds: 42 }),
    })

    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('42')
    expect(await body(response)).toMatchObject({ error: 'rate-limited' })
  })
})

describe('§e.3 claims', () => {
  afterEach(() => {
    clearMapKitTokenCacheForTests()
  })

  it('carries iss, kid, iat, exp = iat + 1800, origin and scope', async () => {
    const config = await signingConfig()
    const response = await mapKitTokenResponse(sameOriginRequest(), config)
    const { header, payload } = decodeJwt((await body(response)).token as string)

    expect(header).toMatchObject({ alg: 'ES256', kid: 'KEY1234567', typ: 'JWT' })
    expect(payload).toMatchObject({ iss: 'TEAM123456', origin: SELF, scope: 'mapkit_js' })
    expect((payload.exp as number) - (payload.iat as number)).toBe(1800)
  })

  it('omits the default port on https so Apple accepts the claim', async () => {
    const response = await mapKitTokenResponse(
      new Request('https://app.example.com:443/api/mapkit-token', {
        headers: { 'sec-fetch-site': 'same-origin' },
      }),
      await signingConfig(),
    )
    const { payload } = decodeJwt((await body(response)).token as string)

    // Apple enforces scheme + host + port exactly; a spurious :443 fails.
    expect(payload.origin).toBe('https://app.example.com')
  })

  it('keeps a non-default port, which Apple enforces too', async () => {
    const response = await mapKitTokenResponse(
      new Request('http://127.0.0.1:4502/api/mapkit-token', {
        headers: { 'sec-fetch-site': 'same-origin' },
      }),
      await signingConfig(),
    )
    const { payload } = decodeJwt((await body(response)).token as string)

    expect(payload.origin).toBe('http://127.0.0.1:4502')
  })

  it.each([
    [undefined, 1800],
    [86_400, 1800],
    [10, 60],
    [900, 900],
  ])('clamps a requested TTL of %s to %s seconds', async (requested, expected) => {
    const config = await signingConfig(
      requested === undefined ? {} : { tokenExpiresInSeconds: requested },
    )
    const response = await mapKitTokenResponse(sameOriginRequest(), config)
    const { payload } = decodeJwt((await body(response)).token as string)

    expect((payload.exp as number) - (payload.iat as number)).toBe(expected)
  })

  it('never issues a token without an origin claim', async () => {
    const result = await issueMapKitTokenForRequest({
      config: await signingConfig(),
      request: sameOriginRequest(),
    })
    const { payload } = decodeJwt(result.token)

    expect(payload.origin).toBe(SELF)
  })
})

describe('§e.4 rate limit, cache and logging', () => {
  afterEach(() => {
    clearMapKitTokenCacheForTests()
  })

  it.each([
    'https://app.example.com/api/mapkit-token',
    'https://app.example.com/api/mapkit-token/',
    'https://app.example.com/API/MapKit-Token',
    'https://app.example.com//api//mapkit-token',
    'https://app.example.com/api/mapkit-token?cache=0',
  ])('consults the limiter for %s -- path shape cannot bypass it', async (url) => {
    // buoys PR 122 review, F1: the limiter is part of the HANDLER, not a
    // path-matching middleware, so no spelling of the path walks around it.
    const seen: string[] = []
    const handler = createMapKitTokenHandler(await signingConfig(), {
      rateLimit: ({ request }) => {
        seen.push(new URL(request.url).pathname)
        return { allowed: false }
      },
    })

    const response = await handler(sameOriginRequest(url))

    expect(seen).toHaveLength(1)
    expect(response.status).toBe(429)
  })

  it('refuses a cross-origin caller BEFORE consuming a rate-limit allowance', async () => {
    const rateLimit = vi.fn(() => ({ allowed: true }))
    const response = await mapKitTokenResponse(
      new Request(ROUTE, { headers: { 'sec-fetch-site': 'cross-site' } }),
      await signingConfig(),
      { rateLimit },
    )

    expect(response.status).toBe(403)
    expect(rateLimit).not.toHaveBeenCalled()
  })

  it('hands the limiter the routed origin, not a caller-supplied one', async () => {
    const contexts: Array<{ origin: string; self: string }> = []
    await mapKitTokenResponse(
      sameOriginRequest(ROUTE, { origin: SELF }),
      await signingConfig(),
      {
        rateLimit: (context) => {
          contexts.push({ origin: context.origin, self: context.self })
          return true
        },
      },
    )

    expect(contexts).toStrictEqual([{ origin: SELF, self: SELF }])
  })

  it('accepts a bare boolean verdict as well as a decision object', async () => {
    const config = await signingConfig()
    await expect(
      mapKitTokenResponse(sameOriginRequest(), config, { rateLimit: () => false }),
    ).resolves.toMatchObject({ status: 429 })
    clearMapKitTokenCacheForTests()
    await expect(
      mapKitTokenResponse(sameOriginRequest(), config, { rateLimit: () => true }),
    ).resolves.toMatchObject({ status: 200 })
  })

  it('reuses one signed token per self and mints a different one per origin', async () => {
    const config = await signingConfig()
    const first = await issueMapKitTokenForRequest({ config, request: sameOriginRequest() })
    const second = await issueMapKitTokenForRequest({ config, request: sameOriginRequest() })
    const other = await issueMapKitTokenForRequest({
      config,
      request: sameOriginRequest('https://preview.example.com/api/mapkit-token'),
    })

    expect(second.token).toBe(first.token)
    expect(other.token).not.toBe(first.token)
    expect(decodeJwt(other.token).payload.origin).toBe('https://preview.example.com')
  })

  it('does not reuse a cached token after the signing key rotates', async () => {
    const config = await signingConfig()
    const first = await issueMapKitTokenForRequest({ config, request: sameOriginRequest() })
    const rotated = await issueMapKitTokenForRequest({
      config: { ...config, privateKey: await createTestPrivateKeyPem() },
      request: sameOriginRequest(),
    })

    expect(rotated.token).not.toBe(first.token)
  })

  it('caps the signed-token cache at 32 entries', async () => {
    const config = await signingConfig()
    const first = sameOriginRequest('https://host-0.example.com/api/mapkit-token')
    const original = await issueMapKitTokenForRequest({ config, request: first })

    for (let index = 1; index <= 32; index += 1) {
      await issueMapKitTokenForRequest({
        config,
        request: sameOriginRequest(`https://host-${String(index)}.example.com/api/mapkit-token`),
      })
    }

    // The oldest entry was evicted, so the same origin mints afresh.
    const reissued = await issueMapKitTokenForRequest({ config, request: first })
    expect(reissued.token).not.toBe(original.token)
  })

  it('bypasses the cache entirely when cache: false', async () => {
    const config = await signingConfig({ cache: false })
    const first = await issueMapKitTokenForRequest({ config, request: sameOriginRequest() })
    await new Promise((resolve) => setTimeout(resolve, 1100))
    const second = await issueMapKitTokenForRequest({ config, request: sameOriginRequest() })

    expect(second.token).not.toBe(first.token)
  })

  it('logs the refusal, status, self and deprecated key NAMES -- never a value', async () => {
    const entries: MapKitTokenRouteLogEntry[] = []
    const config = await signingConfig({
      allowedOrigins: ['https://legacy.example.com'],
      staticToken: 'eyJhbGciOiJFUzI1NiJ9.e30.sig',
    })

    await mapKitTokenResponse(
      new Request(ROUTE, { headers: { 'sec-fetch-site': 'cross-site' } }),
      config,
      { log: (entry) => entries.push(entry) },
    )
    await mapKitTokenResponse(sameOriginRequest(), config, { log: (entry) => entries.push(entry) })

    expect(entries[0]).toStrictEqual({
      deprecatedKeys: ['allowedOrigins', 'staticToken'],
      refusal: 'not-same-origin',
      self: SELF,
      status: 403,
    })
    expect(entries[1]).toMatchObject({ self: SELF, status: 200 })
    expect(entries[1]).not.toHaveProperty('refusal')

    const serialized = JSON.stringify(entries)
    expect(serialized).not.toContain('eyJ')
    expect(serialized).not.toContain('legacy.example.com')
  })
})

describe('§e adapters', () => {
  afterEach(() => {
    clearMapKitTokenCacheForTests()
  })

  it('signs from a Worker-style env binding object', async () => {
    const response = await mapKitTokenResponseFromEnv(sameOriginRequest(), {
      APPLE_KEY_ID: 'KEY1234567',
      APPLE_PRIVATE_KEY: await createTestPrivateKeyPem(),
      APPLE_TEAM_ID: 'TEAM123456',
    })
    const { payload } = decodeJwt((await body(response)).token as string)

    expect(response.status).toBe(200)
    expect(payload.origin).toBe(SELF)
  })

  it('accepts an explicit self for a framework that routes the request itself', async () => {
    // What an h3 caller passes:
    // getRequestURL(event, { xForwardedHost: false }).origin
    const result = await issueMapKitTokenForRequest({
      config: await signingConfig(),
      request: sameOriginRequest('http://internal.invalid/api/mapkit-token'),
      self: 'https://preview-42.workers.dev/api/mapkit-token',
    })

    expect(result.self).toBe('https://preview-42.workers.dev')
    expect(decodeJwt(result.token).payload.origin).toBe('https://preview-42.workers.dev')
  })

  it('answers self from the routed URL through the 2.0.x-named helper', () => {
    expect(getOriginFromRequest(sameOriginRequest(ROUTE, { origin: 'https://evil.example' }))).toBe(
      SELF,
    )
    expect(mapKitSelfOrigin(sameOriginRequest())).toBe(SELF)
  })

  it('answers 500 without leaking key material when signing fails', async () => {
    const response = await mapKitTokenResponse(sameOriginRequest(), {
      keyId: 'KEY1234567',
      privateKey: '-----BEGIN PRIVATE KEY-----\nnot-a-key\n-----END PRIVATE KEY-----',
      teamId: 'TEAM123456',
    })

    expect(response.status).toBe(500)
    expect(await body(response)).not.toHaveProperty('token')
  })
})
