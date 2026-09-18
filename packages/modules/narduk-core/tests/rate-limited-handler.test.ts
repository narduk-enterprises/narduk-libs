import { createServer } from 'node:http'

import { createApp, defineEventHandler, toNodeListener } from 'h3'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createRateLimitWindowStore } from '../runtime/server/rate-limit/window'
import { setCacheProfile } from '../runtime/server/utils/cacheProfile'
import { defineRateLimitedHandler } from '../runtime/server/utils/rateLimitedHandler'

import type { RateLimitRuntimeConfig } from '../runtime/server/rate-limit/policy'
import type { EventHandler, H3Event } from 'h3'

/**
 * The handler reads its defaults from Nitro's runtime config, which only exists
 * inside a booted server. Mocking the module is the same seam
 * `tests/security-headers.test.ts` uses.
 */
const { runtime } = vi.hoisted(() => ({
  runtime: { value: {} as Record<string, unknown> },
}))
vi.mock('nitropack/runtime', () => ({ useRuntimeConfig: () => runtime.value }))
// setCacheProfile (used below to prove the 429 wins over an earlier 'live'
// call) reads this for its preview-safe-mode guard; it is unrelated to rate
// limiting, so it is stubbed the same way tests/cache-profile.test.ts does.
vi.mock('../runtime/server/utils/runtime-public', () => ({
  resolveRuntimePublicOverlay: () => ({ previewSafeMode: false }),
}))

const ROUTE = '/api/x'
const CLIENT_IP = '203.0.113.9'
const LIMIT_HEADER = 'ratelimit-limit'
const REMAINING_HEADER = 'ratelimit-remaining'
const RETRY_AFTER_HEADER = 'retry-after'

interface FetchResult {
  body: string
  headers: Headers
  status: number
}

/**
 * Drive the handler over a real h3 app on a real socket.
 *
 * A mocked event would prove what this code does to an object; a live request
 * proves the status line and the response headers a client actually receives —
 * which for the 429 path is the whole question, because the error response is
 * produced by h3's error handler rather than by the handler's own return.
 */
async function request(
  handler: EventHandler,
  paths: string[],
  decorate?: (event: H3Event) => void,
): Promise<FetchResult[]> {
  const app = createApp()
  if (decorate) {
    app.use(
      defineEventHandler((event) => {
        decorate(event)
      }),
    )
  }
  app.use('/', handler, { match: () => true })

  const server = createServer(toNodeListener(app))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected TCP listener')

  try {
    const results: FetchResult[] = []
    for (const path of paths) {
      const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
        headers: { 'cf-connecting-ip': CLIENT_IP },
      })
      results.push({
        body: await response.text(),
        headers: response.headers,
        status: response.status,
      })
    }
    return results
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
}

function limited(
  options: Parameters<typeof defineRateLimitedHandler>[1] = { key: 'test', limit: 2 },
) {
  return defineRateLimitedHandler(() => ({ ok: true }), {
    store: createRateLimitWindowStore(),
    ...options,
  })
}

function setConfig(nardukRateLimit: RateLimitRuntimeConfig) {
  runtime.value = { nardukRateLimit }
}

describe('defineRateLimitedHandler', () => {
  beforeEach(() => {
    runtime.value = {}
  })

  it('serves the wrapped handler while the caller is under the limit', async () => {
    const [first, second] = await request(limited(), [ROUTE, ROUTE])

    expect(first!.status).toBe(200)
    expect(first!.body).toBe('{"ok":true}')
    expect(second!.status).toBe(200)
  })

  it('answers 429 once the allowance is spent', async () => {
    const [, , third] = await request(limited(), [ROUTE, ROUTE, ROUTE])

    expect(third!.status).toBe(429)
    // A bare h3 app drops `message` from the serialized error; the status line
    // is what every runtime agrees on, so that is what is asserted here.
    expect(third!.body).toContain('"statusCode": 429')
    expect(third!.body).toContain('Too Many Requests')
  })

  it('publishes a countdown of the remaining allowance on every success', async () => {
    const [first, second] = await request(limited(), [ROUTE, ROUTE])

    expect(first!.headers.get(LIMIT_HEADER)).toBe('2')
    expect(first!.headers.get(REMAINING_HEADER)).toBe('1')
    expect(second!.headers.get(REMAINING_HEADER)).toBe('0')
    expect(first!.headers.get('ratelimit-policy')).toBe('"test";q=2;w=60')
    expect(first!.headers.get('ratelimit')).toBe('"test";r=1;t=60')
  })

  it('keeps Retry-After and the RateLimit headers on the 429 h3 builds', async () => {
    const [, , denied] = await request(limited(), [ROUTE, ROUTE, ROUTE])

    expect(denied!.status).toBe(429)
    expect(denied!.headers.get(RETRY_AFTER_HEADER)).toBe('60')
    expect(denied!.headers.get(REMAINING_HEADER)).toBe('0')
    expect(denied!.headers.get('ratelimit')).toBe('"test";r=0;t=60')
  })

  it('preserves the request correlation id on the 429', async () => {
    const [, , denied] = await request(limited(), [ROUTE, ROUTE, ROUTE])

    expect(denied!.headers.get('x-request-id')).toMatch(/\S/)
  })

  /**
   * narduk-libs#429: a 429 must never be storable at a shared cache. Asserted
   * against exact header values, never `not.toContain('public')` — that
   * assertion also passes for `no-cache`, which Cloudflare stores.
   */
  it('answers the 429 with exactly private, no-store and nothing cacheable', async () => {
    const [, , denied] = await request(limited(), [ROUTE, ROUTE, ROUTE])

    expect(denied!.status).toBe(429)
    expect(denied!.headers.get('cache-control')).toBe('private, no-store')
    expect(denied!.headers.get('cdn-cache-control')).toBeNull()
    expect(denied!.headers.get('cloudflare-cdn-cache-control')).toBeNull()
    expect(denied!.headers.get('surrogate-control')).toBeNull()
    expect(denied!.headers.get('cache-tag')).toBeNull()
    // Retry-After and the RateLimit-* family are not shared-cache headers and
    // must survive the strip.
    expect(denied!.headers.get(RETRY_AFTER_HEADER)).toBe('60')
  })

  it('overrides a live cache profile the route already set before the deny', async () => {
    const [, , denied] = await request(limited(), [ROUTE, ROUTE, ROUTE], (event) => {
      setCacheProfile(event, 'live', { tags: ['stations'] })
    })

    expect(denied!.status).toBe(429)
    expect(denied!.headers.get('cache-control')).toBe('private, no-store')
    expect(denied!.headers.get('cdn-cache-control')).toBeNull()
    expect(denied!.headers.get('cache-tag')).toBeNull()
  })

  it('does not touch the cache posture of a successful, unthrottled response', async () => {
    const [first] = await request(limited(), [ROUTE], (event) => {
      setCacheProfile(event, 'live', { tags: ['stations'] })
    })

    expect(first!.status).toBe(200)
    expect(first!.headers.get('cache-control')).toBe(
      'public, max-age=60, stale-while-revalidate=900',
    )
    expect(first!.headers.get('cdn-cache-control')).toBe(
      'public, max-age=300, stale-while-revalidate=900',
    )
    expect(first!.headers.get('cache-tag')).toBe('stations')
  })

  it('does not send Retry-After while the caller still has quota', async () => {
    const [first] = await request(limited(), [ROUTE])

    expect(first!.headers.get(RETRY_AFTER_HEADER)).toBeNull()
  })

  it('never limits the health, robots or sitemap surfaces', async () => {
    const handler = limited({ key: 'test', limit: 1 })
    const results = await request(handler, [
      '/api/health',
      '/api/health',
      '/api/health',
      '/robots.txt',
      '/robots.txt',
      '/__sitemap__/pages.xml',
      '/__sitemap__/pages.xml',
    ])

    expect(results.map((result) => result.status)).toEqual([200, 200, 200, 200, 200, 200, 200])
    // An exempt path is not counted, so it must not publish a quota either.
    expect(results[0]!.headers.get(LIMIT_HEADER)).toBeNull()
  })

  it('counts each client address separately', async () => {
    const handler = limited({ key: 'test', limit: 1 })
    let ip = '203.0.113.1'
    const app = createApp().use(
      '/',
      defineEventHandler(async (event) => {
        event.node.req.headers['cf-connecting-ip'] = ip
        return handler(event)
      }),
      { match: () => true },
    )
    const server = createServer(toNodeListener(app))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected TCP listener')

    try {
      const url = `http://127.0.0.1:${address.port}${ROUTE}`
      expect((await fetch(url)).status).toBe(200)
      expect((await fetch(url)).status).toBe(429)
      ip = '198.51.100.7'
      expect((await fetch(url)).status).toBe(200)
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      )
    }
  })

  it('shares one allowance across every caller in the global scope', async () => {
    const handler = limited({ key: 'test', limit: 1, scope: 'global' })
    const results = await request(handler, [ROUTE, '/api/y'])

    expect(results.map((result) => result.status)).toEqual([200, 429])
  })

  it('gives each path its own allowance in the ip-path scope', async () => {
    const handler = limited({ key: 'test', limit: 1, scope: 'ip-path' })
    const results = await request(handler, [ROUTE, '/api/y', ROUTE])

    expect(results.map((result) => result.status)).toEqual([200, 200, 429])
  })

  it('lets an operator retune the route through runtimeConfig without a code change', async () => {
    setConfig({ routes: { test: { limit: 1 } } })
    const results = await request(limited({ key: 'test', limit: 50 }), [ROUTE, ROUTE])

    expect(results.map((result) => result.status)).toEqual([200, 429])
    expect(results[0]!.headers.get(LIMIT_HEADER)).toBe('1')
  })

  it('stops limiting entirely when the runtimeConfig block is disabled', async () => {
    setConfig({ enabled: false })
    const results = await request(limited({ key: 'test', limit: 1 }), [ROUTE, ROUTE])

    expect(results.map((result) => result.status)).toEqual([200, 200])
    expect(results[0]!.headers.get(LIMIT_HEADER)).toBeNull()
  })

  it('honours a configured header family', async () => {
    setConfig({ headers: 'standard' })
    const [first] = await request(limited(), [ROUTE])

    expect(first!.headers.get('ratelimit')).toBe('"test";r=1;t=60')
    expect(first!.headers.get(LIMIT_HEADER)).toBeNull()
  })

  it('honours a runtimeConfig exemption list', async () => {
    setConfig({ exemptPaths: [ROUTE] })
    const results = await request(limited({ key: 'test', limit: 1 }), [ROUTE, ROUTE])

    expect(results.map((result) => result.status)).toEqual([200, 200])
  })

  it('refuses to build a route with an empty key', () => {
    expect(() => limited({ key: '' })).toThrow(TypeError)
  })
})

describe('defineRateLimitedHandler with the Cloudflare binding', () => {
  beforeEach(() => {
    runtime.value = {}
  })

  function bindEnv(binding: unknown, name = 'RL_5') {
    return (event: H3Event) => {
      ;(event.context as Record<string, unknown>).cloudflare = { env: { [name]: binding } }
    }
  }

  it('denies on the platform verdict even while the in-isolate window has quota', async () => {
    const limit = vi.fn().mockResolvedValue({ success: false })
    const results = await request(
      limited({ key: 'test', limit: 5, windowSeconds: 60 }),
      [ROUTE],
      bindEnv({ limit }),
    )

    expect(results[0]!.status).toBe(429)
    expect(results[0]!.headers.get(REMAINING_HEADER)).toBe('0')
    expect(results[0]!.headers.get(RETRY_AFTER_HEADER)).toBe('60')
    expect(limit).toHaveBeenCalledWith({ key: `test:${CLIENT_IP}` })
  })

  it('serves the route when the platform verdict permits it', async () => {
    const limit = vi.fn().mockResolvedValue({ success: true })
    const results = await request(
      limited({ key: 'test', limit: 5, windowSeconds: 60 }),
      [ROUTE],
      bindEnv({ limit }),
    )

    expect(results[0]!.status).toBe(200)
    expect(limit).toHaveBeenCalledTimes(1)
  })

  it('falls back to the in-isolate window when the binding throws', async () => {
    const limit = vi.fn().mockRejectedValue(new Error('binding unavailable'))
    const results = await request(
      limited({ key: 'test', limit: 1, windowSeconds: 60 }),
      [ROUTE, ROUTE],
      bindEnv({ limit }, 'RL_1'),
    )

    expect(results.map((result) => result.status)).toEqual([200, 429])
  })

  it('reaches an explicitly named binding, whatever the limit is', async () => {
    const limit = vi.fn().mockResolvedValue({ success: false })
    const results = await request(
      limited({ binding: 'MARINE_RL', key: 'test', limit: 5, windowSeconds: 45 }),
      [ROUTE],
      bindEnv({ limit }, 'MARINE_RL'),
    )

    expect(results[0]!.status).toBe(429)
  })

  it('ignores a same-named env value that is not a rate limit binding', async () => {
    const results = await request(
      limited({ key: 'test', limit: 5, windowSeconds: 60 }),
      [ROUTE],
      bindEnv('not-a-binding'),
    )

    expect(results[0]!.status).toBe(200)
  })

  it('does not look for a binding when the window is not one the period allows', async () => {
    const limit = vi.fn().mockResolvedValue({ success: false })
    const results = await request(
      limited({ key: 'test', limit: 5, windowSeconds: 45 }),
      [ROUTE],
      bindEnv({ limit }),
    )

    expect(results[0]!.status).toBe(200)
    expect(limit).not.toHaveBeenCalled()
  })
})

/** Drive a handler over a real socket with a caller-chosen client address per request. */
async function requestAs(
  handler: EventHandler,
  calls: Array<{ ip: string; path: string }>,
  decorate?: (event: H3Event) => void,
): Promise<number[]> {
  const app = createApp().use(
    '/',
    defineEventHandler(async (event) => {
      decorate?.(event)
      return handler(event)
    }),
    { match: () => true },
  )
  const server = createServer(toNodeListener(app))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected TCP listener')
  try {
    const statuses: number[] = []
    for (const call of calls) {
      const response = await fetch(`http://127.0.0.1:${address.port}${call.path}`, {
        headers: { 'cf-connecting-ip': call.ip },
      })
      await response.text()
      statuses.push(response.status)
    }
    return statuses
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
}

describe('defineRateLimitedHandler — IPv6 /64 buckets (narduk-libs#430)', () => {
  beforeEach(() => {
    runtime.value = {}
  })

  it('counts two addresses in one /64 against one allowance', async () => {
    const statuses = await requestAs(limited({ key: 'test', limit: 1 }), [
      { ip: '2001:db8:1:2::1', path: ROUTE },
      { ip: '2001:db8:1:2::2', path: ROUTE },
    ])

    expect(statuses).toEqual([200, 429])
  })

  it('gives a different /64 its own allowance', async () => {
    const statuses = await requestAs(limited({ key: 'test', limit: 1 }), [
      { ip: '2001:db8:1:2::1', path: ROUTE },
      { ip: '2001:db8:1:3::1', path: ROUTE },
    ])

    expect(statuses).toEqual([200, 200])
  })

  it('keys the Cloudflare binding on the /64 too', async () => {
    const limit = vi.fn().mockResolvedValue({ success: true })
    await requestAs(
      limited({ key: 'test', limit: 5, windowSeconds: 60 }),
      [{ ip: '2001:db8:1:2::abcd', path: ROUTE }],
      (event) => {
        ;(event.context as Record<string, unknown>).cloudflare = { env: { RL_5: { limit } } }
      },
    )

    expect(limit).toHaveBeenCalledWith({ key: 'test:2001:db8:1:2::/64' })
  })
})

describe('defineRateLimitedHandler — path variants share a bucket (narduk-libs#433)', () => {
  beforeEach(() => {
    runtime.value = {}
  })

  const variants = [
    '/api/mapkit-token/',
    '/api/mapkit-token?x=1',
    '/api/mapkit-token/?x=1',
    '/api/mapkit-%74oken',
  ]

  it.each(['ip', 'ip-path'] as const)(
    'a %s-scoped route answers 429 on every variant once the bare path is spent',
    async (scope) => {
      const handler = limited({ key: 'test', limit: 1, scope })
      const statuses = await requestAs(handler, [
        { ip: CLIENT_IP, path: '/api/mapkit-token' },
        ...variants.map((path) => ({ ip: CLIENT_IP, path })),
      ])

      expect(statuses).toEqual([200, 429, 429, 429, 429])
    },
  )

  it('still enforces the in-isolate window when no RL_* binding is declared', async () => {
    const statuses = await requestAs(limited({ key: 'test', limit: 1, windowSeconds: 60 }), [
      { ip: CLIENT_IP, path: ROUTE },
      { ip: CLIENT_IP, path: `${ROUTE}/` },
    ])

    expect(statuses).toEqual([200, 429])
  })
})
