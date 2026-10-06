/**
 * Signed traffic-class claims (ES256 JWS), verified with WebCrypto only.
 *
 * The operator portal holds the one private key. Every estate origin verifies
 * with the public keys below, so no app needs a new secret and no signing
 * secret ever reaches a browser. Two token kinds share the format:
 *
 * - **class claim** (`typ: narduk-traffic-class`): what the enrollment endpoint
 *   stores in the first-party `__Host-narduk_traffic` cookie. It carries only
 *   `cls: 'owner'`, the origin it is bound to (`aud`) and its lifetime — no
 *   identity, email or person id. The browser verifies it at analytics init.
 * - **enrollment token** (`typ: narduk-traffic-enroll`): the ~2-minute,
 *   single-use, origin-bound token the portal's redirect chain carries to
 *   `/api/owner/enroll`. It wraps the class claim and the signed return URL.
 *
 * Revocation is a key-version bump: drop the old `kid` from
 * {@link TRAFFIC_CLAIM_PUBLIC_KEYS} and release. Every claim signed with it
 * stops verifying and that browser falls back to unmarked.
 */

export const TRAFFIC_CLAIM_COOKIE = '__Host-narduk_traffic'
/** Plain-HTTP dev cannot use the `__Host-` prefix. */
export const TRAFFIC_CLAIM_DEV_COOKIE = 'narduk_traffic'

export const TRAFFIC_CLASS_TYP = 'narduk-traffic-class'
export const TRAFFIC_ENROLL_TYP = 'narduk-traffic-enroll'

/** The only issuer whose return URLs an enrollment may redirect to. */
export const TRAFFIC_ENROLLMENT_ISSUERS = ['https://ops.nardukenterprises.com'] as const

/** The issuer's chain step: the only path an unverified fallback may name. */
export const TRAFFIC_ENROLLMENT_STEP_PATH = '/traffic/enroll'

/** Allow a host clock a little ahead of the portal's. */
const CLOCK_SKEW_SECONDS = 60

export interface TrafficPublicJwk {
  crv: 'P-256'
  kty: 'EC'
  x: string
  y: string
}

/**
 * Public verification keys by key version. Public by design: they verify,
 * they cannot sign. The private half lives only in the operator portal's
 * Worker secret `TRAFFIC_ENROLLMENT_SIGNING_KEY` (nvault-backed).
 */
export const TRAFFIC_CLAIM_PUBLIC_KEYS: Readonly<Record<string, TrafficPublicJwk>> = {
  v1: {
    kty: 'EC',
    crv: 'P-256',
    x: 'KWiGVo8mCJW4FHRloYIDL6sZ_5cfb8G1FqLhItxLd6Q',
    y: 'aEfXtgt0n2xgquNEbqeUNNNhVAU_wJqj4xd7i-TSn-M',
  },
}

export interface JwsParts {
  header: Record<string, unknown>
  payload: Record<string, unknown>
  signature: Uint8Array
  signingInput: string
}

function base64UrlToBytes(value: string): Uint8Array | null {
  if (!/^[\w-]*$/u.test(value)) return null
  const padded = value.replaceAll('-', '+').replaceAll('_', '/')
  const withPadding = padded + '='.repeat((4 - (padded.length % 4)) % 4)
  try {
    const binary = atob(withPadding)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
    return bytes
  } catch {
    return null
  }
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

function decodeJson(segment: string): Record<string, unknown> | null {
  const bytes = base64UrlToBytes(segment)
  if (!bytes) return null
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes))
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/** Split a compact JWS. Structure only; nothing here is trusted yet. */
export function parseJws(token: string): JwsParts | null {
  if (typeof token !== 'string' || token.length > 4096) return null
  const segments = token.split('.')
  if (segments.length !== 3) return null
  const [headerSegment, payloadSegment, signatureSegment] = segments as [string, string, string]
  const header = decodeJson(headerSegment)
  const payload = decodeJson(payloadSegment)
  const signature = base64UrlToBytes(signatureSegment)
  if (!header || !payload || !signature) return null
  return { header, payload, signature, signingInput: `${headerSegment}.${payloadSegment}` }
}

const keyCache = new Map<string, Promise<CryptoKey>>()

function importPublicKey(kid: string, jwk: TrafficPublicJwk): Promise<CryptoKey> {
  const cacheKey = `${kid}:${jwk.x}:${jwk.y}`
  let key = keyCache.get(cacheKey)
  if (!key) {
    key = crypto.subtle.importKey(
      'jwk',
      { ...jwk, ext: true },
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    )
    keyCache.set(cacheKey, key)
  }
  return key
}

/** Verify an ES256 signature against the key its `kid` names. */
export async function verifyJwsSignature(
  parts: JwsParts,
  keys: Readonly<Record<string, TrafficPublicJwk>> = TRAFFIC_CLAIM_PUBLIC_KEYS,
): Promise<boolean> {
  if (parts.header.alg !== 'ES256') return false
  const kid = parts.header.kid
  if (typeof kid !== 'string' || !Object.hasOwn(keys, kid)) return false
  if (parts.signature.length !== 64) return false
  try {
    const key = await importPublicKey(kid, keys[kid]!)
    return await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      parts.signature as Uint8Array<ArrayBuffer>,
      new TextEncoder().encode(parts.signingInput),
    )
  } catch {
    return false
  }
}

export type ClaimFailure = 'bad_signature' | 'expired' | 'malformed' | 'wrong_origin'

export interface VerifyOptions {
  /** The origin the token must be bound to, e.g. `https://borderwaitstat.us`. */
  audience: string
  keys?: Readonly<Record<string, TrafficPublicJwk>>
  nowMs?: number
  typ: string
}

/**
 * Verify a token's signature, type, audience and lifetime. Returns the payload
 * or the first failure. Signature is checked before any claim is believed.
 */
export async function verifyTrafficToken(
  token: string,
  options: VerifyOptions,
): Promise<{ ok: true; payload: Record<string, unknown> } | { ok: false; reason: ClaimFailure }> {
  const parts = parseJws(token)
  if (!parts) return { ok: false, reason: 'malformed' }
  if (!(await verifyJwsSignature(parts, options.keys)))
    return { ok: false, reason: 'bad_signature' }

  const { payload } = parts
  if (payload.typ !== options.typ) return { ok: false, reason: 'malformed' }
  if (typeof payload.aud !== 'string' || payload.aud !== normalizeOrigin(options.audience)) {
    return { ok: false, reason: 'wrong_origin' }
  }
  const exp = payload.exp
  const iat = payload.iat
  if (typeof exp !== 'number' || typeof iat !== 'number') return { ok: false, reason: 'malformed' }
  const nowSec = Math.floor((options.nowMs ?? Date.now()) / 1000)
  if (iat > nowSec + CLOCK_SKEW_SECONDS) return { ok: false, reason: 'malformed' }
  if (exp <= nowSec) return { ok: false, reason: 'expired' }
  return { ok: true, payload }
}

/** True when `token` is a valid owner class claim for `origin`. */
export async function verifyOwnerClassClaim(
  token: string | null | undefined,
  origin: string,
  options: { keys?: Readonly<Record<string, TrafficPublicJwk>>; nowMs?: number } = {},
): Promise<boolean> {
  if (!token) return false
  const result = await verifyTrafficToken(token, {
    audience: origin,
    typ: TRAFFIC_CLASS_TYP,
    keys: options.keys,
    nowMs: options.nowMs,
  })
  return result.ok && result.payload.cls === 'owner'
}

/** `scheme://host[:port]`, lowercased; empty when it is not an absolute URL. */
export function normalizeOrigin(value: string): string {
  try {
    return new URL(value).origin.toLowerCase()
  } catch {
    return ''
  }
}
