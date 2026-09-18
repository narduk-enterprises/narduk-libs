/**
 * The token route's default ceiling (§e.4).
 *
 * The 2.0.x `rateLimit` seam had zero consumers because it required the app to
 * build the limiter itself, which left a JWT-signing route unlimited by default.
 * An app that mounts narduk-core's limiter still wins; this only means the
 * unconfigured case is not the unlimited case.
 */
import { describe, expect, it } from 'vitest'

import { createMapKitFixedWindowRateLimit } from '../../src/nuxt/runtime/server/rate-limit.js'

import type { MapKitRateLimitDecision } from '../../src/server/handler.js'

/** The hook's return is widened for other implementations; this one is sync. */
function decide(
  limit: ReturnType<typeof createMapKitFixedWindowRateLimit>,
  self?: string,
): MapKitRateLimitDecision {
  return limit(context(self)) as MapKitRateLimitDecision
}

function context(self = 'https://example.test') {
  return { origin: self, self } as unknown as Parameters<
    ReturnType<typeof createMapKitFixedWindowRateLimit>
  >[0]
}

describe('createMapKitFixedWindowRateLimit', () => {
  it('allows up to the limit and then refuses with a retry-after', () => {
    let now = 0
    const limit = createMapKitFixedWindowRateLimit({ limit: 3, now: () => now, windowSeconds: 60 })

    expect([1, 2, 3].map(() => decide(limit))).toStrictEqual([
      { allowed: true },
      { allowed: true },
      { allowed: true },
    ])
    expect(decide(limit)).toStrictEqual({ allowed: false, retryAfterSeconds: 60 })
  })

  it('counts down the retry-after as the window drains', () => {
    let now = 0
    const limit = createMapKitFixedWindowRateLimit({ limit: 1, now: () => now, windowSeconds: 60 })
    void limit(context())

    now = 45_000
    expect(decide(limit)).toStrictEqual({ allowed: false, retryAfterSeconds: 15 })
  })

  it('opens a fresh window once the old one expires', () => {
    let now = 0
    const limit = createMapKitFixedWindowRateLimit({ limit: 1, now: () => now, windowSeconds: 60 })
    void limit(context())
    expect(decide(limit).allowed).toBe(false)

    now = 60_000
    expect(decide(limit)).toStrictEqual({ allowed: true })
  })

  it('keys on the request origin, so one host cannot spend another host budget', () => {
    let now = 0
    const limit = createMapKitFixedWindowRateLimit({ limit: 1, now: () => now, windowSeconds: 60 })
    void limit(context('https://a.test'))

    expect(decide(limit, 'https://a.test').allowed).toBe(false)
    expect(decide(limit, 'https://b.test').allowed).toBe(true)
  })
})
