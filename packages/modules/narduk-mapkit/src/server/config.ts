import { isJwtExpired } from '../token/jwt.js'

export interface MapKitServerConfig {
  allowedOrigins?: readonly string[] | string
  doppler?: false | MapKitDopplerConfig
  fallbackOrigin?: string
  keyId?: string
  privateKey?: string
  staticToken?: string
  teamId?: string
  tokenExpiresInSeconds?: number
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

const DEFAULT_DOPPLER_PROJECT = 'narduk'
const DEFAULT_DOPPLER_CONFIG = 'tokens'
const DEFAULT_DOPPLER_TIMEOUT_MS = 10_000

function readProcessEnv(): MapKitEnv {
  if (typeof process === 'undefined') return {}
  return process.env
}

export function mapKitConfigFromEnv(env: MapKitEnv = readProcessEnv()): MapKitServerConfig {
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

export async function resolveMapKitServerConfig(
  config: MapKitServerConfig = {},
  env?: MapKitEnv,
): Promise<MapKitServerConfig> {
  const resolvedConfig = mergeMapKitConfig(mapKitConfigFromEnv(env), config)
  if (hasSigningConfig(resolvedConfig) || hasUsableStaticToken(resolvedConfig)) {
    return resolvedConfig
  }
  if (config.doppler === false || config.doppler?.enabled === false) {
    return resolvedConfig
  }

  const dopplerConfig = await mapKitConfigFromDoppler(config.doppler ?? {})
  return mergeMapKitConfig(dopplerConfig, resolvedConfig)
}

export async function mapKitConfigFromDoppler(
  options: MapKitDopplerConfig = {},
): Promise<MapKitServerConfig> {
  const entries = await readDopplerSecrets(
    [
      'APPLE_TEAM_ID',
      'APPLE_KEY_ID',
      'APPLE_PRIVATE_KEY',
      'APPLE_SECRET_KEY',
      'APPLE_MAPKIT_TOKEN',
      'MAPKIT_TOKEN',
      'MAPKIT_ALLOWED_ORIGINS',
    ],
    options,
  )

  const config: MapKitServerConfig = {}
  if (entries.APPLE_TEAM_ID) config.teamId = entries.APPLE_TEAM_ID
  if (entries.APPLE_KEY_ID) config.keyId = entries.APPLE_KEY_ID
  const privateKey = entries.APPLE_PRIVATE_KEY || entries.APPLE_SECRET_KEY
  if (privateKey) config.privateKey = privateKey
  const staticToken = entries.APPLE_MAPKIT_TOKEN || entries.MAPKIT_TOKEN
  if (staticToken) config.staticToken = staticToken
  if (entries.MAPKIT_ALLOWED_ORIGINS) config.allowedOrigins = entries.MAPKIT_ALLOWED_ORIGINS
  return config
}

function mergeMapKitConfig(
  fallback: MapKitServerConfig,
  preferred: MapKitServerConfig,
): MapKitServerConfig {
  return {
    ...fallback,
    ...preferred,
  }
}

async function readDopplerSecrets(
  keys: readonly string[],
  options: MapKitDopplerConfig,
): Promise<Record<string, string | undefined>> {
  const results = await Promise.all(
    keys.map(async (key) => [key, await readDopplerSecret(key, options)] as const),
  )
  return Object.fromEntries(results)
}

async function readDopplerSecret(
  key: string,
  options: MapKitDopplerConfig,
): Promise<string | undefined> {
  try {
    const [{ execFile }, { promisify }] = await Promise.all([
      import('node:child_process'),
      import('node:util'),
    ])
    const execFileAsync = promisify(execFile)
    const { stdout } = await execFileAsync(
      options.command ?? 'doppler',
      [
        'secrets',
        'get',
        key,
        '--plain',
        '--no-check-version',
        '--no-exit-on-missing-secret',
        '--project',
        options.project ?? DEFAULT_DOPPLER_PROJECT,
        '--config',
        options.config ?? DEFAULT_DOPPLER_CONFIG,
      ],
      {
        timeout: options.timeoutMs ?? DEFAULT_DOPPLER_TIMEOUT_MS,
      },
    )
    const value = stdout.trim()
    return value.length > 0 ? value : undefined
  } catch {
    return undefined
  }
}

export function parseAllowedOrigins(input: readonly string[] | string | undefined): string[] {
  if (Array.isArray(input)) {
    return input.map((origin) => origin.trim()).filter(Boolean)
  }
  if (typeof input !== 'string') return []
  if (!input?.trim()) return []
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
