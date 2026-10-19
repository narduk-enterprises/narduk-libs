import { createError } from 'h3'

import {
  audienceMatches,
  booleanClaim,
  createJwksCache,
  decodeJsonSegment,
  httpJwksFetcher,
  type JwksFetcher,
  randomHexToken,
  type RsaJwk,
  sha256Hex,
  verifyRs256Signature,
} from './jwt-rs256'

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

/** Tolerated clock skew for `exp` / `iat`. */
const CLOCK_SKEW_SECONDS = 60

export interface AppleIdentityClaims {
  /** Apple's stable user id for this team; stored as `users.apple_id`. */
  appleId: string
  email: string | null
  emailVerified: boolean
  isPrivateEmail: boolean
}

export type AppleJwksFetcher = JwksFetcher

export interface VerifyAppleIdentityTokenOptions {
  /** Accepted `aud` values: the Services ID (web) or bundle ids (native). */
  audiences: readonly string[]
  fetchJwks?: AppleJwksFetcher
  now?: Date
  /** The raw nonce bound to this request; the token must carry its SHA-256 hex. */
  rawNonce: string
}

const jwksCache = createJwksCache()
const defaultFetchJwks = httpJwksFetcher(APPLE_JWKS_URL, 'Apple')

/** Test seam: forget the cached Apple keys. */
export function resetAppleJwksCache(): void {
  jwksCache.reset()
}

/** SHA-256 hex of a raw nonce: the value sent to Apple and expected in the token. */
export const hashAppleNonce = sha256Hex

/** A random hex token for `state` and raw nonces. */
export const randomAppleToken = randomHexToken

function refuse(reason: string): never {
  throw createError({
    statusCode: 401,
    statusMessage: 'Apple sign-in could not be verified.',
    data: { code: 'apple_token_invalid', reason },
  })
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
  let jwk: RsaJwk | null
  try {
    jwk = await jwksCache.find(header.kid, options.fetchJwks ?? defaultFetchJwks, now.getTime())
  } catch {
    throw createError({
      statusCode: 503,
      statusMessage: 'Apple sign-in keys are unavailable. Try again shortly.',
    })
  }
  if (!jwk || jwk.kty !== 'RSA') refuse('unknown_key')
  if (!(await verifyRs256Signature(jwk, `${headerSegment}.${payloadSegment}`, signature))) {
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
