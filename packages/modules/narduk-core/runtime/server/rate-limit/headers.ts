/**
 * `RateLimit-*` response header construction.
 *
 * ## Which header names are correct
 *
 * The IETF work is at **draft-ietf-httpapi-ratelimit-headers-11** (May 2026),
 * and that draft does *not* define the familiar
 * `RateLimit-Limit`/`RateLimit-Remaining`/`RateLimit-Reset` triad. It defines
 * two Structured Field Lists instead: `RateLimit-Policy`, carrying the quota
 * policy (`q` allocated quota, `qu` quota units, `w` window seconds, `pk`
 * partition key), and `RateLimit`, carrying the currently available quota
 * (`r` remaining, `t` seconds until the window resets, `pk`).
 *
 * The triad is what earlier revisions specified and what public APIs actually
 * ship, so dropping it would break every client written against the deployed
 * convention. Both families are therefore emitted by default and the choice is
 * configurable — `'standard'` for the current draft only, `'legacy'` for the
 * triad only, `'both'`, or `'none'`.
 *
 * @see https://datatracker.ietf.org/doc/html/draft-ietf-httpapi-ratelimit-headers-11
 */

import type { RateLimitHeaderMode } from './policy'
import type { RateLimitVerdict } from './window'

/**
 * Route keys reach the wire inside a Structured Field string, so anything
 * outside this set is replaced rather than escaped. That also closes header
 * injection: a key containing CR or LF cannot split the response.
 */
function sanitizePolicyName(key: string): string {
  const cleaned = key.replaceAll(/[^\w.-]+/g, '-').replaceAll(/^-+|-+$/g, '')
  return cleaned.length > 0 ? cleaned : 'route'
}

export interface RateLimitHeaderSet {
  [name: string]: string
}

/**
 * The headers describing `verdict`, for a policy named `key` over
 * `windowSeconds`.
 *
 * `Retry-After` is included only on a denial, where RFC 9110 gives it meaning;
 * emitting it on a successful response would tell a well-behaved client to back
 * off when it has quota left.
 */
export function buildRateLimitHeaders(
  mode: RateLimitHeaderMode,
  key: string,
  windowSeconds: number,
  verdict: RateLimitVerdict,
): RateLimitHeaderSet {
  const headers: RateLimitHeaderSet = {}

  if (!verdict.allowed && verdict.retryAfterSeconds !== undefined) {
    headers['Retry-After'] = String(verdict.retryAfterSeconds)
  }

  if (mode === 'none') return headers

  const name = sanitizePolicyName(key)

  if (mode === 'standard' || mode === 'both') {
    headers['RateLimit-Policy'] = `"${name}";q=${verdict.limit};w=${windowSeconds}`
    headers['RateLimit'] = `"${name}";r=${verdict.remaining};t=${verdict.resetSeconds}`
  }

  if (mode === 'legacy' || mode === 'both') {
    headers['RateLimit-Limit'] = String(verdict.limit)
    headers['RateLimit-Remaining'] = String(verdict.remaining)
    headers['RateLimit-Reset'] = String(verdict.resetSeconds)
  }

  return headers
}
