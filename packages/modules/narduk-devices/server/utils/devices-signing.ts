/**
 * Canonical JSON, base64url, SHA-256 and Ed25519 verification — every byte
 * that crosses the device/cloud boundary is defined here so the edge client
 * (any language) can reproduce it exactly.
 *
 * Canonical JSON (inherited edge-cloud-v1 §session): object keys sorted
 * code-point ascending at every depth, no insignificant whitespace, UTF-8.
 * Arrays keep their order. `undefined` members are omitted, as `JSON.stringify`
 * would omit them.
 */
export type CanonicalValue =
  | string
  | number
  | boolean
  | null
  | CanonicalValue[]
  | { [key: string]: CanonicalValue | undefined }

function sortValue(value: CanonicalValue | undefined): CanonicalValue | undefined {
  if (Array.isArray(value)) return value.map((entry) => sortValue(entry) ?? null)
  if (value !== null && typeof value === 'object') {
    const sorted: { [key: string]: CanonicalValue } = {}
    for (const key of Object.keys(value).sort()) {
      const entry = sortValue(value[key])
      if (entry !== undefined) sorted[key] = entry
    }
    return sorted
  }
  return value
}

export function canonicalJson(value: CanonicalValue): string {
  return JSON.stringify(sortValue(value))
}

export function canonicalBytes(value: CanonicalValue): Uint8Array {
  return new TextEncoder().encode(canonicalJson(value))
}

const BASE64URL_PATTERN = /^[\w-]*$/u

/**
 * Both halves matter: the alphabet, and a length base64 can actually carry.
 * `length % 4 === 1` is one leftover character, which no byte sequence encodes
 * to — `atob` throws a DOMException on it, so a caller that only checked the
 * alphabet turned attacker-controlled input into an uncaught 500 rather than a
 * refusal (narduk-libs#212 review finding 4).
 */
export function isBase64Url(value: string): boolean {
  return BASE64URL_PATTERN.test(value) && value.length % 4 !== 1
}

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

export function base64UrlDecode(value: string): Uint8Array {
  if (!isBase64Url(value)) throw new TypeError('Value is not base64url.')
  const padded = value.replaceAll('-', '+').replaceAll('_', '/')
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

/**
 * `base64UrlDecode` for untrusted input: `null` instead of a throw, so a
 * malformed signature or key becomes an authentication failure (counted by the
 * lockout gate) rather than an uncaught DOMException.
 */
export function tryBase64UrlDecode(value: string): Uint8Array | null {
  if (!isBase64Url(value)) return null
  try {
    return base64UrlDecode(value)
  } catch {
    return null
  }
}

export function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function sha256Hex(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes as BufferSource)
  return toHex(new Uint8Array(digest))
}

export function randomBase64Url(bytes: number): string {
  return base64UrlEncode(globalThis.crypto.getRandomValues(new Uint8Array(bytes)))
}

/** Raw Ed25519 public keys are exactly 32 bytes. */
export const ED25519_PUBLIC_KEY_BYTES = 32
export const ED25519_SIGNATURE_BYTES = 64

export interface SignatureVerifier {
  (input: { message: Uint8Array; publicKey: Uint8Array; signature: Uint8Array }): Promise<boolean>
}

/**
 * WebCrypto Ed25519, available on Node ≥ 20 and in Cloudflare Workers, so the
 * same verifier runs in tests and in the Worker. A consumer on a runtime
 * without it passes its own `verifySignature` to `createDevices`.
 */
export const verifyEd25519: SignatureVerifier = async ({ message, publicKey, signature }) => {
  if (
    publicKey.length !== ED25519_PUBLIC_KEY_BYTES ||
    signature.length !== ED25519_SIGNATURE_BYTES
  ) {
    return false
  }
  try {
    const key = await globalThis.crypto.subtle.importKey(
      'raw',
      publicKey as BufferSource,
      { name: 'Ed25519' },
      false,
      ['verify'],
    )
    return await globalThis.crypto.subtle.verify(
      'Ed25519',
      key,
      signature as BufferSource,
      message as BufferSource,
    )
  } catch {
    return false
  }
}
