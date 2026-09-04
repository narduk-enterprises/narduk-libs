import { isJwtExpired } from '../token/jwt.js'

export interface MapKitServerConfig {
  allowedOrigins?: readonly string[] | string
  cache?: false | MapKitTokenCacheConfig
  /** Node-only fallback settings. Worker-safe entry points intentionally ignore this field. */
  doppler?: false | MapKitDopplerConfig
  fallbackOrigin?: string
  keyId?: string
  privateKey?: string
  staticToken?: string
  teamId?: string
  tokenExpiresInSeconds?: number
}

export interface MapKitTokenCacheConfig {
  maxEntries?: number
  refreshWindowMs?: number
}

export interface MapKitDopplerConfig {
  command?: string
  config?: string
  enabled?: boolean
  project?: string
  timeoutMs?: number
}

export interface MapKitEnv {
  APPLE_KEY_ID?: string
  APPLE_MAPKIT_TOKEN?: string
  APPLE_PRIVATE_KEY?: string
  APPLE_SECRET_KEY?: string
  APPLE_TEAM_ID?: string
  MAPKIT_ALLOWED_ORIGINS?: string
  MAPKIT_TOKEN?: string
}

/**
 * Converts an explicitly supplied environment binding object into runtime
 * configuration. This function never reads `process.env` and is safe in
 * Cloudflare Workers and other Web-standard runtimes.
 */
export function mapKitConfigFromEnv(env: MapKitEnv = {}): MapKitServerConfig {
  const config: MapKitServerConfig = {}
  if (env.MAPKIT_ALLOWED_ORIGINS) config.allowedOrigins = env.MAPKIT_ALLOWED_ORIGINS
  if (env.APPLE_KEY_ID) config.keyId = env.APPLE_KEY_ID
  const privateKey = env.APPLE_PRIVATE_KEY || env.APPLE_SECRET_KEY
  if (privateKey) config.privateKey = privateKey
  const staticToken = env.APPLE_MAPKIT_TOKEN || env.MAPKIT_TOKEN
  if (staticToken) config.staticToken = staticToken
  if (env.APPLE_TEAM_ID) config.teamId = env.APPLE_TEAM_ID
  return config
}

export function parseAllowedOrigins(input: readonly string[] | string | undefined): string[] {
  if (Array.isArray(input)) {
    return input.map((origin) => origin.trim()).filter(Boolean)
  }
  if (typeof input !== 'string') return []
  if (!input.trim()) return []
  return input
    .split(',')
    .map((origin: string) => origin.trim())
    .filter(Boolean)
}

export function isOriginAllowed(origin: string, allowedOrigins: readonly string[]): boolean {
  if (allowedOrigins.length === 0) return true
  const normalizedOrigin = origin.replace(/\/$/, '')
  return allowedOrigins.some((allowed) => allowed.replace(/\/$/, '') === normalizedOrigin)
}

export function hasSigningConfig(config: MapKitServerConfig): boolean {
  return Boolean(config.privateKey?.trim() && config.teamId?.trim() && config.keyId?.trim())
}

export function hasUsableStaticToken(config: MapKitServerConfig): boolean {
  const token = config.staticToken?.trim()
  return Boolean(token?.startsWith('eyJ') && !isJwtExpired(token))
}
