import { createError } from 'h3'

/**
 * Sign in with Apple identity-token verification for the local backend
 * (narduk-libs#164, decision D4: native, no hosted auth dependency).
 *
 * An Apple identity token is an RS256 JWT signed with a key from Apple's JWKS.
 * It is accepted only when the signature verifies against that key, `iss` is
 * Apple, `aud` is one of this app's client ids (the Services ID for the web
 * flow, a bundle id for a native app), it has not expired, and its `nonce`
 * claim is the SHA-256 (hex) of the raw nonce this server bound to the
 * request — so a token minted for another request, or another app, is refused.
 */

export const APPLE_ISSUER = 'https://appleid.apple.com'
export const APPLE_JWKS_URL = 'https://appleid.apple.com/auth/keys'
export const APPLE_AUTHORIZE_URL = 'https://appleid.apple.com/auth/authorize'

/** Keys are re-fetched after this, and at most this often for an unknown `kid`. */
const JWKS_TTL_MS = 60 * 60 * 1000
const JWKS_MIN_REFETCH_MS = 60 * 1000
/** Tolerated clock skew for `exp` / `iat`. */
const CLOCK_SKEW_SECONDS = 60

interface AppleJwk {
  alg?: string
  e: string
  kid: string
  kty: string
  n: string
  use?: string
}

export interface AppleIdentityClaims {
  /** Apple's stable user id for this team; stored as `users.apple_id`. */
  appleId: string
  email: string | null
  emailVerified: boolean
  isPrivateEmail: boolean
}

export type AppleJwksFetcher = () => Promise<{ keys: AppleJwk[] }>

export interface VerifyAppleIdentityTokenOptions {
  /** Accepted `aud` values: the Services ID (web) or bundle ids (native). */
  audiences: readonly string[]
  fetchJwks?: AppleJwksFetcher
  now?: Date
  /** The raw nonce bound to this request; the token must carry its SHA-256 hex. */
  rawNonce: string
}

let jwksCache: { fetchedAt: number; keys: AppleJwk[] } | null = null

/** Test seam: forget the cached Apple keys. */
export function resetAppleJwksCache(): void {
  jwksCache = null
}

async function defaultFetchJwks(): Promise<{ keys: AppleJwk[] }> {
  const response = await globalThis.fetch(APPLE_JWKS_URL, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`Apple JWKS answered ${response.status}`)
  return (await response.json()) as { keys: AppleJwk[] }
}

async function appleSigningKey(
  kid: string,
  fetchJwks: AppleJwksFetcher,
  now: number,
): Promise<AppleJwk | null> {
  const cached = jwksCache?.keys.find((key) => key.kid === kid)
  const fresh = jwksCache && now - jwksCache.fetchedAt < JWKS_TTL_MS
  if (cached && fresh) return cached
  // An unknown kid may be a rotation: refetch, but not on every forged token.
  if (jwksCache && !cached && now - jwksCache.fetchedAt < JWKS_MIN_REFETCH_MS) return null

  const { keys } = await fetchJwks()
  jwksCache = { fetchedAt: now, keys: Array.isArray(keys) ? keys : [] }
  return jwksCache.keys.find((key) => key.kid === kid) ?? null
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function decodeJsonSegment(segment: string): Record<string, unknown> {
  const parsed = JSON.parse(new TextDecoder().decode(base64UrlToBytes(segment))) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error('not an object')
  return parsed as Record<string, unknown>
}

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** SHA-256 hex of a raw nonce: the value sent to Apple and expected in the token. */
export async function hashAppleNonce(rawNonce: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawNonce)))
}

/** A random hex token for `state` and raw nonces. */
export function randomAppleToken(bytes = 32): string {
  const buffer = new Uint8Array(bytes)
  crypto.getRandomValues(buffer)
  return toHex(buffer.buffer)
}

function refuse(reason: string): never {
  throw createError({
    statusCode: 401,
    statusMessage: 'Apple sign-in could not be verified.',
    data: { code: 'apple_token_invalid', reason },
  })
}

function booleanClaim(value: unknown): boolean {
  return value === true || value === 'true'
}

function audienceMatches(aud: unknown, audiences: readonly string[]): boolean {
  const values = Array.isArray(aud) ? aud : [aud]
  return values.some((value) => typeof value === 'string' && audiences.includes(value))
}

async function verifySignature(
  jwk: AppleJwk,
  signingInput: string,
  signature: string,
): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  )
  return crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    base64UrlToBytes(signature),
    new TextEncoder().encode(signingInput),
  )
}

function assertTimeClaims(payload: Record<string, unknown>, nowSeconds: number): void {
  if (typeof payload.exp !== 'number' || payload.exp + CLOCK_SKEW_SECONDS < nowSeconds) {
    refuse('expired')
  }
  if (typeof payload.iat === 'number' && payload.iat - CLOCK_SKEW_SECONDS > nowSeconds) {
    refuse('issued_in_future')
  }
}

export async function verifyAppleIdentityToken(
  token: string,
  options: VerifyAppleIdentityTokenOptions,
): Promise<AppleIdentityClaims> {
  if (options.audiences.length === 0) refuse('no_audience_configured')
  if (!options.rawNonce) refuse('nonce_missing')

  const parts = token.trim().split('.')
  if (parts.length !== 3) refuse('malformed')
  const [headerSegment, payloadSegment, signature] = parts as [string, string, string]

  let header: Record<string, unknown>
  let payload: Record<string, unknown>
  try {
    header = decodeJsonSegment(headerSegment)
    payload = decodeJsonSegment(payloadSegment)
  } catch {
    refuse('malformed')
  }
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') refuse('unsupported_alg')

  const now = options.now ?? new Date()
  let jwk: AppleJwk | null
  try {
    jwk = await appleSigningKey(header.kid, options.fetchJwks ?? defaultFetchJwks, now.getTime())
  } catch {
    throw createError({
      statusCode: 503,
      statusMessage: 'Apple sign-in keys are unavailable. Try again shortly.',
    })
  }
  if (!jwk || jwk.kty !== 'RSA') refuse('unknown_key')
  if (!(await verifySignature(jwk, `${headerSegment}.${payloadSegment}`, signature))) {
    refuse('bad_signature')
  }

  if (payload.iss !== APPLE_ISSUER) refuse('wrong_issuer')
  if (!audienceMatches(payload.aud, options.audiences)) refuse('wrong_audience')
  assertTimeClaims(payload, Math.floor(now.getTime() / 1000))
  if (payload.nonce !== (await hashAppleNonce(options.rawNonce))) refuse('nonce_mismatch')
  if (typeof payload.sub !== 'string' || !payload.sub) refuse('missing_subject')

  const email = typeof payload.email === 'string' && payload.email ? payload.email : null
  return {
    appleId: payload.sub,
    email: email ? email.trim().toLowerCase() : null,
    emailVerified: email !== null && booleanClaim(payload.email_verified),
    isPrivateEmail: booleanClaim(payload.is_private_email),
  }
}
