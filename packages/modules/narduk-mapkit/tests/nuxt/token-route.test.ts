/**
 * The published token route (§e), served by a real h3 listener.
 *
 * `tests/token-route-h3.test.ts` pins the two lines a consumer must write. This
 * pins the route the module registers on the consumer's behalf, because in
 * 2.1.0 the app no longer writes them: `nardukMapKit: { tokenRoute: true }` is
 * the whole configuration, so the route's origin claim is the library's
 * correctness, not the app's.
 */
import { createApp, toNodeListener } from 'h3'
import { connect } from 'node:net'
import { createServer } from 'node:http'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { clearMapKitTokenCacheForTests } from '../../src/server/index.js'
import { decodeJwt } from '../../src/token/index.js'
import { createTestPrivateKeyPem } from '../test-keys.js'

import { resetNuxtImportsStub, setTestRuntimeConfig } from './nuxt-imports.js'

import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'

/** What a same-origin browser fetch sends; §e refuses a request without it. */
const SAME_ORIGIN = { 'sec-fetch-site': 'same-origin' }

let base: string
let server: Server
/** The same handler mounted catch-all: h3's router 404s an absolute-form path. */
let catchAllPort: number
let catchAllServer: Server

beforeAll(async () => {
  const privateKey = await createTestPrivateKeyPem()
  setTestRuntimeConfig({
    appleKeyId: 'KEY1234567',
    applePrivateKey: privateKey,
    appleTeamId: 'TEAM123456',
    // A high ceiling: the limiter's own arithmetic is pinned in
    // tests/nuxt/rate-limit.test.ts, and it is process-wide per instance.
    nardukMapKit: { rateLimit: { limit: 1000, windowSeconds: 60 } },
    public: {},
  })

  const tokenRoute = (await import('../../src/nuxt/runtime/server/mapkit-token.get.js')).default
  const catchAll = (
    await import('../../src/nuxt/runtime/server/mapkit-token.method-not-allowed.js')
  ).default

  const app = createApp()
  app.use('/api/mapkit-token', tokenRoute, { match: (_url, event) => event?.method === 'GET' })
  app.use('/api/mapkit-token', catchAll)

  server = createServer(toNodeListener(app))
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`

  // A Nitro middleware or hand-rolled listener mounts the same handler with no
  // path, which is where an absolute-form request target actually reaches it.
  const catchAllApp = createApp()
  catchAllApp.use(tokenRoute)
  catchAllServer = createServer(toNodeListener(catchAllApp))
  await new Promise<void>((resolve) => {
    catchAllServer.listen(0, '127.0.0.1', resolve)
  })
  catchAllPort = (catchAllServer.address() as AddressInfo).port
})

/** `fetch` cannot send an absolute-form request line, so this speaks HTTP/1.1. */
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
  resetNuxtImportsStub()
  await Promise.all(
    [server, catchAllServer].map(
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

describe('the module-registered token route (§e)', () => {
  it('answers a token whose origin claim is the routed host', async () => {
    const response = await fetch(`${base}/api/mapkit-token`, { headers: SAME_ORIGIN })

    expect(response.status).toBe(200)
    const body = (await response.json()) as { expiresAt: number; token: string }
    const claims = decodeJwt(body.token).payload as { iss: string; origin: string }
    expect(claims.origin).toBe(base)
    expect(claims.iss).toBe('TEAM123456')
  })

  it('ignores X-Forwarded-Host, which is attacker-controllable', async () => {
    const response = await fetch(`${base}/api/mapkit-token`, {
      headers: { ...SAME_ORIGIN, 'x-forwarded-host': 'evil.example' },
    })

    const body = (await response.json()) as { token: string }
    const claims = decodeJwt(body.token).payload as { origin: string }
    expect(claims.origin).toBe(base)
    expect(claims.origin).not.toContain('evil.example')
  })

  it('is never cached by a shared cache', async () => {
    const response = await fetch(`${base}/api/mapkit-token`, { headers: SAME_ORIGIN })

    expect(response.headers.get('cache-control')).toContain('no-store')
  })

  it('sends x-content-type-options: nosniff, like every other response', async () => {
    const response = await fetch(`${base}/api/mapkit-token`, { headers: SAME_ORIGIN })

    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('refuses Origin: null, which is an opaque origin and not a same-origin claim', async () => {
    const response = await fetch(`${base}/api/mapkit-token`, {
      headers: { ...SAME_ORIGIN, origin: 'null' },
    })

    expect(response.status).toBe(403)
  })

  it('refuses an absolute-form request target instead of minting for its host', async () => {
    const raw = await rawRequest(
      catchAllPort,
      'http://evil.example/api/mapkit-token',
      `127.0.0.1:${String(catchAllPort)}`,
    )

    expect(raw).toContain('403 ')
    expect(raw).not.toContain('evil.example"')
  })

  it('still mints for an ordinary origin-form target over the same raw socket', async () => {
    const raw = await rawRequest(
      catchAllPort,
      '/api/mapkit-token',
      `127.0.0.1:${String(catchAllPort)}`,
    )

    expect(raw).toContain('200 ')
  })

  it('answers 405 with Allow for a non-GET', async () => {
    const response = await fetch(`${base}/api/mapkit-token`, {
      headers: SAME_ORIGIN,
      method: 'POST',
    })

    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('GET')
  })
})

describe('the route ceiling', () => {
  it('refuses with 429 and a retry-after once the configured limit is spent', async () => {
    // The fallback limiter is memoized per server instance, so a test that
    // lowers the ceiling has to drop the one the tests above already built.
    const { default: handler, resetMapKitRateLimitForTests } =
      await import('../../src/nuxt/runtime/server/mapkit-token.get.js')
    resetMapKitRateLimitForTests()
    setTestRuntimeConfig({
      appleKeyId: 'KEY1234567',
      applePrivateKey: await createTestPrivateKeyPem(),
      appleTeamId: 'TEAM123456',
      nardukMapKit: { rateLimit: { limit: 1, windowSeconds: 60 } },
      public: {},
    })

    const app = createApp()
    app.use('/api/mapkit-token', handler)
    const limited = createServer(toNodeListener(app))
    await new Promise<void>((resolve) => {
      limited.listen(0, '127.0.0.1', resolve)
    })
    const url = `http://127.0.0.1:${String((limited.address() as AddressInfo).port)}/api/mapkit-token`

    try {
      expect((await fetch(url, { headers: SAME_ORIGIN })).status).toBe(200)
      const second = await fetch(url, { headers: SAME_ORIGIN })
      expect(second.status).toBe(429)
      expect(Number(second.headers.get('retry-after'))).toBeGreaterThan(0)
    } finally {
      resetMapKitRateLimitForTests()
      await new Promise<void>((resolve) => {
        limited.close(() => {
          resolve()
        })
      })
    }
  })
})
