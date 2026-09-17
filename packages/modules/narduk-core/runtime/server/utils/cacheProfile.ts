import { getResponseHeader, getResponseStatus, setResponseHeader } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'

import { isPreferencesInfluenced } from '../../shared/utils/preferences'
import { resolveRuntimePublicOverlay } from './runtime-public'

import type { H3Event } from 'h3'

/**
 * Typed edge-cache profiles for Narduk Cloudflare apps.
 *
 * Apps used to hand-write `Cache-Control` strings per route. Three of those
 * strings in one app were provably wrong in the same way, so the strings move
 * here and the numbers become runtime configuration.
 *
 * WHY THIS DOES NOT EMIT `s-maxage`
 * ---------------------------------
 * The obvious encoding of "60s in the browser, 300s at the edge, serve stale
 * for 900s" is `public, max-age=60, s-maxage=300, stale-while-revalidate=900`.
 * It does not work. Cloudflare, following RFC 9111 §4.2.4, documents that
 * `s-maxage`, `must-revalidate` and `proxy-revalidate` each *disable*
 * `stale-while-revalidate` and `stale-if-error`, and instructs:
 *
 *   "When you want `stale-while-revalidate` to take effect at the edge, use
 *    `max-age` for the freshness window — not `s-maxage`. If you need a longer
 *    edge TTL than browsers should honor while still using
 *    `stale-while-revalidate`, use `cdn-cache-control` for the edge directive."
 *
 * So a profile's `sMaxAge` is emitted as `CDN-Cache-Control: max-age=<n>`, not
 * as `Cache-Control: s-maxage=<n>`. The browser reads `Cache-Control`, the edge
 * reads the more specific `CDN-Cache-Control`, and the stale window survives in
 * both. `CDN-Cache-Control` is the standard header rather than the
 * Cloudflare-specific `Cloudflare-CDN-Cache-Control` because it is respected by
 * Cloudflare *and* passed to any downstream CDN, and because a response whose
 * edge TTL is visible is easier to debug than one Cloudflare strips.
 *
 * WHERE THE EDGE CACHE COMES FROM
 * -------------------------------
 * Workers run before the cache, so a response a Worker generates is not stored
 * by the zone cache at all. These headers bind only once the app opts into
 * Workers Cache with `"cache": { "enabled": true }` in its Wrangler config
 * (Wrangler >= 4.69.0). Until an app does that, the profiles still produce a
 * correct browser `Cache-Control` and the edge headers are inert — setting them
 * is harmless and makes the later opt-in a one-line change.
 *
 * @see https://developers.cloudflare.com/workers/cache/configuration/
 */

/** Seconds. Every profile field is a whole number of seconds. */
export interface CacheProfile {
  /** Browser freshness window, emitted as `Cache-Control: max-age`. */
  maxAge: number
  /** Emit nothing cacheable: `private, no-store`. */
  noStore?: boolean
  /** Emit `private` instead of `public`, and no edge header at all. */
  private?: boolean
  /**
   * Edge freshness window, emitted as `CDN-Cache-Control: max-age`. Ignored
   * when `private` is true — a private response must never be edge-cached.
   */
  sMaxAge: number
  /** Stale-serving window, emitted as `stale-while-revalidate` on both headers. */
  swr: number
}

export type CacheProfileOverride = Partial<CacheProfile>

/** A profile name, or an inline profile for a route that needs its own numbers. */
export type CacheProfileInput = CacheProfileName | CacheProfile

export type CacheProfileName = keyof typeof CACHE_PROFILES

export function defineCacheProfile(
  maxAge: number,
  sMaxAge: number,
  swr: number,
  extra: Omit<CacheProfileOverride, 'maxAge' | 'sMaxAge' | 'swr'> = {},
): CacheProfile {
  return { maxAge, sMaxAge, swr, ...extra }
}

const MINUTE = 60
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * The named profiles. An app tunes the numbers through
 * `runtimeConfig.cache.profiles` rather than by editing a route.
 *
 * - `live` — the live-ish surface of a published product: 1 minute in the
 *   browser, 5 at the edge, 15 minutes of stale-serving.
 * - `slow` — history, coverage and other slower-changing published data.
 * - `static` — generated documents that change on deploy rather than per
 *   request: sitemaps, robots, feeds.
 * - `none` — never cache anywhere. Also what every guard in
 *   {@link setCacheProfile} falls back to.
 */
export const CACHE_PROFILES = {
  live: defineCacheProfile(1 * MINUTE, 5 * MINUTE, 15 * MINUTE),
  slow: defineCacheProfile(5 * MINUTE, 15 * MINUTE, 30 * MINUTE),
  static: defineCacheProfile(5 * MINUTE, 1 * HOUR, 1 * DAY),
  none: defineCacheProfile(0, 0, 0, { noStore: true, private: true }),
} as const satisfies Record<string, CacheProfile>

/** Why a requested profile was downgraded to `none`. */
export type CacheSuppressionReason =
  'error-status' | 'preferences-cookie' | 'preview-safe-mode' | 'set-cookie' | 'vary-wildcard'

export interface SetCacheProfileOptions {
  /**
   * `Cache-Tag` values for purge-by-tag. Cloudflare strips the header before it
   * reaches the client. Invalid tags are dropped rather than throwing, matching
   * the platform, which also drops them silently at storage time.
   */
  tags?: readonly string[]
  /**
   * Request headers this response varies on. Merged with any `Vary` already on
   * the response. `*` makes the response uncacheable, so it downgrades the
   * profile to `none` instead of advertising a cache posture Cloudflare will
   * bypass.
   */
  vary?: readonly string[]
}

export interface CacheProfileResult {
  /** The `Cache-Control` value written to the response. */
  cacheControl: string
  /** The `Cache-Tag` value written, or undefined when no valid tag survived. */
  cacheTag?: string
  /** The `CDN-Cache-Control` value written, or undefined for a private/no-store response. */
  cdnCacheControl?: string
  /** The profile actually emitted, after overrides and guards. */
  profile: CacheProfile
  /** Set when a guard forced `none` over the requested profile. */
  suppressedBy?: CacheSuppressionReason
  /** The `Vary` value written, or undefined when the response varies on nothing. */
  vary?: string
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

/**
 * Apply `runtimeConfig.cache.profiles[<name>]` to a named profile. An inline
 * profile is used verbatim — it already is the app's own configuration.
 */
export function resolveCacheProfile(event: H3Event, input: CacheProfileInput): CacheProfile {
  if (typeof input !== 'string') return input

  const base = CACHE_PROFILES[input]
  const config = useRuntimeConfig(event) as {
    cache?: { profiles?: Record<string, CacheProfileOverride | undefined> }
  }
  const override = config.cache?.profiles?.[input]
  if (!override) return { ...base }

  return {
    maxAge: isNonNegativeInteger(override.maxAge) ? override.maxAge : base.maxAge,
    sMaxAge: isNonNegativeInteger(override.sMaxAge) ? override.sMaxAge : base.sMaxAge,
    swr: isNonNegativeInteger(override.swr) ? override.swr : base.swr,
    private: typeof override.private === 'boolean' ? override.private : base.private,
    noStore: typeof override.noStore === 'boolean' ? override.noStore : base.noStore,
  }
}

/**
 * Cloudflare's `Cache-Tag` contract: printable ASCII, no spaces, no commas
 * (the separator), at most 1024 characters each and 1000 tags per response.
 * Purge matching is case-insensitive, so tags are deduplicated that way too.
 */
const MAX_CACHE_TAG_LENGTH = 1024
const MAX_CACHE_TAGS = 1000
const VALID_CACHE_TAG = /^[\x21-\x2b\x2d-\x7e]+$/

export function normalizeCacheTags(tags: readonly string[] | undefined): string[] {
  if (!tags?.length) return []

  const seen = new Set<string>()
  const kept: string[] = []
  for (const tag of tags) {
    if (typeof tag !== 'string') continue
    if (tag.length === 0 || tag.length > MAX_CACHE_TAG_LENGTH) continue
    if (!VALID_CACHE_TAG.test(tag)) continue

    const fingerprint = tag.toLowerCase()
    if (seen.has(fingerprint)) continue
    seen.add(fingerprint)
    kept.push(tag)
    if (kept.length === MAX_CACHE_TAGS) break
  }
  return kept
}

function readResponseHeader(event: H3Event, name: string): string[] {
  const raw = getResponseHeader(event, name)
  if (raw === undefined || raw === null) return []
  return (Array.isArray(raw) ? raw : [String(raw)]).filter((value) => value.length > 0)
}

/**
 * Merge the requested `Vary` header names with whatever is already on the
 * response, case-insensitively and order-preserving. Returns `'*'` unchanged
 * when either side asks for it.
 */
export function normalizeVary(
  existing: readonly string[],
  requested: readonly string[] | undefined,
): string | undefined {
  const names = [...existing, ...(requested ?? [])]
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter(Boolean)

  if (names.includes('*')) return '*'

  const seen = new Set<string>()
  const kept: string[] = []
  for (const name of names) {
    const fingerprint = name.toLowerCase()
    if (seen.has(fingerprint)) continue
    seen.add(fingerprint)
    kept.push(name)
  }
  return kept.length > 0 ? kept.join(', ') : undefined
}

function formatCacheControl(profile: CacheProfile): string {
  if (profile.noStore) return 'private, no-store'

  const directives = [profile.private ? 'private' : 'public', `max-age=${profile.maxAge}`]
  if (profile.swr > 0) directives.push(`stale-while-revalidate=${profile.swr}`)
  return directives.join(', ')
}

function formatCdnCacheControl(profile: CacheProfile): string | undefined {
  if (profile.noStore || profile.private) return undefined

  const directives = ['public', `max-age=${profile.sMaxAge}`]
  if (profile.swr > 0) directives.push(`stale-while-revalidate=${profile.swr}`)
  return directives.join(', ')
}

/**
 * Resolve why this response must not be cached, if it must not be.
 *
 * A preview build, an error response, and a response already carrying a
 * `Set-Cookie` are all cases where a cacheable header is a defect rather than a
 * tuning choice, so none of them are overridable by configuration.
 *
 * `preferences-cookie` joins them (narduk-libs#386): a body whose units, time
 * zone or locale came from the reader's preference cookie belongs to that
 * reader. The flag is set only by `usePreferences()` and `readPreferences()`,
 * so a route that never touched preferences keeps exactly the profile it asked
 * for and no existing app's cache posture changes.
 */
function findSuppression(
  event: H3Event,
  vary: string | undefined,
): CacheSuppressionReason | undefined {
  if (getResponseStatus(event) >= 400) return 'error-status'
  if (readResponseHeader(event, 'Set-Cookie').length > 0) return 'set-cookie'
  if (vary === '*') return 'vary-wildcard'
  if (isPreferencesInfluenced(event)) return 'preferences-cookie'
  if (resolveRuntimePublicOverlay(event).previewSafeMode) return 'preview-safe-mode'
  return undefined
}

/**
 * Set this response's cache posture from a named profile or an inline one.
 *
 * ```ts
 * setCacheProfile(event, 'live', { tags: ['stations', 'published-data'] })
 * setCacheProfile(event, { maxAge: 30, sMaxAge: 120, swr: 600 })
 * ```
 *
 * Returns what was written so a caller or a test can assert on it rather than
 * re-reading headers.
 */
export function setCacheProfile(
  event: H3Event,
  input: CacheProfileInput,
  options: SetCacheProfileOptions = {},
): CacheProfileResult {
  // A preference-influenced response varies by cookie whatever the caller
  // asked for, so `Cookie` is merged in before the guards read `Vary`.
  const requestedVary = isPreferencesInfluenced(event)
    ? [...(options.vary ?? []), 'Cookie']
    : options.vary
  const vary = normalizeVary(readResponseHeader(event, 'Vary'), requestedVary)
  const suppressedBy = findSuppression(event, vary)
  const profile = suppressedBy ? { ...CACHE_PROFILES.none } : resolveCacheProfile(event, input)

  const cacheControl = formatCacheControl(profile)
  const cdnCacheControl = formatCdnCacheControl(profile)
  const tags = cdnCacheControl ? normalizeCacheTags(options.tags) : []
  const cacheTag = tags.length > 0 ? tags.join(',') : undefined

  setResponseHeader(event, 'Cache-Control', cacheControl)
  if (cdnCacheControl) setResponseHeader(event, 'CDN-Cache-Control', cdnCacheControl)
  if (cacheTag) setResponseHeader(event, 'Cache-Tag', cacheTag)
  if (vary) setResponseHeader(event, 'Vary', vary)

  return { cacheControl, cacheTag, cdnCacheControl, profile, suppressedBy, vary }
}
