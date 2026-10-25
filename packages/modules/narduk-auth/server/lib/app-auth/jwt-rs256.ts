/**
 * RS256 identity-token primitives shared by Sign in with Apple and Google
 * sign-in on the local backend (narduk-libs#164, #1951): base64url decoding,
 * a JWKS cache that refetches on rotation but not on every forged `kid`, and
 * RSASSA-PKCS1-v1_5 signature verification with Web Crypto.
 *
 * Claim checks (`iss`, `aud`, `exp`, nonce) stay with each provider, whose
 * rules differ.
 */

/** Keys are re-fetched after this, and at most this often for an unknown `kid`. */
const JWKS_TTL_MS = 60 * 60 * 1000
const JWKS_MIN_REFETCH_MS = 60 * 1000

export interface RsaJwk {
  alg?: string
  e: string
  kid: string
  kty: string
  n: string
  use?: string
}

export type JwksFetcher = () => Promise<{ keys: RsaJwk[] }>

export interface JwksCache {
  /** The key for `kid`, fetching the set when it is stale or `kid` is new. */
  find: (kid: string, fetchJwks: JwksFetcher, now: number) => Promise<RsaJwk | null>
  reset: () => void
}

export function createJwksCache(): JwksCache {
  let cache: { fetchedAt: number; keys: RsaJwk[] } | null = null
  return {
    async find(kid, fetchJwks, now) {
      const cached = cache?.keys.find((key) => key.kid === kid)
      const fresh = cache && now - cache.fetchedAt < JWKS_TTL_MS
      if (cached && fresh) return cached
      // An unknown kid may be a rotation: refetch, but not on every forged token.
      if (cache && !cached && now - cache.fetchedAt < JWKS_MIN_REFETCH_MS) return null

      const { keys } = await fetchJwks()
      cache = { fetchedAt: now, keys: Array.isArray(keys) ? keys : [] }
      return cache.keys.find((key) => key.kid === kid) ?? null
    },
    reset() {
      cache = null
    },
  }
}

/** A JWKS fetcher for a provider's published key set. */
export function httpJwksFetcher(url: string, provider: string): JwksFetcher {
  return async () => {
    const response = await globalThis.fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) throw new Error(`${provider} JWKS answered ${response.status}`)
    return (await response.json()) as { keys: RsaJwk[] }
  }
}

export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

export function decodeJsonSegment(segment: string): Record<string, unknown> {
  const parsed = JSON.parse(new TextDecoder().decode(base64UrlToBytes(segment))) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error('not an object')
  return parsed as Record<string, unknown>
}

export function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** SHA-256 hex of a value: the nonce sent to the provider and expected in its token. */
export async function sha256Hex(value: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
}

/** A random hex token for `state`, raw nonces and PKCE verifiers. */
export function randomHexToken(bytes = 32): string {
  const buffer = new Uint8Array(bytes)
  crypto.getRandomValues(buffer)
  return toHex(buffer.buffer)
}

export function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false
  let diff = 0
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return diff === 0
}

export async function verifyRs256Signature(
  jwk: RsaJwk,
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

export function audienceMatches(aud: unknown, audiences: readonly string[]): boolean {
  const values = Array.isArray(aud) ? aud : [aud]
  return values.some((value) => typeof value === 'string' && audiences.includes(value))
}

export function booleanClaim(value: unknown): boolean {
  return value === true || value === 'true'
}
