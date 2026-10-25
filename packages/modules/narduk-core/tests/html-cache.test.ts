import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useSkipHtmlCache } from '../runtime/app/composables/useSkipHtmlCache'
import { skipHtmlCache } from '../runtime/server/utils/html-cache-skip'
import {
  createHtmlCacheMatcher,
  createHtmlCacheTtlResolver,
  HTML_CACHE_MAX_PATH_LENGTH,
  htmlCacheKey,
  isStorableHtml,
  NE_HTML_CACHE_SKIP_CONTEXT_KEY,
  normalizeHtmlCachePath,
  resolveHtmlCacheOptions,
  restampNonce,
} from '../runtime/shared/html-cache'

const { requestEvent } = vi.hoisted(() => ({
  requestEvent: { current: undefined as { context: Record<string, unknown> } | undefined },
}))

vi.mock('#imports', () => ({ useRequestEvent: () => requestEvent.current }))

const { runtime } = vi.hoisted(() => ({
  runtime: {
    app: { buildId: 'build-1' },
    nardukHtmlCache: { routes: ['/food', '/places/*'], ttlSeconds: 600 } as unknown,
    nardukSecurityHeaders: { mode: 'off' as string },
    public: { previewSafeMode: false as unknown },
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
let resCookie: string | undefined

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
      context: { robots: { indexable: true }, ...context },
      node: {
        req: { headers: { host: 'example.test', ...headers } },
        res: { getHeader: (name: string) => (name === 'set-cookie' ? resCookie : undefined) },
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
  resCookie = undefined
  ;(globalThis as Record<string, unknown>).caches = { default: cache }
  runtime.app.buildId = 'build-1'
  runtime.nardukSecurityHeaders.mode = 'off'
  runtime.public.previewSafeMode = false
  runtime.nardukHtmlCache = { routes: ['/food', '/places/*'], ttlSeconds: 600 }
})

describe('html cache options and keys', () => {
  it('defaults ttlSeconds to 600 and rejects bad shapes', () => {
    expect(resolveHtmlCacheOptions({ routes: ['/food'] })).toEqual({
      queryKeys: [],
      requireIndexable: true,
      routes: ['/food'],
      routeTtls: [],
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

  it('normalizes dot segments, encoding and the query allowlist', () => {
    expect(normalizeHtmlCachePath('/a/../b')).toEqual({ path: '/b', query: '' })
    expect(normalizeHtmlCachePath('/a/./b/%2e%2e/c')).toEqual({ path: '/a/c', query: '' })
    expect(normalizeHtmlCachePath('/caf\u00e9')).toEqual({ path: '/caf%C3%A9', query: '' })
    expect(normalizeHtmlCachePath('/caf%C3%A9')).toEqual({ path: '/caf%C3%A9', query: '' })
    expect(normalizeHtmlCachePath('/b?x=1')).toBeNull()
    expect(normalizeHtmlCachePath('/b?page=2&sort=a', ['page', 'sort'])).toEqual({
      path: '/b',
      query: '?page=2&sort=a',
    })
    // Repeated names keep their value order: ?page=2&page=1 is a different request than ?page=1&page=2.
    expect(normalizeHtmlCachePath('/b?page=2&page=1', ['page'])?.query).toBe('?page=2&page=1')
    expect(normalizeHtmlCachePath('/b?page=1&page=2', ['page'])?.query).toBe('?page=1&page=2')
    expect(normalizeHtmlCachePath('/b?sort=a&page=2', ['page', 'sort'])).toEqual({
      path: '/b',
      query: '?page=2&sort=a',
    })
    expect(normalizeHtmlCachePath('/b?page=2&utm=x', ['page'])).toBeNull()
    for (const bad of ['b', '//evil.test/x', '/a\\b', '']) {
      expect(normalizeHtmlCachePath(bad)).toBeNull()
    }
  })

  it('keys by build id and host', () => {
    const matches = createHtmlCacheMatcher(['/food'])
    const req = { headers: new Headers(), host: 'a.test', method: 'GET', path: '/food' }
    expect(htmlCacheKey(req, 'b1', matches)).not.toBe(htmlCacheKey(req, 'b2', matches))
    expect(htmlCacheKey(req, 'b1', matches)).not.toBe(
      htmlCacheKey({ ...req, host: 'b.test' }, 'b1', matches),
    )
    expect(htmlCacheKey({ ...req, path: '/food?x=1' }, 'b1', matches)).toBeNull()
    expect(htmlCacheKey({ ...req, path: '/food?x=1' }, 'b1', matches, ['x'])).toContain('/food?x=1')
    expect(htmlCacheKey({ ...req, host: '' }, 'b1', matches)).toBeNull()
    expect(htmlCacheKey({ ...req, method: 'HEAD' }, 'b1', matches)).toBeNull()
  })

  it('does not store a noindex render', () => {
    expect(isStorableHtml('<meta name="robots" content="noindex, nofollow">')).toBe(false)
    expect(isStorableHtml('<meta name="robots" content="index, follow">')).toBe(true)
  })
  it('restampNonce swaps every occurrence, passes through without a stored nonce, and refuses a nonce-less request', () => {
    const stored = { body: '<a nonce="o+1/"></a><b nonce="o+1/">', nonce: 'o+1/' }
    expect(restampNonce(stored, 'new')).toBe('<a nonce="new"></a><b nonce="new">')
    expect(restampNonce(stored, 'o+1/')).toBe(stored.body)
    expect(restampNonce(stored, undefined)).toBeNull()
    expect(restampNonce({ body: '<p>x</p>', nonce: null }, 'n')).toBe('<p>x</p>')
    expect(restampNonce({ body: '<p>x</p>', nonce: null }, undefined)).toBe('<p>x</p>')
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

    it('stamps every hit with its own nonce, matching the CSP source built from it', async () => {
      const first = await request('/food', {}, { security: { nonce: NONCE_OLD } })
      await first.respond({
        statusCode: 200,
        body: '<script nonce="nonce-old"></script><link nonce="nonce-old"><style nonce="nonce-old">',
        headers: {},
      })
      // The stored copy keeps the original nonce.
      expect([...cache.values.values()][0]?.headers.get('x-narduk-html-nonce')).toBe(NONCE_OLD)

      const bodies: string[] = []
      for (const nonce of ['nonce-a', 'nonce-b']) {
        const context = { security: { nonce } }
        const hit = (await request('/food', {}, context)).hit
        expect(hit?.headers['x-html-cache']).toBe('hit')
        // nuxt-security builds the CSP header from context.security.nonce in render:response:
        // it is still this request's own nonce, and it is the one in every nonce= attribute.
        expect(context.security.nonce).toBe(nonce)
        expect(hit?.body).toBe(
          `<script nonce="${nonce}"></script><link nonce="${nonce}"><style nonce="${nonce}">`,
        )
        expect(hit?.body).not.toContain(NONCE_OLD)
        bodies.push(hit?.body ?? '')
      }
      expect(bodies[0]).not.toBe(bodies[1])
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
      expect((event.context as unknown as { security: { nonce: string } }).security.nonce).toBe(
        NONCE_FRESH,
      )
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

  it('requires robots indexable === true by default; requireIndexable: false only skips the missing flag', async () => {
    const unknown = await request('/food', {}, { robots: undefined })
    await unknown.respond({ statusCode: 200, body: HTML_BODY, headers: {} })
    expect(cache.values.size).toBe(0)
    runtime.nardukHtmlCache = { routes: ['/food'], requireIndexable: false }
    const open = await request('/food', {}, { robots: undefined })
    await open.respond({ statusCode: 200, body: HTML_BODY, headers: {} })
    expect(cache.values.size).toBe(1)
    cache.values.clear()
    const noindex = await request('/food', {}, { robots: { indexable: false } })
    await noindex.respond({ statusCode: 200, body: HTML_BODY, headers: {} })
    expect(cache.values.size).toBe(0)
  })

  it('stores through waitUntil, 200s only, and refuses Set-Cookie on res or response.headers', async () => {
    const ok = await request('/food')
    await ok.respond({ statusCode: 200, body: HTML_BODY, headers: {} })
    expect(cache.values.size).toBe(1)

    cache.values.clear()
    resCookie = 'a=b'
    const onRes = await request('/food')
    await onRes.respond({ statusCode: 200, body: HTML_BODY, headers: {} })
    resCookie = undefined
    const onHeaders = await request('/food')
    await onHeaders.respond({
      statusCode: 200,
      body: HTML_BODY,
      headers: { 'set-cookie': ['a=b'] },
    })
    for (const statusCode of [201, 301, 404, 500]) {
      const other = await request('/food')
      await other.respond({ statusCode, body: HTML_BODY, headers: {} })
    }
    expect(cache.values.size).toBe(0)
  })

  it('does not block the response on the cache write: put is handed to waitUntil', async () => {
    const hooks = installedHooks()
    const { event, waits } = fakeEvent('/food')
    const before = { event, response: undefined as unknown }
    await (hooks['render:before'] as unknown as (c: unknown) => Promise<void>)(before)
    const result = (hooks['render:response'] as unknown as (r: unknown, c: unknown) => unknown)(
      { statusCode: 200, body: HTML_BODY, headers: {} },
      { event },
    )
    await result
    expect(waits).toHaveLength(1)
  })

  it('only canonical paths are cached: aliases that normalize elsewhere always render', async () => {
    const first = await request('/places/b')
    await first.respond({ statusCode: 200, body: '<html>b</html>', headers: {} })
    expect([...cache.values.keys()]).toEqual([
      'https://example.test/__narduk/html-cache/build-1/places/b',
    ])
    expect((await request('/places/b')).hit?.body).toBe('<html>b</html>')
    // Nuxt renders the raw path, so an alias must neither read nor write the canonical key.
    for (const alias of [
      '/places/a/../b',
      '/places/%62',
      '/places/%2e%2e/places/b',
      '/places/./b',
      '/places/../admin',
      '/places/%2e%2e/admin',
    ]) {
      const r = await request(alias)
      expect(r.hit, alias).toBeUndefined()
      await r.respond({ statusCode: 200, body: '<html>alias</html>', headers: {} })
    }
    const slash = await request('/places/a%2Fb')
    await slash.respond({ statusCode: 200, body: '<html>slash</html>', headers: {} })
    expect([...cache.values.keys()]).toHaveLength(2)
    expect((await request('/places/b')).hit?.body).toBe('<html>b</html>')
  })
})

describe('per-route ttlSeconds', () => {
  it('accepts plain strings and { path, ttlSeconds } entries, and records the overrides in order', () => {
    expect(
      resolveHtmlCacheOptions({
        routes: ['/map', { path: '/stations', ttlSeconds: 120 }, { path: '/about' }],
        ttlSeconds: 300,
      }),
    ).toEqual({
      queryKeys: [],
      requireIndexable: true,
      routes: ['/map', '/stations', '/about'],
      routeTtls: [{ path: '/stations', ttlSeconds: 120 }],
      ttlSeconds: 300,
    })
  })

  it('rejects a bad entry at setup', () => {
    expect(() => resolveHtmlCacheOptions({ routes: [{ ttlSeconds: 5 }] })).toThrow('string `path`')
    expect(() => resolveHtmlCacheOptions({ routes: [{ path: 'nope', ttlSeconds: 5 }] })).toThrow(
      'path pattern',
    )
    for (const ttlSeconds of [0, -1, 1.5, '60', null]) {
      expect(() => resolveHtmlCacheOptions({ routes: [{ path: '/a', ttlSeconds }] })).toThrow(
        'ttlSeconds must be a positive integer',
      )
    }
    expect(() => resolveHtmlCacheOptions({ routes: [42] })).toThrow('non-empty')
    expect(() => resolveHtmlCacheOptions({ routes: [['/a']] })).toThrow('non-empty')
  })

  it('the first matching entry wins, its own TTL or else the top-level one', () => {
    const ttlFor = createHtmlCacheTtlResolver(
      resolveHtmlCacheOptions({
        routes: [
          { path: '/guides/wind', ttlSeconds: 60 },
          { path: '/guides/**', ttlSeconds: 900 },
          '/guides/tides',
          { path: '/guides/tides', ttlSeconds: 5 },
          '/map',
        ],
        ttlSeconds: 300,
      })!,
    )
    expect(ttlFor('/guides/wind')).toBe(60)
    expect(ttlFor('/guides/tides')).toBe(900)
    expect(ttlFor('/guides')).toBe(900)
    expect(ttlFor('/map')).toBe(300)
    expect(ttlFor('/other')).toBeUndefined()
  })

  it('stores each route with its own max-age', async () => {
    runtime.nardukHtmlCache = {
      routes: ['/map', { path: '/stations', ttlSeconds: 120 }],
      ttlSeconds: 600,
    }
    for (const path of ['/map', '/stations']) {
      const r = await request(path)
      await r.respond({ statusCode: 200, body: `<html>${path}</html>`, headers: {} })
    }
    const ages = Object.fromEntries(
      [...cache.values].map(([key, value]) => [
        key.split('/build-1')[1],
        value.headers.get('cache-control'),
      ]),
    )
    expect(ages).toEqual({ '/map': 'public, max-age=600', '/stations': 'public, max-age=120' })
    expect((await request('/stations')).hit?.body).toBe('<html>/stations</html>')
  })
})

describe('never-store and never-read guards', () => {
  it('a render flagged by skipHtmlCache is not stored out of the cache and marks the response', async () => {
    const skipped = await request('/food', {}, { [NE_HTML_CACHE_SKIP_CONTEXT_KEY]: true })
    const response = await skipped.respond({ statusCode: 200, body: HTML_BODY, headers: {} })
    expect((response.headers as Record<string, string>)['x-html-cache']).toBe('skip')
    expect(cache.values.size).toBe(0)
  })

  it('skipHtmlCache and useSkipHtmlCache set the flag, and tolerate a missing event', () => {
    const event = { context: {} as Record<string, unknown> }
    skipHtmlCache(event as never)
    expect(event.context[NE_HTML_CACHE_SKIP_CONTEXT_KEY]).toBe(true)
    expect(() => skipHtmlCache(undefined)).not.toThrow()

    requestEvent.current = { context: {} }
    useSkipHtmlCache()
    expect(requestEvent.current.context[NE_HTML_CACHE_SKIP_CONTEXT_KEY]).toBe(true)
    requestEvent.current = undefined
    expect(() => useSkipHtmlCache()).not.toThrow()
  })

  it('does not store a render that read preferences', async () => {
    const r = await request('/food', {}, { nardukPreferencesInfluenced: true })
    const response = await r.respond({ statusCode: 200, body: HTML_BODY, headers: {} })
    expect(cache.values.size).toBe(0)
    expect((response.headers as Record<string, string>)['x-html-cache']).toBeUndefined()
  })

  it('neither reads nor writes under previewSafeMode', async () => {
    const warm = await request('/food')
    await warm.respond({ statusCode: 200, body: '<html>warm</html>', headers: {} })
    expect(cache.values.size).toBe(1)
    runtime.public.previewSafeMode = true
    const preview = await request('/food')
    expect(preview.hit).toBeUndefined()
    await preview.respond({ statusCode: 200, body: '<html>preview</html>', headers: {} })
    expect([...cache.values.values()]).toHaveLength(1)
    runtime.public.previewSafeMode = false
    expect((await request('/food')).hit?.body).toBe('<html>warm</html>')
  })

  it('skips paths longer than the bound, in the plugin and the key helpers', async () => {
    runtime.nardukHtmlCache = { routes: ['/food/**'] }
    const ok = `/food/${'a'.repeat(HTML_CACHE_MAX_PATH_LENGTH - '/food/'.length)}`
    const long = `${ok}a`
    expect(ok).toHaveLength(HTML_CACHE_MAX_PATH_LENGTH)
    expect(normalizeHtmlCachePath(ok)).not.toBeNull()
    expect(normalizeHtmlCachePath(long)).toBeNull()
    const matches = createHtmlCacheMatcher(['/food/**'])
    const headers = new Headers()
    expect(
      htmlCacheKey({ headers, host: 'h.test', method: 'GET', path: long }, 'b', matches),
    ).toBeNull()
    const r = await request(long)
    await r.respond({ statusCode: 200, body: HTML_BODY, headers: {} })
    expect(cache.values.size).toBe(0)
    const within = await request(ok)
    await within.respond({ statusCode: 200, body: HTML_BODY, headers: {} })
    expect(cache.values.size).toBe(1)
  })
})
