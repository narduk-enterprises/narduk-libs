import { describe, expect, it } from 'vitest'

import { buildRateLimitHeaders } from '../runtime/server/rate-limit/headers'
import {
  isRateLimitExemptPath,
  RATE_LIMIT_DEFAULT_EXEMPT_PATHS,
  rateLimitCounterKey,
  resolveBindingName,
  resolveExemptPaths,
  resolveRoutePolicy,
} from '../runtime/server/rate-limit/policy'
import {
  createRateLimitWindowStore,
  RATE_LIMIT_MAX_TRACKED_KEYS,
} from '../runtime/server/rate-limit/window'

import type { ResolvedRateLimitPolicy } from '../runtime/server/rate-limit/policy'

const WINDOW_MS = 60_000
const CLIENT_IP = '203.0.113.9'

describe('in-isolate rate limit window', () => {
  it('permits exactly `limit` requests per window and denies the next', () => {
    const store = createRateLimitWindowStore()
    const verdicts = [1, 2, 3, 4].map(() => store.consume('k', 3, WINDOW_MS, 1_000))

    expect(verdicts.map((v) => v.allowed)).toEqual([true, true, true, false])
    expect(verdicts.map((v) => v.remaining)).toEqual([2, 1, 0, 0])
  })

  it('reopens the window once its span has elapsed, not before', () => {
    const store = createRateLimitWindowStore()
    store.consume('k', 1, WINDOW_MS, 0)

    // One millisecond short of the boundary the window is still closed.
    expect(store.consume('k', 1, WINDOW_MS, WINDOW_MS - 1).allowed).toBe(false)
    expect(store.consume('k', 1, WINDOW_MS, WINDOW_MS).allowed).toBe(true)
  })

  it('counts each key independently', () => {
    const store = createRateLimitWindowStore()
    expect(store.consume('a', 1, WINDOW_MS, 0).allowed).toBe(true)
    expect(store.consume('b', 1, WINDOW_MS, 0).allowed).toBe(true)
    expect(store.consume('a', 1, WINDOW_MS, 0).allowed).toBe(false)
  })

  it('reports a reset that counts down toward the window boundary', () => {
    const store = createRateLimitWindowStore()
    store.consume('k', 5, WINDOW_MS, 0)

    expect(store.consume('k', 5, WINDOW_MS, 0).resetSeconds).toBe(60)
    expect(store.consume('k', 5, WINDOW_MS, 30_000).resetSeconds).toBe(30)
    // Never zero: a client told to retry in 0s retries immediately and is denied.
    expect(store.consume('k', 5, WINDOW_MS, WINDOW_MS - 1).resetSeconds).toBe(1)
  })

  it('sets retryAfterSeconds only on a denial', () => {
    const store = createRateLimitWindowStore()
    expect(store.consume('k', 1, WINDOW_MS, 0).retryAfterSeconds).toBeUndefined()
    expect(store.consume('k', 1, WINDOW_MS, 0).retryAfterSeconds).toBe(60)
  })

  it('denies everything when the limit is zero rather than dividing by it', () => {
    const store = createRateLimitWindowStore()
    const verdict = store.consume('k', 0, WINDOW_MS, 0)

    expect(verdict.allowed).toBe(false)
    expect(verdict.remaining).toBe(0)
  })

  it('bounds the tracked key space so a client-controlled key cannot grow it forever', () => {
    const store = createRateLimitWindowStore()
    for (let index = 0; index < RATE_LIMIT_MAX_TRACKED_KEYS + 500; index += 1) {
      store.consume(`key-${index}`, 10, WINDOW_MS, 0)
    }

    expect(store.size).toBeLessThanOrEqual(RATE_LIMIT_MAX_TRACKED_KEYS)
  })

  it('still enforces the newest keys after an eviction sweep', () => {
    const store = createRateLimitWindowStore()
    for (let index = 0; index < RATE_LIMIT_MAX_TRACKED_KEYS + 10; index += 1) {
      store.consume(`key-${index}`, 1, WINDOW_MS, 0)
    }

    expect(store.consume('key-last', 1, WINDOW_MS, 0).allowed).toBe(true)
    expect(store.consume('key-last', 1, WINDOW_MS, 0).allowed).toBe(false)
  })
})

describe('exempt paths', () => {
  it('exempts the health, robots and sitemap surfaces by default', () => {
    for (const path of ['/api/health', '/robots.txt', '/sitemap.xml', '/__sitemap__/pages.xml']) {
      expect(isRateLimitExemptPath(path, RATE_LIMIT_DEFAULT_EXEMPT_PATHS)).toBe(true)
    }
  })

  it('does not exempt an ordinary api route', () => {
    expect(isRateLimitExemptPath('/api/stations', RATE_LIMIT_DEFAULT_EXEMPT_PATHS)).toBe(false)
  })

  it('ignores the query string, so a cache-buster cannot defeat an exemption', () => {
    expect(isRateLimitExemptPath('/api/health?t=1', RATE_LIMIT_DEFAULT_EXEMPT_PATHS)).toBe(true)
  })

  it('does not let a prefix of an exempt path match it', () => {
    expect(isRateLimitExemptPath('/api/healthz', RATE_LIMIT_DEFAULT_EXEMPT_PATHS)).toBe(false)
    expect(isRateLimitExemptPath('/robots.txt.map', RATE_LIMIT_DEFAULT_EXEMPT_PATHS)).toBe(false)
  })

  it('inherits the defaults when the app configures nothing', () => {
    expect(resolveExemptPaths(undefined)).toBe(RATE_LIMIT_DEFAULT_EXEMPT_PATHS)
    expect(resolveExemptPaths({})).toBe(RATE_LIMIT_DEFAULT_EXEMPT_PATHS)
  })

  it('honours an explicitly empty list as "exempt nothing"', () => {
    expect(resolveExemptPaths({ exemptPaths: [] })).toEqual([])
    expect(isRateLimitExemptPath('/api/health', resolveExemptPaths({ exemptPaths: [] }))).toBe(
      false,
    )
  })

  it('replaces rather than extends the defaults when a list is given', () => {
    const paths = resolveExemptPaths({ exemptPaths: ['/status'] })
    expect(isRateLimitExemptPath('/status', paths)).toBe(true)
    expect(isRateLimitExemptPath('/api/health', paths)).toBe(false)
  })
})

describe('policy resolution', () => {
  it('falls back to the package defaults', () => {
    const policy = resolveRoutePolicy({ key: 'marine' }, undefined)

    expect(policy).toMatchObject({ enabled: true, headers: 'both', limit: 120, scope: 'ip' })
    expect(policy.windowSeconds).toBe(60)
  })

  it('prefers the call site over the runtimeConfig defaults', () => {
    const policy = resolveRoutePolicy(
      { key: 'marine', limit: 10 },
      { limit: 500, windowSeconds: 30 },
    )

    expect(policy.limit).toBe(10)
    expect(policy.windowSeconds).toBe(30)
  })

  it('lets a per-key runtimeConfig override beat the call site, so an operator can retune', () => {
    const policy = resolveRoutePolicy(
      { key: 'marine', limit: 10, windowSeconds: 60 },
      { routes: { marine: { limit: 4, windowSeconds: 10 } } },
    )

    expect(policy.limit).toBe(4)
    expect(policy.windowSeconds).toBe(10)
  })

  it('treats `enabled` as an AND, so the block switch disables every route', () => {
    expect(resolveRoutePolicy({ key: 'marine' }, { enabled: false }).enabled).toBe(false)
    expect(resolveRoutePolicy({ key: 'marine', enabled: false }, {}).enabled).toBe(false)
    expect(
      resolveRoutePolicy({ key: 'marine' }, { routes: { marine: { enabled: false } } }).enabled,
    ).toBe(false)
  })

  it('rejects a non-positive or non-integer override instead of adopting it', () => {
    const policy = resolveRoutePolicy(
      { key: 'marine', limit: 10 },
      { routes: { marine: { limit: 0, windowSeconds: -5 } } },
    )

    expect(policy.limit).toBe(10)
    expect(policy.windowSeconds).toBe(60)
  })

  it('refuses an empty key at definition time', () => {
    expect(() => resolveRoutePolicy({ key: '  ' }, undefined)).toThrow(TypeError)
  })
})

describe('counter keys', () => {
  const base: ResolvedRateLimitPolicy = {
    enabled: true,
    headers: 'both',
    key: 'marine',
    limit: 10,
    scope: 'ip',
    windowSeconds: 60,
  }

  it('keys on the client address by default', () => {
    expect(rateLimitCounterKey(base, CLIENT_IP, '/api/a')).toBe('marine:203.0.113.9')
    expect(rateLimitCounterKey(base, CLIENT_IP, '/api/b')).toBe('marine:203.0.113.9')
  })

  it('adds the path for the ip-path scope', () => {
    const policy = { ...base, scope: 'ip-path' as const }
    expect(rateLimitCounterKey(policy, CLIENT_IP, '/api/a?q=1')).toBe('marine:203.0.113.9:/api/a')
    expect(rateLimitCounterKey(policy, CLIENT_IP, '/api/b')).not.toBe(
      rateLimitCounterKey(policy, CLIENT_IP, '/api/a'),
    )
  })

  it('ignores the caller for the global scope', () => {
    const policy = { ...base, scope: 'global' as const }
    expect(rateLimitCounterKey(policy, CLIENT_IP, '/api/a')).toBe(
      rateLimitCounterKey(policy, '198.51.100.1', '/api/b'),
    )
  })

  it('collapses an unresolvable address into one bucket rather than exempting it', () => {
    expect(rateLimitCounterKey(base, undefined, '/api/a')).toBe('marine:unknown')
  })
})

describe('binding resolution', () => {
  const base: ResolvedRateLimitPolicy = {
    enabled: true,
    headers: 'both',
    key: 'marine',
    limit: 120,
    scope: 'ip',
    windowSeconds: 60,
  }

  it('uses the package RL_<limit> convention for a one-minute window', () => {
    expect(resolveBindingName(base)).toBe('RL_120')
  })

  it('claims no binding for a window the Cloudflare period cannot express', () => {
    expect(resolveBindingName({ ...base, windowSeconds: 45 })).toBeUndefined()
  })

  it('prefers an explicitly named binding', () => {
    expect(resolveBindingName({ ...base, binding: 'MARINE_RL' })).toBe('MARINE_RL')
  })

  it('reads a per-key binding name out of runtimeConfig', () => {
    const policy = resolveRoutePolicy({ key: 'marine' }, { bindings: { marine: 'MARINE_RL' } })
    expect(resolveBindingName(policy)).toBe('MARINE_RL')
  })
})

describe('RateLimit response headers', () => {
  const allowed = { allowed: true, limit: 120, remaining: 119, resetSeconds: 60 }
  const denied = {
    allowed: false,
    limit: 120,
    remaining: 0,
    resetSeconds: 17,
    retryAfterSeconds: 17,
  }

  it('emits the draft-11 structured fields and the deployed triad by default', () => {
    expect(buildRateLimitHeaders('both', 'marine', 60, allowed)).toEqual({
      RateLimit: '"marine";r=119;t=60',
      'RateLimit-Policy': '"marine";q=120;w=60',
      'RateLimit-Limit': '120',
      'RateLimit-Remaining': '119',
      'RateLimit-Reset': '60',
    })
  })

  it('emits only the draft-11 fields in standard mode', () => {
    expect(Object.keys(buildRateLimitHeaders('standard', 'marine', 60, allowed)).sort()).toEqual([
      'RateLimit',
      'RateLimit-Policy',
    ])
  })

  it('emits only the triad in legacy mode', () => {
    expect(Object.keys(buildRateLimitHeaders('legacy', 'marine', 60, allowed)).sort()).toEqual([
      'RateLimit-Limit',
      'RateLimit-Remaining',
      'RateLimit-Reset',
    ])
  })

  it('adds Retry-After only on a denial', () => {
    expect(buildRateLimitHeaders('both', 'marine', 60, allowed)['Retry-After']).toBeUndefined()
    expect(buildRateLimitHeaders('both', 'marine', 60, denied)['Retry-After']).toBe('17')
  })

  it('still answers Retry-After in none mode, and nothing else', () => {
    expect(buildRateLimitHeaders('none', 'marine', 60, denied)).toEqual({ 'Retry-After': '17' })
    expect(buildRateLimitHeaders('none', 'marine', 60, allowed)).toEqual({})
  })

  it('cannot be used to inject a header through the policy key', () => {
    const headers = buildRateLimitHeaders('standard', 'a\r\nX-Injected: 1', 60, allowed)
    expect(headers['RateLimit-Policy']).toBe('"a-X-Injected-1";q=120;w=60')
  })
})
