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
import { readPreferences } from '../runtime/server/utils/preferences'
import { markPreferencesInfluenced } from '../runtime/shared/utils/preferences'

import type {
  CacheProfileInput,
  SetCacheProfileOptions,
} from '../runtime/server/utils/cacheProfile'
import type { H3Event } from 'h3'

const NO_STORE = 'private, no-store'
const ACCEPT_ENCODING = 'Accept-Encoding'
const HEADER_CACHE_CONTROL = 'cache-control'
const HEADER_CDN_CACHE_CONTROL = 'cdn-cache-control'
const VARY_COOKIE = 'cookie'
const VARY_ACCEPT_LANGUAGE = 'accept-language'
const VARY_ACCEPT_ENCODING = 'accept-encoding'

function varyTokens(headers: Headers): string[] {
  return (headers.get('vary') ?? '')
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean)
}

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
    cacheControl: headers.get(HEADER_CACHE_CONTROL),
    cacheTag: headers.get('cache-tag'),
    cdnCacheControl: headers.get(HEADER_CDN_CACHE_CONTROL),
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
    expect(headers.get(HEADER_CACHE_CONTROL)).toBe(NO_STORE)
    expect(headers.get(HEADER_CDN_CACHE_CONTROL)).toBeNull()
    expect(headers.get('cache-tag')).toBeNull()
  })

  it('refuses to cache a response that already carries a Set-Cookie', async () => {
    const { headers } = await respond((event) => {
      event.node.res.setHeader('Set-Cookie', 'session=abc; Path=/')
      setCacheProfile(event, 'live', { tags: ['stations'] })
    })
    expect(headers.get(HEADER_CACHE_CONTROL)).toBe(NO_STORE)
    expect(headers.get(HEADER_CDN_CACHE_CONTROL)).toBeNull()
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

describe('preference-influenced responses', () => {
  /**
   * A body whose units, time zone or locale came from the reader's preference
   * cookie belongs to that reader (narduk-libs#386). Reading preferences marks
   * the event; the profile is then forced to `none` with `Vary: Cookie,
   * Accept-Language`, leftover CDN headers are stripped, and a route that never
   * touched preferences is unaffected.
   */
  it('downgrades a shared-cacheable profile to private, no-store', async () => {
    const { headers } = await respond((event) => {
      markPreferencesInfluenced(event)
      setCacheProfile(event, 'live')
    })

    expect(headers.get(HEADER_CACHE_CONTROL)).toBe(NO_STORE)
    expect(headers.get(HEADER_CDN_CACHE_CONTROL)).toBeNull()
    expect(varyTokens(headers)).toEqual(expect.arrayContaining([VARY_COOKIE, VARY_ACCEPT_LANGUAGE]))
  })

  it('reports the suppression so a caller can see why', async () => {
    const reasons: Array<string | undefined> = []
    await respond((event) => {
      markPreferencesInfluenced(event)
      reasons.push(setCacheProfile(event, 'live').suppressedBy)
    })

    expect(reasons).toEqual(['preferences-cookie'])
  })

  it('merges Cookie into a Vary the route already asked for', async () => {
    const { headers } = await respond((event) => {
      markPreferencesInfluenced(event)
      setCacheProfile(event, 'live', { vary: [ACCEPT_ENCODING] })
    })

    expect(varyTokens(headers)).toEqual(
      expect.arrayContaining([VARY_ACCEPT_ENCODING, VARY_COOKIE, VARY_ACCEPT_LANGUAGE]),
    )
  })

  it('changes nothing for a route that never read preferences', async () => {
    expect(await cacheHeaders('live')).toMatchObject({
      cacheControl: 'public, max-age=60, stale-while-revalidate=900',
      cdnCacheControl: 'public, max-age=300, stale-while-revalidate=900',
      vary: null,
    })
  })

  it('downgrades when setCacheProfile runs before the event is marked', async () => {
    const { headers } = await respond((event) => {
      setCacheProfile(event, 'live', { tags: ['stations'] })
      markPreferencesInfluenced(event)
    })

    expect(headers.get(HEADER_CACHE_CONTROL)).toBe(NO_STORE)
    expect(headers.get(HEADER_CDN_CACHE_CONTROL)).toBeNull()
    expect(headers.get('cloudflare-cdn-cache-control')).toBeNull()
    expect(headers.get('surrogate-control')).toBeNull()
    expect(headers.get('cache-tag')).toBeNull()
  })

  it('stays private when setCacheProfile is called again after a mark', async () => {
    const { headers } = await respond((event) => {
      setCacheProfile(event, 'live', { tags: ['stations'] })
      markPreferencesInfluenced(event)
      setCacheProfile(event, 'live', { tags: ['stations'] })
    })

    expect(headers.get(HEADER_CACHE_CONTROL)).toBe(NO_STORE)
    expect(headers.get(HEADER_CDN_CACHE_CONTROL)).toBeNull()
    expect(headers.get('cache-tag')).toBeNull()
  })

  it('downgrades when the documented call order is setCacheProfile then readPreferences', async () => {
    const { headers } = await respond((event) => {
      setCacheProfile(event, 'live', { tags: ['stations'] })
      readPreferences(event)
    })

    expect(headers.get(HEADER_CACHE_CONTROL)).toBe(NO_STORE)
    expect(headers.get(HEADER_CDN_CACHE_CONTROL)).toBeNull()
    expect(headers.get('cache-tag')).toBeNull()
  })

  it('merges Cookie and Accept-Language into Vary on a marked response', async () => {
    const { headers } = await respond((event) => {
      markPreferencesInfluenced(event)
      setCacheProfile(event, 'live', { vary: [ACCEPT_ENCODING] })
    })

    expect(varyTokens(headers)).toEqual(
      expect.arrayContaining([VARY_ACCEPT_ENCODING, VARY_COOKIE, VARY_ACCEPT_LANGUAGE]),
    )
  })

  it('does not clobber an existing Accept-Language Vary token', async () => {
    const { headers } = await respond((event) => {
      event.node.res.setHeader('Vary', 'Accept-Language')
      markPreferencesInfluenced(event)
      setCacheProfile(event, 'live')
    })

    const vary = varyTokens(headers)
    expect(vary.filter((name) => name === VARY_ACCEPT_LANGUAGE)).toHaveLength(1)
    expect(vary).toEqual(expect.arrayContaining([VARY_ACCEPT_LANGUAGE, VARY_COOKIE]))
  })
})
