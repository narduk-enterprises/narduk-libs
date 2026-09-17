/**
 * The same-host, fail-closed MapKit token route (narduk-libs#421 §e).
 *
 * Everything here is `Request`-level on purpose: the routed request URL is the
 * ONLY source of the origin claim, so the contract can be stated -- and tested
 * -- without a framework. An h3/Nitro caller passes
 * `getRequestURL(event, { xForwardedHost: false }).origin` as `self`; a Worker
 * caller passes nothing, because `request.url` there is already the routed URL
 * and cannot be forged.
 *
 * What is deliberately NOT trusted: `Origin`, `Referer`, and every
 * `X-Forwarded-*` header. They are evidence about the caller, never the source
 * of the claim Apple will enforce.
 */
import { createMapKitToken } from '../token/jwt.js'
import { hasSigningConfig, mapKitConfigFromEnv } from './shared-config.js'

import type { MapKitEnv, MapKitServerConfig } from './shared-config.js'

/** Apple issues a 1800 s accessKey at bootstrap; minting longer than that buys nothing. */
export const MAPKIT_TOKEN_TTL_MAX_SECONDS = 1800
export const MAPKIT_TOKEN_TTL_MIN_SECONDS = 60

/** §e.4: capped at 32 entries, keyed on `self` -- not on anything a caller supplies. */
const CACHE_MAX_ENTRIES = 32
/** §e.4: a cached token is reused until five minutes before it expires. */
const CACHE_REFRESH_WINDOW_MS = 5 * 60 * 1000

const RATE_LIMIT_DEFAULT_RETRY_AFTER_SECONDS = 60

/** Config keys 2.1.0 ignores. Logged by NAME when present; never by value. */
const DEPRECATED_CONFIG_KEYS = ['allowedOrigins', 'staticToken'] as const

export type MapKitTokenRefusal =
  'method-not-allowed' | 'not-same-origin' | 'rate-limited' | 'unconfigured'

export interface MapKitRateLimitContext {
  /** Kept for 2.0.x callers; always equal to `self`. */
  origin: string
  request: Request
  /** The routed request origin -- scheme + host + port. */
  self: string
}

export interface MapKitRateLimitDecision {
  allowed: boolean
  error?: string
  retryAfterSeconds?: number
}

export type MapKitRateLimitHook = (
  context: MapKitRateLimitContext,
) => boolean | MapKitRateLimitDecision | Promise<boolean | MapKitRateLimitDecision>

/** Never carries a token, a JWT fragment, or any credential-bearing header value. */
export interface MapKitTokenRouteLogEntry {
  /** Config keys that are present but ignored in 2.1.0, by NAME. */
  deprecatedKeys: readonly string[]
  /** Absent on success. */
  refusal?: MapKitTokenRefusal
  /** The routed request origin the claim was (or would have been) built from. */
  self: string
  status: number
}

export interface MapKitTokenResponseOptions {
  /** Structured, value-free route logging (§e.4). */
  log?: (entry: MapKitTokenRouteLogEntry) => void
  rateLimit?: MapKitRateLimitHook
  /**
   * The routed request origin. h3 callers pass
   * `getRequestURL(event, { xForwardedHost: false }).origin`. Omitted, it is
   * read from `request.url`, which is correct on Workers and in tests.
   */
  self?: string
}

export interface MapKitTokenRequestOptions extends MapKitTokenResponseOptions {
  config?: MapKitServerConfig
  request: Request
}

export interface MapKitTokenResult {
  /** Epoch milliseconds the minted token stops being mintable with. */
  expiresAt?: number
  refusal?: MapKitTokenRefusal
  retryAfterSeconds?: number
  /** The routed request origin; the `origin` claim is built from exactly this. */
  self: string
  status: number
  token: string
}

interface CachedMapKitToken {
  expiresAtMs: number
  token: string
}

const signedTokenCache = new Map<string, CachedMapKitToken>()

/**
 * The routed request origin -- §e.1's `self`.
 *
 * Built from `URL.origin` so a default port is omitted (`https://example.com`,
 * never `https://example.com:443`): Apple enforces the claim on scheme + host +
 * port exactly, and a spurious `:443` fails every request.
 */
export function mapKitSelfOrigin(request: Request, self?: string): string {
  if (self) return new URL(self).origin
  return new URL(request.url).origin
}

/**
 * 2.0.x name, kept so no export disappears. It now answers the routed origin,
 * NOT the `Origin` header -- which is the whole point of §e.1.
 */
export function getOriginFromRequest(request: Request, _fallbackOrigin?: string): string {
  return mapKitSelfOrigin(request)
}

function originOf(value: string | null): string | null {
  if (!value) return null
  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

/**
 * §e.1: same-origin evidence, required.
 *
 * A MISSING `Origin` is legitimate -- measured in real Chromium, a same-origin
 * `fetch()` sends no `Origin` at all and `Sec-Fetch-Site: same-origin`. The
 * signal lives in `Sec-Fetch-Site`; `Origin`, when present, may only confirm.
 */
export function isMapKitRequestSameOrigin(request: Request, self: string): boolean {
  const origin = request.headers.get('origin')
  // In EVERY case, a present Origin that disagrees with the routed origin refuses.
  if (origin !== null && origin !== '' && origin !== 'null' && originOf(origin) !== self) {
    return false
  }

  const secFetchSite = request.headers.get('sec-fetch-site')
  if (secFetchSite !== null && secFetchSite !== '') return secFetchSite === 'same-origin'

  if (origin !== null && origin !== '' && origin !== 'null') return originOf(origin) === self

  const referer = originOf(request.headers.get('referer'))
  if (referer !== null) return referer === self

  return false
}

function clampTtlSeconds(value: number | undefined): number {
  const requested = value ?? MAPKIT_TOKEN_TTL_MAX_SECONDS
  if (!Number.isFinite(requested)) return MAPKIT_TOKEN_TTL_MAX_SECONDS
  return Math.min(
    MAPKIT_TOKEN_TTL_MAX_SECONDS,
    Math.max(MAPKIT_TOKEN_TTL_MIN_SECONDS, Math.floor(requested)),
  )
}

function deprecatedKeysPresent(config: MapKitServerConfig): string[] {
  return DEPRECATED_CONFIG_KEYS.filter((key) => {
    const value = config[key]
    return Array.isArray(value) ? value.length > 0 : Boolean(value)
  })
}

function normalizeRateLimitDecision(
  decision: boolean | MapKitRateLimitDecision,
): MapKitRateLimitDecision {
  return typeof decision === 'boolean' ? { allowed: decision } : decision
}

/**
 * Decide one token request. Order is deliberate: method, then same-origin, then
 * the rate limiter, then signing config. A cross-origin caller is refused
 * WITHOUT consuming a legitimate caller's allowance.
 */
export async function issueMapKitTokenForRequest(
  options: MapKitTokenRequestOptions,
): Promise<MapKitTokenResult> {
  const config = options.config ?? {}
  const self = mapKitSelfOrigin(options.request, options.self)

  if (options.request.method !== 'GET') {
    return { refusal: 'method-not-allowed', self, status: 405, token: '' }
  }

  if (!isMapKitRequestSameOrigin(options.request, self)) {
    return { refusal: 'not-same-origin', self, status: 403, token: '' }
  }

  if (options.rateLimit) {
    const decision = normalizeRateLimitDecision(
      await options.rateLimit({ origin: self, request: options.request, self }),
    )
    if (!decision.allowed) {
      return {
        refusal: 'rate-limited',
        retryAfterSeconds: decision.retryAfterSeconds ?? RATE_LIMIT_DEFAULT_RETRY_AFTER_SECONDS,
        self,
        status: 429,
        token: '',
      }
    }
  }

  if (!hasSigningConfig(config)) {
    return { refusal: 'unconfigured', self, status: 503, token: '' }
  }

  const expiresInSeconds = clampTtlSeconds(config.tokenExpiresInSeconds)
  const cacheKey = cacheEnabled(config)
    ? await signedTokenCacheKey(config, self, expiresInSeconds)
    : null
  const cached = cacheKey ? readCachedSignedToken(cacheKey) : null
  if (cached) {
    return { expiresAt: cached.expiresAtMs, self, status: 200, token: cached.token }
  }

  const issuedAtSeconds = Math.floor(Date.now() / 1000)
  const token = await createMapKitToken({
    expiresInSeconds,
    issuedAtSeconds,
    keyId: config.keyId!,
    // The claim is the routed origin and nothing else (§e.3).
    origin: self,
    privateKey: config.privateKey!,
    teamId: config.teamId!,
  })
  const expiresAtMs = (issuedAtSeconds + expiresInSeconds) * 1000
  if (cacheKey) writeCachedSignedToken(cacheKey, token, expiresAtMs)
  return { expiresAt: expiresAtMs, self, status: 200, token }
}

const REFUSAL_MESSAGES: Record<MapKitTokenRefusal, string> = {
  'method-not-allowed': 'This route answers GET only.',
  'not-same-origin':
    'This MapKit token route only answers same-origin requests from the page it serves. ' +
    'Opening it directly in a browser tab is a cross-site navigation and is refused by design.',
  'rate-limited': 'Too many MapKit token requests from this client. Try again shortly.',
  unconfigured:
    'MapKit token signing is not configured on this deployment. ' +
    'APPLE_TEAM_ID, APPLE_KEY_ID and APPLE_PRIVATE_KEY must all be present.',
}

/**
 * The §e route handler.
 *
 * The rate-limit hook is consulted by THIS function, so it cannot be bypassed by
 * the shape of the path that reached it -- a trailing slash, a different case, a
 * duplicated separator (buoys PR 122 review, F1). A path-matching middleware can
 * be walked around; a wrapped handler cannot.
 */
export async function mapKitTokenResponse(
  request: Request,
  config?: MapKitServerConfig,
  options: MapKitTokenResponseOptions = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    // Never an Access-Control-Allow-Origin, on any response (§e.1.4).
    vary: 'origin, sec-fetch-site',
  }

  try {
    const result = await issueMapKitTokenForRequest({
      ...options,
      ...(config ? { config } : {}),
      request,
    })

    options.log?.({
      deprecatedKeys: deprecatedKeysPresent(config ?? {}),
      ...(result.refusal === undefined ? {} : { refusal: result.refusal }),
      self: result.self,
      status: result.status,
    })

    if (result.refusal === 'method-not-allowed') headers['allow'] = 'GET'
    if (result.retryAfterSeconds !== undefined) {
      headers['retry-after'] = String(result.retryAfterSeconds)
    }

    const body = result.refusal
      ? { error: result.refusal, message: REFUSAL_MESSAGES[result.refusal] }
      : { expiresAt: result.expiresAt, token: result.token }

    return new Response(JSON.stringify(body), { headers, status: result.status })
  } catch (error) {
    // A signing failure is a server fault, never a token; nothing about the key
    // reaches the body.
    const self = mapKitSelfOrigin(request, options.self)
    options.log?.({
      deprecatedKeys: deprecatedKeysPresent(config ?? {}),
      refusal: 'unconfigured',
      self,
      status: 500,
    })
    return new Response(
      JSON.stringify({
        error: 'signing-failed',
        message: error instanceof Error ? error.message : 'Failed to generate a MapKit token.',
      }),
      { headers, status: 500 },
    )
  }
}

/**
 * Cloudflare Worker / Fetch convenience: reads Apple credentials from a passed
 * `env` binding object rather than `process.env`, and signs with Web Crypto.
 */
export function mapKitTokenResponseFromEnv(
  request: Request,
  env: MapKitEnv,
  overrides: Partial<MapKitServerConfig> = {},
  options: MapKitTokenResponseOptions = {},
): Promise<Response> {
  return mapKitTokenResponse(
    request,
    { ...mapKitConfigFromEnv(env), ...overrides, doppler: false },
    options,
  )
}

export function createMapKitTokenHandler(
  config?: MapKitServerConfig,
  options: MapKitTokenResponseOptions = {},
) {
  return (request: Request): Promise<Response> => mapKitTokenResponse(request, config, options)
}

export function clearMapKitTokenCacheForTests(): void {
  signedTokenCache.clear()
}

function cacheEnabled(config: MapKitServerConfig): boolean {
  return config.cache !== false
}

/**
 * Keyed on the routed origin plus the signing material, never on anything the
 * caller supplies -- the 2.0.x key was caller-supplied, so the cache was
 * unbounded in an attacker's direction.
 */
async function signedTokenCacheKey(
  config: MapKitServerConfig,
  self: string,
  expiresInSeconds: number,
): Promise<string> {
  return [
    config.teamId?.trim() ?? '',
    config.keyId?.trim() ?? '',
    await signingMaterialFingerprint(config.privateKey ?? ''),
    expiresInSeconds,
    self,
  ].join('\0')
}

async function signingMaterialFingerprint(privateKey: string): Promise<string> {
  const normalizedPrivateKey = privateKey.trim().replaceAll('\\n', '\n')
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(normalizedPrivateKey),
  )
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function readCachedSignedToken(cacheKey: string): CachedMapKitToken | null {
  const cached = signedTokenCache.get(cacheKey)
  if (!cached) return null
  if (cached.expiresAtMs <= Date.now() + CACHE_REFRESH_WINDOW_MS) {
    signedTokenCache.delete(cacheKey)
    return null
  }

  // Re-insert so the Map's insertion order is LRU order.
  signedTokenCache.delete(cacheKey)
  signedTokenCache.set(cacheKey, cached)
  return cached
}

function writeCachedSignedToken(cacheKey: string, token: string, expiresAtMs: number): void {
  signedTokenCache.set(cacheKey, { expiresAtMs, token })
  while (signedTokenCache.size > CACHE_MAX_ENTRIES) {
    const oldestKey = signedTokenCache.keys().next().value
    if (oldestKey === undefined) break
    signedTokenCache.delete(oldestKey)
  }
}
