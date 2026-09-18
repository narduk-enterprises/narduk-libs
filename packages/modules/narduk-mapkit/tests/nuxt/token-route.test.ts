/**
 * The published token route (§e), served by a real h3 listener.
 *
 * `tests/token-route-h3.test.ts` pins the two lines a consumer must write. This
 * pins the route the module registers on the consumer's behalf, because in
 * 2.1.0 the app no longer writes them: `nardukMapKit: { tokenRoute: true }` is
 * the whole configuration, so the route's origin claim is the library's
 * correctness, not the app's.
 */
import { createApp, defineEventHandler, toNodeListener } from 'h3'
import { connect } from 'node:net'
import { createServer } from 'node:http'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { clearMapKitTokenCacheForTests } from '../../src/server/index.js'
import { decodeJwt } from '../../src/token/index.js'
import { createTestPrivateKeyPem } from '../test-keys.js'

import { resetNuxtImportsStub, setTestRuntimeConfig } from './nuxt-imports.js'

import type { MapKitRateLimitHook } from '../../src/server/handler.js'
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
    // No `nardukMapKit` block: the route's default is no rate limit at all.
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

  it('refuses a protocol-relative request target the same way', async () => {
    const raw = await rawRequest(
      catchAllPort,
      '//evil.example/api/mapkit-token',
      `127.0.0.1:${String(catchAllPort)}`,
    )

    expect(raw).toContain('403 ')
    expect(raw).not.toContain('evil.example"')
  })

  it('refuses a request with no Origin, no Referer, and no Sec-Fetch-Site', async () => {
    const response = await fetch(`${base}/api/mapkit-token`)

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ error: 'not-same-origin' })
  })

  it('never emits Access-Control-Allow-Origin', async () => {
    const allowed = await fetch(`${base}/api/mapkit-token`, { headers: SAME_ORIGIN })
    const refused = await fetch(`${base}/api/mapkit-token`)

    expect(allowed.headers.get('access-control-allow-origin')).toBeNull()
    expect(refused.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('mints with a 1800 s TTL, not the 2.0.x 24 h window', async () => {
    const response = await fetch(`${base}/api/mapkit-token`, { headers: SAME_ORIGIN })
    const body = (await response.json()) as { token: string }
    const claims = decodeJwt(body.token).payload as { exp: number; iat: number }

    expect(claims.exp - claims.iat).toBe(1800)
  })

  it('answers 405 with Allow for a non-GET', async () => {
    const response = await fetch(`${base}/api/mapkit-token`, {
      headers: SAME_ORIGIN,
      method: 'POST',
    })

    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('GET')
  })

  it('still mints a GET that lands on the method catch-all, so a shadow cannot 503 the map', async () => {
    // Nitro registers the method-less handler for every method. If that file
    // is a dummy with empty credentials, a GET that reaches it 503s an
    // otherwise configured route. The catch-all has to be the same handler.
    const catchAllOnly = (
      await import('../../src/nuxt/runtime/server/mapkit-token.method-not-allowed.js')
    ).default
    const app = createApp()
    app.use('/api/mapkit-token', catchAllOnly)
    const only = createServer(toNodeListener(app))
    await new Promise<void>((resolve) => {
      only.listen(0, '127.0.0.1', resolve)
    })
    const url = `http://127.0.0.1:${String((only.address() as AddressInfo).port)}/api/mapkit-token`

    try {
      const response = await fetch(url, { headers: SAME_ORIGIN })
      expect(response.status).toBe(200)
      const body = (await response.json()) as { token?: string }
      expect(typeof body.token).toBe('string')
    } finally {
      await new Promise<void>((resolve) => {
        only.close(() => {
          resolve()
        })
      })
    }
  })
})

/**
 * Serve the route alone under `nardukMapKit` runtime config, optionally behind a
 * middleware that mounts an app-owned limiter on the event context.
 */
async function withRoute(
  nardukMapKit: Record<string, unknown> | undefined,
  run: (url: string) => Promise<void>,
  mounted?: MapKitRateLimitHook,
): Promise<void> {
  // The fallback limiter is memoized per server instance, so a test that
  // changes the ceiling has to drop the one the tests above already built.
  const { default: handler, resetMapKitRateLimitForTests } =
    await import('../../src/nuxt/runtime/server/mapkit-token.get.js')
  resetMapKitRateLimitForTests()
  setTestRuntimeConfig({
    appleKeyId: 'KEY1234567',
    applePrivateKey: await createTestPrivateKeyPem(),
    appleTeamId: 'TEAM123456',
    ...(nardukMapKit === undefined ? {} : { nardukMapKit }),
    public: {},
  })

  const app = createApp()
  if (mounted) {
    app.use(
      defineEventHandler((event) => {
        ;(event.context as { nardukMapKit?: unknown }).nardukMapKit = { rateLimit: mounted }
      }),
    )
  }
  app.use('/api/mapkit-token', handler)
  const only = createServer(toNodeListener(app))
  await new Promise<void>((resolve) => {
    only.listen(0, '127.0.0.1', resolve)
  })
  try {
    await run(`http://127.0.0.1:${String((only.address() as AddressInfo).port)}/api/mapkit-token`)
  } finally {
    resetMapKitRateLimitForTests()
    await new Promise<void>((resolve) => {
      only.close(() => {
        resolve()
      })
    })
  }
}

async function statuses(url: string, count: number): Promise<number[]> {
  const seen: number[] = []
  for (let index = 0; index < count; index += 1) {
    seen.push((await fetch(url, { headers: SAME_ORIGIN })).status)
  }
  return seen
}

describe('the route ceiling (opt-in, narduk-libs#485)', () => {
  it('applies no limit at all when the app sets no rateLimit', async () => {
    // Past the old 30 / 60 s default: an unconfigured route must never 429.
    await withRoute(undefined, async (url) => {
      expect(new Set(await statuses(url, 40))).toStrictEqual(new Set([200]))
    })
  })

  it('applies no limit when the module published an empty nardukMapKit block', async () => {
    // What the module now writes when `rateLimit` is omitted.
    await withRoute({}, async (url) => {
      expect(new Set(await statuses(url, 40))).toStrictEqual(new Set([200]))
    })
  })

  it('refuses with 429 and a retry-after once an opted-in limit is spent', async () => {
    await withRoute({ rateLimit: { limit: 1, windowSeconds: 60 } }, async (url) => {
      expect((await fetch(url, { headers: SAME_ORIGIN })).status).toBe(200)
      const second = await fetch(url, { headers: SAME_ORIGIN })
      expect(second.status).toBe(429)
      expect(Number(second.headers.get('retry-after'))).toBeGreaterThan(0)
    })
  })

  it('still honours a limiter the app mounts on event.context with no rateLimit set', async () => {
    const mounted = vi.fn<MapKitRateLimitHook>(() => ({ allowed: false, retryAfterSeconds: 7 }))
    await withRoute(
      undefined,
      async (url) => {
        const refused = await fetch(url, { headers: SAME_ORIGIN })
        expect(refused.status).toBe(429)
        expect(refused.headers.get('retry-after')).toBe('7')
      },
      mounted,
    )
    expect(mounted).toHaveBeenCalledTimes(1)
  })

  it('lets a mounted limiter win over an opted-in rateLimit', async () => {
    const mounted = vi.fn<MapKitRateLimitHook>(() => true)
    await withRoute(
      { rateLimit: { limit: 1, windowSeconds: 60 } },
      async (url) => {
        expect(await statuses(url, 3)).toStrictEqual([200, 200, 200])
      },
      mounted,
    )
    expect(mounted).toHaveBeenCalledTimes(3)
  })
})
