import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createHtmlCacheMatcher,
  htmlCacheKey,
  isStorableHtml,
  resolveHtmlCacheOptions,
} from '../runtime/shared/html-cache'

const { runtime } = vi.hoisted(() => ({
  runtime: {
    app: { buildId: 'build-1' },
    nardukHtmlCache: { routes: ['/food', '/places/*'], ttlSeconds: 600 } as unknown,
    nardukSecurityHeaders: { mode: 'off' as string },
  },
}))

vi.mock('nitropack/runtime', () => ({
  defineNitroPlugin: (plugin: unknown) => plugin,
  useRuntimeConfig: () => runtime,
}))

const { default: plugin } = await import('../runtime/server/plugins/html-cache')

const NONCE_FRESH = 'nonce-fresh'
const NONCE_OLD = 'nonce-old'
const HTML_BODY = '<html></html>'

type Hook = (...args: never[]) => unknown

class MemoryCache {
  readonly values = new Map<string, Response>()
  async match(key: string) {
    return this.values.get(key)?.clone()
  }
  async put(key: string, response: Response) {
    this.values.set(key, response.clone())
  }
}

let cache: MemoryCache

function installedHooks(): Record<string, Hook> {
  const hooks: Record<string, Hook> = {}
  ;(plugin as unknown as (nitro: unknown) => void)({
    hooks: { hook: (name: string, handler: Hook) => (hooks[name] = handler) },
  })
  return hooks
}

function fakeEvent(path: string, headers: Record<string, string> = {}, context = {}) {
  const waits: Array<Promise<unknown>> = []
  return {
    waits,
    event: {
      path,
      method: 'GET',
      context: { ...context },
      node: {
        req: { headers: { host: 'example.test', ...headers } },
        res: { getHeader: () => {} },
      },
      waitUntil: (p: Promise<unknown>) => waits.push(p),
    },
  }
}

async function request(path: string, headers: Record<string, string> = {}, context = {}) {
  const hooks = installedHooks()
  const { event, waits } = fakeEvent(path, headers, context)
  const before = { event, response: undefined as unknown }
  await (hooks['render:before'] as unknown as (c: unknown) => Promise<void>)(before)
  return {
    hit: before.response as { body: string; headers: Record<string, string> } | undefined,
    respond: async (response: Record<string, unknown>) => {
      await (hooks['render:response'] as unknown as (r: unknown, c: unknown) => unknown)(response, {
        event,
      })
      await Promise.all(waits)
      return response
    },
  }
}

beforeEach(() => {
  cache = new MemoryCache()
  ;(globalThis as Record<string, unknown>).caches = { default: cache }
  runtime.app.buildId = 'build-1'
  runtime.nardukSecurityHeaders.mode = 'off'
  runtime.nardukHtmlCache = { routes: ['/food', '/places/*'], ttlSeconds: 600 }
})

describe('html cache options and keys', () => {
  it('defaults ttlSeconds to 600 and rejects bad shapes', () => {
    expect(resolveHtmlCacheOptions({ routes: ['/food'] })).toEqual({
      routes: ['/food'],
      ttlSeconds: 600,
    })
    expect(resolveHtmlCacheOptions(undefined)).toBeNull()
    expect(resolveHtmlCacheOptions(false)).toBeNull()
    expect(() => resolveHtmlCacheOptions({ routes: [] })).toThrow('non-empty')
    expect(() => resolveHtmlCacheOptions({ routes: ['food'] })).toThrow('path pattern')
    expect(() => resolveHtmlCacheOptions({ routes: ['/a/**/b'] })).toThrow('last segment')
    expect(() => resolveHtmlCacheOptions({ routes: ['/a'], ttlSeconds: 0 })).toThrow('ttlSeconds')
  })

  it('matches exact paths, one-segment stars and a trailing **', () => {
    const matches = createHtmlCacheMatcher(['/food', '/places/*', '/zip/**', '/'])
    expect(['/food', '/places/x-1', '/zip', '/zip/78704/a', '/'].map(matches)).toEqual([
      true,
      true,
      true,
      true,
      true,
    ])
    expect(['/food/x', '/places', '/places/a/b', '/other', '/foods'].map(matches)).toEqual([
      false,
      false,
      false,
      false,
      false,
    ])
  })

  it('keys by build id and host', () => {
    const matches = createHtmlCacheMatcher(['/food'])
    const req = { headers: new Headers(), host: 'a.test', method: 'GET', path: '/food' }
    expect(htmlCacheKey(req, 'b1', matches)).not.toBe(htmlCacheKey(req, 'b2', matches))
    expect(htmlCacheKey(req, 'b1', matches)).not.toBe(
      htmlCacheKey({ ...req, host: 'b.test' }, 'b1', matches),
    )
    expect(htmlCacheKey({ ...req, path: '/food?x=1' }, 'b1', matches)).toBeNull()
    expect(htmlCacheKey({ ...req, method: 'HEAD' }, 'b1', matches)).toBeNull()
  })

  it('does not store a noindex render', () => {
    expect(isStorableHtml('<meta name="robots" content="noindex, nofollow">')).toBe(false)
    expect(isStorableHtml('<meta name="robots" content="index, follow">')).toBe(true)
  })
})

describe('html-cache plugin', () => {
  it('misses, stores, then serves a hit', async () => {
    const first = await request('/food')
    expect(first.hit).toBeUndefined()
    const response = await first.respond({
      statusCode: 200,
      body: '<html>food</html>',
      headers: {},
    })
    expect((response.headers as Record<string, string>)['x-html-cache']).toBe('miss')
    expect(cache.values.size).toBe(1)
    expect([...cache.values.values()][0]?.headers.get('cache-control')).toBe('public, max-age=600')

    const second = await request('/food')
    expect(second.hit?.body).toBe('<html>food</html>')
    expect(second.hit?.headers['x-html-cache']).toBe('hit')
  })

  it('bypasses a request with a Cookie or Authorization header, a query or another path', async () => {
    for (const [path, headers] of [
      ['/food', { cookie: 'a=b' }],
      ['/food', { authorization: 'Bearer x' }],
      ['/food?x=1', {}],
      ['/admin', {}],
    ] as const) {
      const r = await request(path, headers)
      await r.respond({ statusCode: 200, body: HTML_BODY, headers: {} })
      expect(cache.values.size, path).toBe(0)
    }
  })

  it('does not store a Set-Cookie response or a non-200', async () => {
    const withCookie = await request('/food')
    await withCookie.respond({
      statusCode: 200,
      body: HTML_BODY,
      headers: { 'Set-Cookie': 'a=b' },
    })
    const notFound = await request('/places/x')
    await notFound.respond({ statusCode: 404, body: HTML_BODY, headers: {} })
    expect(cache.values.size).toBe(0)
  })

  describe('on a nonce-CSP app (D-HTML-CACHE-PUBLIC-1)', () => {
    beforeEach(() => {
      runtime.nardukSecurityHeaders.mode = 'enforce'
    })

    it('stores the nonce with the page and restores it on a hit', async () => {
      const first = await request('/food', {}, { security: { nonce: NONCE_OLD } })
      await first.respond({
        statusCode: 200,
        body: '<script nonce="nonce-old"></script>',
        headers: {},
      })
      expect([...cache.values.values()][0]?.headers.get('x-narduk-html-nonce')).toBe(NONCE_OLD)

      const context = { security: { nonce: NONCE_FRESH } }
      const second = await request('/food', {}, context)
      expect(second.hit?.body).toBe('<script nonce="nonce-old"></script>')
      // The CSP header is built from this nonce in render:response, so it matches the HTML.
      expect(context.security.nonce).toBe(NONCE_OLD)
    })

    it('never serves a cookie request from the cache and keeps its fresh nonce', async () => {
      const seed = await request('/food', {}, { security: { nonce: NONCE_OLD } })
      await seed.respond({ statusCode: 200, body: '<html>cached</html>', headers: {} })

      const context = { security: { nonce: NONCE_FRESH } }
      const cookie = await request('/food', { cookie: 'session=1' }, context)
      expect(cookie.hit).toBeUndefined()
      expect(context.security.nonce).toBe(NONCE_FRESH)
    })

    it('does not answer a nonce request from an entry stored without a nonce', async () => {
      const seed = await request('/food')
      await seed.respond({ statusCode: 200, body: '<html>plain</html>', headers: {} })
      const next = await request('/food', {}, { security: { nonce: NONCE_FRESH } })
      expect(next.hit).toBeUndefined()
    })

    it('nonce-csp-cache still forces no-store on a covered route for a cookie request', async () => {
      const { default: noncePlugin } = await import('../runtime/server/plugins/nonce-csp-cache')
      const nonceHooks: Record<string, Hook> = {}
      ;(noncePlugin as unknown as (nitro: unknown) => void)({
        hooks: { hook: (name: string, handler: Hook) => (nonceHooks[name] = handler) },
      })
      const htmlHooks = installedHooks()
      const seed = await request('/food', {}, { security: { nonce: NONCE_OLD } })
      await seed.respond({ statusCode: 200, body: '<html>cached</html>', headers: {} })

      const { event } = fakeEvent(
        '/food',
        { cookie: 'session=1' },
        { security: { nonce: NONCE_FRESH } },
      )
      const ctx = { event, response: undefined as unknown }
      await (htmlHooks['render:before'] as unknown as (c: unknown) => Promise<void>)(ctx)
      ;(nonceHooks['render:before'] as unknown as (c: unknown) => void)(ctx)
      expect(ctx.response).toBeUndefined()
      const response = {
        statusCode: 200,
        body: '<html>fresh</html>',
        headers: {
          'content-type': 'text/html;charset=utf-8',
          'cache-control': 'public, max-age=60',
        },
      }
      ;(nonceHooks['render:response'] as unknown as (r: unknown, c: unknown) => void)(response, ctx)
      expect(response.headers['cache-control']).toBe('private, no-store')
      expect((event.context as { security: { nonce: string } }).security.nonce).toBe(NONCE_FRESH)
    })
  })

  it('misses after the build id changes', async () => {
    const first = await request('/food')
    await first.respond({ statusCode: 200, body: '<html>old</html>', headers: {} })
    runtime.app.buildId = 'build-2'
    const next = await request('/food')
    expect(next.hit).toBeUndefined()
  })

  it('is off without the option, and for a robots-noindexed request', async () => {
    const noindex = await request('/food', {}, { robots: { indexable: false } })
    await noindex.respond({ statusCode: 200, body: HTML_BODY, headers: {} })
    runtime.nardukHtmlCache = undefined
    const off = await request('/food')
    await off.respond({ statusCode: 200, body: HTML_BODY, headers: {} })
    expect(cache.values.size).toBe(0)
  })
})
