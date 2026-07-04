import {
  base64urlEncode,
  derEcdsaSignatureToRaw,
  importPrivateKeyForAppleMaps,
} from './crypto.js'

export interface MapKitJwtOptions {
  expiresInSeconds?: number
  issuedAtSeconds?: number
  keyId: string
  origin: string
  privateKey: CryptoKey | string
  teamId: string
}

export interface AppleMapsAuthTokenOptions {
  appId: string
  expiresInSeconds?: number
  issuedAtSeconds?: number
  keyId: string
  privateKey: CryptoKey | string
  teamId: string
}

export interface DecodedJwt {
  header: Record<string, unknown>
  payload: Record<string, unknown>
}

export const DEFAULT_MAPKIT_TOKEN_TTL_SECONDS = 60 * 60 * 24
export const DEFAULT_APPLE_MAPS_AUTH_TTL_SECONDS = 60 * 30

function normalizePem(privateKey: string): string {
  return privateKey.includes('\\n') ? privateKey.replaceAll('\\n', '\n') : privateKey
}

async function resolvePrivateKey(privateKey: CryptoKey | string): Promise<CryptoKey> {
  if (typeof privateKey !== 'string') return privateKey
  return importPrivateKeyForAppleMaps(normalizePem(privateKey))
}

function encodeJwtPart(value: Record<string, unknown>): string {
  return base64urlEncode(JSON.stringify(value))
}

async function signJwt(
  privateKeyInput: CryptoKey | string,
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
): Promise<string> {
  const privateKey = await resolvePrivateKey(privateKeyInput)
  const signingInput = `${encodeJwtPart(header)}.${encodeJwtPart(payload)}`
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    new TextEncoder().encode(signingInput),
  )
  const rawSignature = derEcdsaSignatureToRaw(new Uint8Array(signature))
  return `${signingInput}.${base64urlEncode(rawSignature.buffer as ArrayBuffer)}`
}

function requireTrimmed(value: string, name: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error(`${name} is required`)
  return trimmed
}

export async function createMapKitToken(options: MapKitJwtOptions): Promise<string> {
  const teamId = requireTrimmed(options.teamId, 'teamId')
  const keyId = requireTrimmed(options.keyId, 'keyId')
  const origin = requireTrimmed(options.origin, 'origin')
  const issuedAt = options.issuedAtSeconds ?? Math.floor(Date.now() / 1000)
  const expiresInSeconds = options.expiresInSeconds ?? DEFAULT_MAPKIT_TOKEN_TTL_SECONDS

  if (!Number.isFinite(expiresInSeconds) || expiresInSeconds <= 0) {
    throw new RangeError('expiresInSeconds must be a finite positive number')
  }

  return signJwt(
    options.privateKey,
    { alg: 'ES256', kid: keyId, typ: 'JWT' },
    {
      iss: teamId,
      iat: issuedAt,
      exp: issuedAt + expiresInSeconds,
      origin,
    },
  )
}

export async function createAppleMapsAuthToken(
  options: AppleMapsAuthTokenOptions,
): Promise<string> {
  const teamId = requireTrimmed(options.teamId, 'teamId')
  const keyId = requireTrimmed(options.keyId, 'keyId')
  const appId = requireTrimmed(options.appId, 'appId')
  const issuedAt = options.issuedAtSeconds ?? Math.floor(Date.now() / 1000)
  const expiresInSeconds = options.expiresInSeconds ?? DEFAULT_APPLE_MAPS_AUTH_TTL_SECONDS

  if (!Number.isFinite(expiresInSeconds) || expiresInSeconds <= 0) {
    throw new RangeError('expiresInSeconds must be a finite positive number')
  }

  return signJwt(
    options.privateKey,
    { alg: 'ES256', kid: keyId, typ: 'JWT' },
    {
      iss: teamId,
      iat: issuedAt,
      exp: issuedAt + expiresInSeconds,
      appid: appId,
    },
  )
}

export function decodeJwt(token: string): DecodedJwt {
  const [encodedHeader, encodedPayload] = token.split('.')
  if (!encodedHeader || !encodedPayload) {
    throw new Error('JWT must contain header and payload segments')
  }

  return {
    header: decodeBase64UrlJson(encodedHeader),
    payload: decodeBase64UrlJson(encodedPayload),
  }
}

export function decodeBase64UrlJson(segment: string): Record<string, unknown> {
  const padded = segment.replaceAll('-', '+').replaceAll('_', '/')
  const padding = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4))
  return JSON.parse(atob(padded + padding)) as Record<string, unknown>
}

export function isJwtExpired(token: string, nowMs = Date.now(), refreshWindowMs = 0): boolean {
  try {
    const { payload } = decodeJwt(token)
    const exp = payload.exp
    if (typeof exp !== 'number' || !Number.isFinite(exp)) return true
    return exp * 1000 <= nowMs + refreshWindowMs
  } catch {
    return true
  }
}

export const isMapKitTokenExpired = isJwtExpired
