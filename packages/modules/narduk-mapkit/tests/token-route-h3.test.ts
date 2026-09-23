/**
 * §e.1 proven through a REAL h3 event served by a REAL node listener.
 *
 * The package itself stays framework-free: `self` is an option on the handler,
 * and this suite pins the exact expression a Nuxt/Nitro caller must pass --
 * `getRequestURL(event, { xForwardedHost: false }).origin`. h3 is a
 * devDependency for precisely this proof; nothing in `src/` imports it.
 */
import { createApp, defineEventHandler, getRequestURL, toNodeListener } from 'h3'
import { connect } from 'node:net'
import { createServer } from 'node:http'
import { decodeJwt } from '../src/token/index.js'
import {
  clearMapKitTokenCacheForTests,
  isMapKitHostAllowed,
  mapKitRoutedOrigin,
  mapKitTokenResponse,
} from '../src/server/index.js'
import { createTestPrivateKeyPem } from './test-keys.js'

import type { MapKitServerConfig } from '../src/server/index.js'
import type { AddressInfo } from 'node:net'
import type { H3Event } from 'h3'
import type { Server } from 'node:http'

let server: Server
let base: string
/** The same handler mounted catch-all -- see the §F2 describe block. */
let catchAllServer: Server
let catchAllPort: number
/** Catch-all with `allowedHosts` set -- the narduk-libs#437 describe block. */
let allowListServer: Server
let allowListPort: number

/**
 * THE lines a Nuxt/Nitro consumer writes.
 *
 * `xForwardedHost: false` is what stops an `X-Forwarded-Host` header reaching
 * the origin claim. `mapKitRoutedOrigin` is what prefers a routed Fetch
 * `Request` where the adapter provides one and refuses an absolute-form request
 * line where it does not -- answering `null`, which the handler turns into a
 * 403 without minting.
 */
function routedSelf(event: H3Event): string | null {
  return mapKitRoutedOrigin({
    derivedOrigin: getRequestURL(event, { xForwardedHost: false }).origin,
    request: event.web?.request,
    // What `getRequestURL` itself reads, before `new URL(target, base)` gets a
    // chance to ignore the base.
    requestTarget: event.node.req.originalUrl ?? event.path,
  })
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })
  return (server.address() as AddressInfo).port
}

beforeAll(async () => {
  const config: MapKitServerConfig = {
    keyId: 'KEY1234567',
    privateKey: await createTestPrivateKeyPem(),
    teamId: 'TEAM123456',
  }

  const handler = defineEventHandler(async (event) => {
    const request = new Request(getRequestURL(event).toString(), {
      headers: event.headers,
      method: event.method,
    })
    return await mapKitTokenResponse(request, config, { self: routedSelf(event) })
  })

  const app = createApp()
  app.use('/api/mapkit-token', handler)
  server = createServer(toNodeListener(app))
  base = `http://127.0.0.1:${String(await listen(server))}`

  const catchAllApp = createApp()
  catchAllApp.use(handler)
  catchAllServer = createServer(toNodeListener(catchAllApp))
  catchAllPort = await listen(catchAllServer)

  const allowListApp = createApp()
  allowListApp.use(
    defineEventHandler(async (event) => {
      const request = new Request(getRequestURL(event).toString(), {
        headers: event.headers,
        method: event.method,
      })
      return await mapKitTokenResponse(
        request,
        { ...config, allowedHosts: ['app.example', '*.preview.example'] },
        { self: routedSelf(event) },
      )
    }),
  )
  allowListServer = createServer(toNodeListener(allowListApp))
  allowListPort = await listen(allowListServer)
})

/**
 * `fetch` cannot send an absolute-form request line or a `Host` that disagrees
 * with the connection it opened, so this speaks HTTP/1.1 down a raw socket.
 */
async function rawRequest(port: number, requestTarget: string, host: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const socket = connect(port, '127.0.0.1', () => {
      socket.write(
        [
          `GET ${requestTarget} HTTP/1.1`,
          `Host: ${host}`,
          'Sec-Fetch-Site: same-origin',
          'Connection: close',
          '',
          '',
        ].join('\r\n'),
      )
    })
    const chunks: Buffer[] = []
    socket.on('data', (chunk: Buffer) => chunks.push(chunk))
    socket.on('error', reject)
    socket.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
  })
}

afterAll(async () => {
  await Promise.all(
    [server, catchAllServer, allowListServer].map(
      async (instance) =>
        await new Promise<void>((resolve, reject) => {
          instance.close((error) => {
            if (error) reject(error)
            else resolve()
          })
        }),
    ),
  )
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
 * GROK-REVIEW-431 F2: the absolute-form request line.
 *
 * h3 documents `getRequestURL().origin` as spoofable. Node's parser hands an
 * absolute-form target (`GET https://evil.example/... HTTP/1.1`) straight
 * through as `req.originalUrl`, and `new URL(absolute, base)` IGNORES the base
 * -- so the host in the request LINE, not the host the app was routed on, named
 * the claim.
 *
 * Measured on h3 1.15.11 (2026-09-17): `app.use('/api/mapkit-token', h)` never
 * reaches the handler for such a target -- the router matches on `event.path`
 * and 404s first. The guard therefore has to be proven where the target does
 * reach a handler: a catch-all mount, which is how a Nitro middleware or a
 * hand-rolled listener is written. Both mounts serve the SAME handler.
 */
describe('§F2 the request line cannot name the origin claim', () => {
  it('refuses an absolute-form request target instead of minting for its host', async () => {
    const raw = await rawRequest(
      catchAllPort,
      'https://evil.example/api/mapkit-token',
      'evil.example',
    )

    expect(raw).toContain('403 ')
    expect(raw).not.toContain('"token"')
    expect(raw).not.toContain('evil.example')
  })

  it('refuses a protocol-relative request target the same way', async () => {
    const raw = await rawRequest(catchAllPort, '//evil.example/api/mapkit-token', 'evil.example')

    expect(raw).toContain('403 ')
    expect(raw).not.toContain('"token"')
    expect(raw).not.toContain('evil.example')
  })

  it('still mints for an ordinary origin-form target over the same raw socket', async () => {
    const raw = await rawRequest(
      catchAllPort,
      '/api/mapkit-token',
      `127.0.0.1:${String(catchAllPort)}`,
    )

    expect(raw).toContain('200 ')
    expect(raw).toContain('"token"')
  })

  it('404s an absolute-form target before the handler on a path-mounted route', async () => {
    // Not our refusal -- h3's router. Recorded so a future h3 bump that starts
    // routing these lands on the guard above rather than on a mint.
    const raw = await rawRequest(
      (server.address() as AddressInfo).port,
      'https://evil.example/api/mapkit-token',
      'evil.example',
    )

    expect(raw).toContain('404 ')
    expect(raw).not.toContain('"token"')
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

describe('narduk-libs#437 a forged Host cannot name the origin claim once allowedHosts is set', () => {
  it('refuses an origin-form request whose Host is not on the list, and never echoes it', async () => {
    const raw = await rawRequest(allowListPort, '/api/mapkit-token', 'evil.example')

    expect(raw).toContain('403 ')
    expect(raw).not.toContain('"token"')
    expect(raw).not.toContain('evil.example')
  })

  it('mints for a listed host, with exactly that host in the claim', async () => {
    const raw = await rawRequest(allowListPort, '/api/mapkit-token', 'app.example')

    expect(raw).toContain('200 ')
    const token = /"token":"([^"]+)"/u.exec(raw)?.[1]
    expect(token).toBeDefined()
    expect(decodeJwt(token!).payload.origin).toBe('http://app.example')
  })

  it('matches a wildcard entry on a subdomain but not on its apex', async () => {
    const sub = await rawRequest(allowListPort, '/api/mapkit-token', 'pr-7.preview.example')
    const apex = await rawRequest(allowListPort, '/api/mapkit-token', 'preview.example')

    expect(sub).toContain('200 ')
    expect(apex).toContain('403 ')
  })

  it('treats an unset or empty list as allow-all, the Workers default', () => {
    expect(isMapKitHostAllowed('https://anything.example', undefined)).toBe(true)
    expect(isMapKitHostAllowed('https://anything.example', [])).toBe(true)
    expect(isMapKitHostAllowed('https://anything.example', ' , ')).toBe(true)
  })

  it('compares host and port case-insensitively, and reads a comma list from an env string', () => {
    expect(isMapKitHostAllowed('https://APP.example', ['app.example'])).toBe(true)
    expect(isMapKitHostAllowed('http://localhost:3000', 'localhost:3000, app.example')).toBe(true)
    expect(isMapKitHostAllowed('http://localhost:3001', 'localhost:3000')).toBe(false)
    expect(isMapKitHostAllowed('https://app.example.evil', ['app.example'])).toBe(false)
    expect(isMapKitHostAllowed('https://evilpreview.example', ['*.preview.example'])).toBe(false)
  })
})
