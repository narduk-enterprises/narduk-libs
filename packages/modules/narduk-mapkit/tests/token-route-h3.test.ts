/**
 * §e.1 proven through a REAL h3 event served by a REAL node listener.
 *
 * The package itself stays framework-free: `self` is an option on the handler,
 * and this suite pins the exact expression a Nuxt/Nitro caller must pass --
 * `getRequestURL(event, { xForwardedHost: false }).origin`. h3 is a
 * devDependency for precisely this proof; nothing in `src/` imports it.
 */
import { createApp, defineEventHandler, getRequestURL, toNodeListener } from 'h3'
import { createServer } from 'node:http'
import { decodeJwt } from '../src/token/index.js'
import { clearMapKitTokenCacheForTests, mapKitTokenResponse } from '../src/server/index.js'
import { createTestPrivateKeyPem } from './test-keys.js'

import type { MapKitServerConfig } from '../src/server/index.js'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'

let server: Server
let base: string

beforeAll(async () => {
  const config: MapKitServerConfig = {
    keyId: 'KEY1234567',
    privateKey: await createTestPrivateKeyPem(),
    teamId: 'TEAM123456',
  }

  const app = createApp()
  app.use(
    '/api/mapkit-token',
    defineEventHandler(async (event) => {
      // THE two lines a Nuxt/Nitro consumer writes. `xForwardedHost: false` is
      // what stops an X-Forwarded-Host header reaching the origin claim.
      const self = getRequestURL(event, { xForwardedHost: false }).origin
      const request = new Request(getRequestURL(event).toString(), {
        headers: event.headers,
        method: event.method,
      })
      return await mapKitTokenResponse(request, config, { self })
    }),
  )

  server = createServer(toNodeListener(app))
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`
})

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error)
      else resolve()
    })
  })
})

afterEach(() => {
  clearMapKitTokenCacheForTests()
})

describe('token route behind a real h3 event', () => {
  it('builds the origin claim from the routed host, not X-Forwarded-Host', async () => {
    const response = await fetch(`${base}/api/mapkit-token`, {
      headers: {
        origin: base,
        'sec-fetch-site': 'same-origin',
        'x-forwarded-host': 'evil.example',
      },
    })
    const payload = (await response.json()) as { token: string }

    expect(response.status).toBe(200)
    const claims = decodeJwt(payload.token).payload
    expect(claims.origin).toBe(base)
    expect(JSON.stringify(claims)).not.toContain('evil.example')
  })

  it('refuses rather than minting when X-Forwarded-Proto disagrees with the page', async () => {
    // `getRequestURL`'s `xForwardedProto` is left at h3's default (honoured),
    // because a TLS-terminating proxy is how a Nitro deployment knows it is
    // https at all -- and unlike X-Forwarded-Host it cannot name a host the
    // attacker controls, so the worst it buys is a claim that fails on the real
    // page. This pins that boundary: the header flips the scheme, the Origin
    // header no longer matches `self`, and the route refuses rather than
    // minting a token for an origin the page is not on.
    const response = await fetch(`${base}/api/mapkit-token`, {
      headers: {
        origin: base,
        'sec-fetch-site': 'same-origin',
        'x-forwarded-proto': 'https',
      },
    })

    expect(response.status).toBe(403)
  })

  it('answers a same-origin fetch that sends no Origin header', async () => {
    const response = await fetch(`${base}/api/mapkit-token`, {
      headers: { 'sec-fetch-site': 'same-origin' },
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('vary')).toBe('origin, sec-fetch-site')
  })

  it('refuses a cross-site navigation with 403 and no CORS header', async () => {
    const response = await fetch(`${base}/api/mapkit-token`, {
      headers: { 'sec-fetch-site': 'cross-site' },
    })

    expect(response.status).toBe(403)
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('answers 405 with allow: GET to a POST', async () => {
    const response = await fetch(`${base}/api/mapkit-token`, {
      method: 'POST',
      headers: { 'sec-fetch-site': 'same-origin' },
    })

    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('GET')
  })
})

/**
 * The preview-host case §e.5 calls a prerequisite of the design.
 *
 * narduk-core's `00-canonical-host` 308'd EVERY GET, `/api/*` included, which
 * broke the same-origin fetch on every preview hostname AND burned an Apple
 * mint per preview page load. narduk-libs#408 fixed it by skipping the redirect
 * for non-document requests, and landed in narduk-libs#426 -- so this test,
 * which S4 was told to expect RED, is green here. It guards the shape the fix
 * has to keep: a token fetch reaching the route on a non-canonical host is
 * answered 200 from THAT host, with no Location.
 */
describe('§e.5 preview host (narduk-libs#408, landed in #426)', () => {
  it('answers the token from the preview host itself, never a redirect', async () => {
    const response = await fetch(`${base}/api/mapkit-token`, {
      headers: {
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
      },
      redirect: 'manual',
    })
    const payload = (await response.json()) as { token: string }

    expect(response.status).toBe(200)
    expect(response.headers.get('location')).toBeNull()
    expect(decodeJwt(payload.token).payload.origin).toBe(base)
  })
})
