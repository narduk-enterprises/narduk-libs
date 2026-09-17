import { createServer } from 'node:http'

import { createApp, defineEventHandler, toNodeListener } from 'h3'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  CACHE_PROFILES,
  normalizeCacheTags,
  normalizeVary,
  resolveCacheProfile,
  setCacheProfile,
} from '../runtime/server/utils/cacheProfile'

import type {
  CacheProfileInput,
  SetCacheProfileOptions,
} from '../runtime/server/utils/cacheProfile'
import type { H3Event } from 'h3'

const NO_STORE = 'private, no-store'
const ACCEPT_ENCODING = 'Accept-Encoding'

const { overlay, runtime } = vi.hoisted(() => ({
  overlay: { previewSafeMode: false },
  runtime: {} as { cache?: { profiles?: Record<string, Record<string, unknown>> } },
}))

vi.mock('nitropack/runtime', () => ({ useRuntimeConfig: () => runtime }))
vi.mock('../runtime/server/utils/runtime-public', () => ({
  resolveRuntimePublicOverlay: () => overlay,
}))

/**
 * Drive the helper through a real h3 request so the assertions read the headers
 * a client would actually receive, not a mock's record of calls.
 */
async function respond(
  handler: (event: H3Event) => void,
): Promise<{ body: string; headers: Headers; status: number }> {
  const app = createApp().use(
    defineEventHandler((event) => {
      handler(event)
      return 'ok'
    }),
  )
  const server = createServer(toNodeListener(app))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected TCP listener')
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/`)
    return { body: await response.text(), headers: response.headers, status: response.status }
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
}

function cacheHeaders(input: CacheProfileInput, options?: SetCacheProfileOptions) {
  return respond((event) => {
    setCacheProfile(event, input, options)
  }).then(({ headers }) => ({
    cacheControl: headers.get('cache-control'),
    cacheTag: headers.get('cache-tag'),
    cdnCacheControl: headers.get('cdn-cache-control'),
    vary: headers.get('vary'),
  }))
}

afterEach(() => {
  overlay.previewSafeMode = false
  delete runtime.cache
  vi.unstubAllGlobals()
})

describe('named profiles', () => {
  it('splits the live profile across browser and edge headers', async () => {
    expect(await cacheHeaders('live')).toMatchObject({
      cacheControl: 'public, max-age=60, stale-while-revalidate=900',
      cdnCacheControl: 'public, max-age=300, stale-while-revalidate=900',
    })
  })

  it('splits the slow profile across browser and edge headers', async () => {
    expect(await cacheHeaders('slow')).toMatchObject({
      cacheControl: 'public, max-age=300, stale-while-revalidate=1800',
      cdnCacheControl: 'public, max-age=900, stale-while-revalidate=1800',
    })
  })

  it('splits the static profile across browser and edge headers', async () => {
    expect(await cacheHeaders('static')).toMatchObject({
      cacheControl: 'public, max-age=300, stale-while-revalidate=86400',
      cdnCacheControl: 'public, max-age=3600, stale-while-revalidate=86400',
    })
  })

  it('emits nothing cacheable for the none profile', async () => {
    expect(await cacheHeaders('none')).toMatchObject({
      cacheControl: NO_STORE,
      cdnCacheControl: null,
    })
  })

  /**
   * The defect the helper exists to prevent: `s-maxage` disables
   * `stale-while-revalidate` and `stale-if-error` (RFC 9111 §4.2.4, and
   * Cloudflare's Workers Caching docs), so a profile that emitted both would
   * silently lose its stale window.
   */
  it('never emits s-maxage on any profile', async () => {
    for (const name of Object.keys(CACHE_PROFILES) as Array<keyof typeof CACHE_PROFILES>) {
      const { cacheControl, cdnCacheControl } = await cacheHeaders(name)
      expect(`${cacheControl} ${cdnCacheControl}`).not.toContain('s-maxage')
    }
  })

  it('accepts an inline profile for a route with its own numbers', async () => {
    expect(await cacheHeaders({ maxAge: 30, sMaxAge: 120, swr: 600 })).toMatchObject({
      cacheControl: 'public, max-age=30, stale-while-revalidate=600',
      cdnCacheControl: 'public, max-age=120, stale-while-revalidate=600',
    })
  })

  it('keeps a private inline profile off the edge entirely', async () => {
    expect(await cacheHeaders({ maxAge: 30, private: true, sMaxAge: 999, swr: 60 })).toMatchObject({
      cacheControl: 'private, max-age=30, stale-while-revalidate=60',
      cdnCacheControl: null,
    })
  })

  it('omits a zero stale window rather than emitting swr=0', async () => {
    expect(await cacheHeaders({ maxAge: 60, sMaxAge: 60, swr: 0 })).toMatchObject({
      cacheControl: 'public, max-age=60',
      cdnCacheControl: 'public, max-age=60',
    })
  })
})

describe('runtimeConfig.cache.profiles overrides', () => {
  it('applies a partial override and keeps the rest of the profile', async () => {
    runtime.cache = { profiles: { live: { sMaxAge: 30 } } }
    expect(await cacheHeaders('live')).toMatchObject({
      cacheControl: 'public, max-age=60, stale-while-revalidate=900',
      cdnCacheControl: 'public, max-age=30, stale-while-revalidate=900',
    })
  })

  it('ignores a negative or non-integer override rather than emitting it', async () => {
    runtime.cache = { profiles: { live: { maxAge: -5, sMaxAge: 1.5, swr: '900' } } }
    expect(await cacheHeaders('live')).toMatchObject({
      cacheControl: 'public, max-age=60, stale-while-revalidate=900',
      cdnCacheControl: 'public, max-age=300, stale-while-revalidate=900',
    })
  })

  it('lets an app turn a profile off entirely', async () => {
    runtime.cache = { profiles: { live: { noStore: true } } }
    expect(await cacheHeaders('live')).toMatchObject({
      cacheControl: NO_STORE,
      cdnCacheControl: null,
    })
  })

  it('leaves an inline profile untouched by configuration', () => {
    runtime.cache = { profiles: { live: { maxAge: 1 } } }
    const inline = { maxAge: 42, sMaxAge: 84, swr: 168 }
    expect(resolveCacheProfile({} as H3Event, inline)).toBe(inline)
  })

  it('does not mutate the shared profile constant', () => {
    runtime.cache = { profiles: { live: { maxAge: 1 } } }
    resolveCacheProfile({} as H3Event, 'live')
    expect(CACHE_PROFILES.live.maxAge).toBe(60)
  })
})

describe('no-cache guards', () => {
  it('refuses to cache an error response', async () => {
    const { headers, status } = await respond((event) => {
      event.node.res.statusCode = 503
      setCacheProfile(event, 'live', { tags: ['stations'] })
    })
    expect(status).toBe(503)
    expect(headers.get('cache-control')).toBe(NO_STORE)
    expect(headers.get('cdn-cache-control')).toBeNull()
    expect(headers.get('cache-tag')).toBeNull()
  })

  it('refuses to cache a response that already carries a Set-Cookie', async () => {
    const { headers } = await respond((event) => {
      event.node.res.setHeader('Set-Cookie', 'session=abc; Path=/')
      setCacheProfile(event, 'live', { tags: ['stations'] })
    })
    expect(headers.get('cache-control')).toBe(NO_STORE)
    expect(headers.get('cdn-cache-control')).toBeNull()
    expect(headers.get('cache-tag')).toBeNull()
  })

  it('refuses to cache in preview safe mode', async () => {
    overlay.previewSafeMode = true
    expect(await cacheHeaders('live', { tags: ['stations'] })).toMatchObject({
      cacheControl: NO_STORE,
      cacheTag: null,
      cdnCacheControl: null,
    })
  })

  it('refuses to cache a Vary: * response, which Cloudflare bypasses anyway', async () => {
    expect(await cacheHeaders('live', { tags: ['stations'], vary: ['*'] })).toMatchObject({
      cacheControl: NO_STORE,
      cacheTag: null,
      cdnCacheControl: null,
      vary: '*',
    })
  })

  it('reports which guard fired instead of failing silently', async () => {
    const reasons: Array<string | undefined> = []
    await respond((event) => {
      event.node.res.statusCode = 500
      reasons.push(setCacheProfile(event, 'live').suppressedBy)
    })
    await respond((event) => {
      overlay.previewSafeMode = true
      reasons.push(setCacheProfile(event, 'live').suppressedBy)
      overlay.previewSafeMode = false
    })
    await respond((event) => {
      reasons.push(setCacheProfile(event, 'live').suppressedBy)
    })
    expect(reasons).toEqual(['error-status', 'preview-safe-mode', undefined])
  })
})

describe('Cache-Tag', () => {
  it('emits a comma-separated tag list for purge-by-tag', async () => {
    expect(await cacheHeaders('live', { tags: ['stations', 'published-data'] })).toMatchObject({
      cacheTag: 'stations,published-data',
    })
  })

  it('omits the header when no tags are requested', async () => {
    expect((await cacheHeaders('live')).cacheTag).toBeNull()
  })

  it('never tags an uncacheable response', async () => {
    expect((await cacheHeaders('none', { tags: ['stations'] })).cacheTag).toBeNull()
  })

  it('drops tags Cloudflare would reject and keeps the rest', () => {
    expect(
      normalizeCacheTags([
        'stations',
        'has space',
        'has,comma',
        'café',
        '',
        'x'.repeat(1025),
        'x'.repeat(1024),
      ]),
    ).toEqual(['stations', 'x'.repeat(1024)])
  })

  it('deduplicates case-insensitively, matching purge-time matching', () => {
    expect(normalizeCacheTags(['Stations', 'stations', 'STATIONS', 'regions'])).toEqual([
      'Stations',
      'regions',
    ])
  })

  it('caps the list at the documented 1000 tags per response', () => {
    const tags = Array.from({ length: 1200 }, (_, index) => `tag-${index}`)
    expect(normalizeCacheTags(tags)).toHaveLength(1000)
  })

  it('omits the header when every requested tag was invalid', async () => {
    expect((await cacheHeaders('live', { tags: ['has space', 'also bad'] })).cacheTag).toBeNull()
  })
})

describe('Vary', () => {
  it('emits the requested header names', async () => {
    expect((await cacheHeaders('live', { vary: [ACCEPT_ENCODING] })).vary).toBe(ACCEPT_ENCODING)
  })

  it('merges with a Vary another handler already set', async () => {
    const { headers } = await respond((event) => {
      event.node.res.setHeader('Vary', ACCEPT_ENCODING)
      setCacheProfile(event, 'live', { vary: ['Accept-Language'] })
    })
    expect(headers.get('vary')).toBe('Accept-Encoding, Accept-Language')
  })

  it('deduplicates case-insensitively while preserving the first spelling', () => {
    expect(normalizeVary(['Accept-Encoding, accept-language'], ['ACCEPT-ENCODING'])).toBe(
      'Accept-Encoding, accept-language',
    )
  })

  it('collapses to the wildcard when either side asks for it', () => {
    expect(normalizeVary([ACCEPT_ENCODING], ['*'])).toBe('*')
    expect(normalizeVary(['*'], [ACCEPT_ENCODING])).toBe('*')
  })

  it('emits no Vary when nothing varies', () => {
    expect(normalizeVary([], undefined)).toBeUndefined()
    expect(normalizeVary([], [])).toBeUndefined()
  })
})
