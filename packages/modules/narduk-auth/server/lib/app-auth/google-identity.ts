import { createError } from 'h3'

import {
  audienceMatches,
  booleanClaim,
  createJwksCache,
  decodeJsonSegment,
  httpJwksFetcher,
  type JwksFetcher,
  type RsaJwk,
  sha256Hex,
  verifyRs256Signature,
} from './jwt-rs256'

/**
 * Google ID-token verification for the local backend (narduk-libs#1951).
 *
 * A Google ID token is an RS256 JWT signed with a key from Google's JWKS. It
 * is accepted only when the signature verifies against that key, `iss` is
 * Google, `aud` is this app's OAuth client id, it has not expired, and its
 * `nonce` claim is the SHA-256 (hex) of the raw nonce this server bound to the
 * browser — so a token minted for another request, or another app, is refused.
 */

/** Google issues both forms (https://developers.google.com/identity/openid-connect/openid-connect#validatinganidtoken). */
export const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'] as const
export const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs'
export const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'

/** Tolerated clock skew for `exp` / `iat`. */
const CLOCK_SKEW_SECONDS = 60

export interface GoogleIdentityClaims {
  email: string | null
  emailVerified: boolean
  /** Google's stable account id (`sub`); stored as `auth_identities.subject`. */
  googleSub: string
  name: string | null
}

export type GoogleJwksFetcher = JwksFetcher

export interface VerifyGoogleIdTokenOptions {
  /** The app's OAuth client id: the only accepted `aud`. */
  clientId: string
  fetchJwks?: GoogleJwksFetcher
  now?: Date
  /** The raw nonce bound to this browser; the token must carry its SHA-256 hex. */
  rawNonce: string
}

const jwksCache = createJwksCache()
const defaultFetchJwks = httpJwksFetcher(GOOGLE_JWKS_URL, 'Google')

/** Test seam: forget the cached Google keys. */
export function resetGoogleJwksCache(): void {
  jwksCache.reset()
}

function refuse(reason: string): never {
  throw createError({
    statusCode: 401,
    statusMessage: 'Google sign-in could not be verified.',
    data: { code: 'google_token_invalid', reason },
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

export async function verifyGoogleIdToken(
  token: string,
  options: VerifyGoogleIdTokenOptions,
): Promise<GoogleIdentityClaims> {
  if (!options.clientId) refuse('no_audience_configured')
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
      statusMessage: 'Google sign-in keys are unavailable. Try again shortly.',
    })
  }
  if (!jwk || jwk.kty !== 'RSA') refuse('unknown_key')
  if (!(await verifyRs256Signature(jwk, `${headerSegment}.${payloadSegment}`, signature))) {
    refuse('bad_signature')
  }

  if (!(GOOGLE_ISSUERS as readonly unknown[]).includes(payload.iss)) refuse('wrong_issuer')
  if (!audienceMatches(payload.aud, [options.clientId])) refuse('wrong_audience')
  assertTimeClaims(payload, Math.floor(now.getTime() / 1000))
  if (payload.nonce !== (await sha256Hex(options.rawNonce))) refuse('nonce_mismatch')
  if (typeof payload.sub !== 'string' || !payload.sub) refuse('missing_subject')

  const email = typeof payload.email === 'string' && payload.email ? payload.email : null
  const name = typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim() : null
  return {
    googleSub: payload.sub,
    email: email ? email.trim().toLowerCase() : null,
    emailVerified: email !== null && booleanClaim(payload.email_verified),
    name: name ? name.slice(0, 200) : null,
  }
}
