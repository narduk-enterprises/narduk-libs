import { createMapKitToken, DEFAULT_MAPKIT_TOKEN_TTL_SECONDS } from '../token/jwt.js'
import {
  hasSigningConfig,
  hasUsableStaticToken,
  isOriginAllowed,
  mapKitConfigFromEnv,
  parseAllowedOrigins,
  resolveMapKitServerConfig,
} from './config.js'

import type { MapKitEnv, MapKitServerConfig } from './config.js'

export interface MapKitTokenRequestOptions {
  config?: MapKitServerConfig
  request: Request
}

export interface MapKitTokenResult {
  configured: boolean
  expiresAt?: string | null
  error?: string
  origin: string
  token: string
}

interface CachedMapKitToken {
  expiresAtMs: number
  token: string
}

const DEFAULT_CACHE_MAX_ENTRIES = 100
const DEFAULT_CACHE_REFRESH_WINDOW_MS = 60_000

const signedTokenCache = new Map<string, CachedMapKitToken>()

export function getOriginFromRequest(request: Request, fallbackOrigin = 'http://localhost:3000') {
  const origin = request.headers.get('origin')
  if (origin) return origin

  const referer = request.headers.get('referer')
  if (referer) {
    try {
      return new URL(referer).origin
    } catch {
      // Fall back below.
    }
  }

  try {
    return new URL(request.url).origin
  } catch {
    return fallbackOrigin
  }
}

export async function issueMapKitTokenForRequest(
  options: MapKitTokenRequestOptions,
): Promise<MapKitTokenResult> {
  const config = await resolveMapKitServerConfig(options.config)
  const origin = getOriginFromRequest(options.request, config.fallbackOrigin)
  const allowedOrigins = parseAllowedOrigins(config.allowedOrigins)

  if (!isOriginAllowed(origin, allowedOrigins)) {
    return {
      configured: true,
      error: 'Origin is not allowed for MapKit token issuance.',
      origin,
      token: '',
    }
  }

  if (hasSigningConfig(config)) {
    const expiresInSeconds = config.tokenExpiresInSeconds ?? DEFAULT_MAPKIT_TOKEN_TTL_SECONDS
    const cached = readCachedSignedToken(config, origin)
    if (cached) {
      return {
        configured: true,
        expiresAt: new Date(cached.expiresAtMs).toISOString(),
        origin,
        token: cached.token,
      }
    }

    const issuedAtSeconds = Math.floor(Date.now() / 1000)
    const tokenOptions = {
      expiresInSeconds,
      issuedAtSeconds,
      keyId: config.keyId!,
      origin,
      privateKey: config.privateKey!,
      teamId: config.teamId!,
    }
    const token = await createMapKitToken(tokenOptions)
    const expiresAtMs = (issuedAtSeconds + expiresInSeconds) * 1000
    writeCachedSignedToken(config, origin, token, expiresAtMs)
    return { configured: true, expiresAt: new Date(expiresAtMs).toISOString(), origin, token }
  }

  if (hasUsableStaticToken(config)) {
    return { configured: true, expiresAt: null, origin, token: config.staticToken!.trim() }
  }

  return {
    configured: false,
    error:
      'MapKit is not configured. Set APPLE_PRIVATE_KEY, APPLE_TEAM_ID, and APPLE_KEY_ID to sign origin-scoped tokens, or provide a non-expired MAPKIT_TOKEN / APPLE_MAPKIT_TOKEN.',
    origin,
    token: '',
  }
}

export async function mapKitTokenResponse(
  request: Request,
  config?: MapKitServerConfig,
): Promise<Response> {
  try {
    const result = await issueMapKitTokenForRequest(
      config ? { request, config } : { request },
    )
    const status = result.configured ? (result.token ? 200 : 403) : 503
    return jsonResponse(result, status)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to generate MapKit token'
    return jsonResponse({ configured: false, error: message, token: '' }, 500)
  }
}

/**
 * Cloudflare Worker / Fetch convenience. Reads Apple credentials from a passed
 * `env` object (Worker secret bindings, not `process.env`) and returns a token
 * `Response`. The Doppler fallback is disabled because Workers have no
 * `child_process`; token signing is pure Web Crypto and runs natively in workerd.
 *
 * ```ts
 * export default {
 *   async fetch(request: Request, env: Env): Promise<Response> {
 *     if (new URL(request.url).pathname === '/api/mapkit-token') {
 *       return mapKitTokenResponseFromEnv(request, env)
 *     }
 *     return new Response('Not found', { status: 404 })
 *   },
 * }
 * ```
 */
export function mapKitTokenResponseFromEnv(
  request: Request,
  env: MapKitEnv,
  overrides: Partial<MapKitServerConfig> = {},
): Promise<Response> {
  return mapKitTokenResponse(request, {
    ...mapKitConfigFromEnv(env),
    ...overrides,
    doppler: false,
  })
}

export function createMapKitTokenHandler(config?: MapKitServerConfig) {
  return (request: Request): Promise<Response> =>
    config ? mapKitTokenResponse(request, config) : mapKitTokenResponse(request)
}

export function clearMapKitTokenCacheForTests(): void {
  signedTokenCache.clear()
}

function cacheEnabled(config: MapKitServerConfig): boolean {
  return config.cache !== false
}

function cacheMaxEntries(config: MapKitServerConfig): number {
  const maxEntries = typeof config.cache === 'object' ? config.cache.maxEntries : undefined
  return typeof maxEntries === 'number' && Number.isFinite(maxEntries) && maxEntries > 0
    ? Math.floor(maxEntries)
    : DEFAULT_CACHE_MAX_ENTRIES
}

function cacheRefreshWindowMs(config: MapKitServerConfig): number {
  const refreshWindowMs = typeof config.cache === 'object' ? config.cache.refreshWindowMs : undefined
  return typeof refreshWindowMs === 'number' &&
    Number.isFinite(refreshWindowMs) &&
    refreshWindowMs >= 0
    ? refreshWindowMs
    : DEFAULT_CACHE_REFRESH_WINDOW_MS
}

function signedTokenCacheKey(config: MapKitServerConfig, origin: string): string {
  return [
    config.teamId?.trim() ?? '',
    config.keyId?.trim() ?? '',
    config.tokenExpiresInSeconds ?? DEFAULT_MAPKIT_TOKEN_TTL_SECONDS,
    origin.replace(/\/$/, ''),
  ].join('\0')
}

function readCachedSignedToken(
  config: MapKitServerConfig,
  origin: string,
): CachedMapKitToken | null {
  if (!cacheEnabled(config)) return null
  const key = signedTokenCacheKey(config, origin)
  const cached = signedTokenCache.get(key)
  if (!cached) return null
  if (cached.expiresAtMs <= Date.now() + cacheRefreshWindowMs(config)) {
    signedTokenCache.delete(key)
    return null
  }

  signedTokenCache.delete(key)
  signedTokenCache.set(key, cached)
  return cached
}

function writeCachedSignedToken(
  config: MapKitServerConfig,
  origin: string,
  token: string,
  expiresAtMs: number,
): void {
  if (!cacheEnabled(config)) return
  signedTokenCache.set(signedTokenCacheKey(config, origin), { expiresAtMs, token })
  const maxEntries = cacheMaxEntries(config)
  while (signedTokenCache.size > maxEntries) {
    const oldestKey = signedTokenCache.keys().next().value
    if (!oldestKey) break
    signedTokenCache.delete(oldestKey)
  }
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
    },
    status,
  })
}
