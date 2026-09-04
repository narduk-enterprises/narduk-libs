/**
 * Web Crypto helpers for Apple Maps JWT signing (PEM import, base64url, DER→raw).
 */

/**
 * Import a PEM-encoded ES256 private key for use with Web Crypto API.
 */
export async function importPrivateKeyForAppleMaps(pemKey: string): Promise<CryptoKey> {
  if (
    pemKey.includes('-----BEGIN EC PRIVATE KEY-----') ||
    pemKey.includes('-----END EC PRIVATE KEY-----')
  ) {
    throw new Error(
      'Apple Maps private key must use PKCS#8 PEM format (BEGIN PRIVATE KEY); SEC1 EC PRIVATE KEY PEMs are not supported by Web Crypto importKey("pkcs8").',
    )
  }

  const pemBody = pemKey
    .replaceAll('-----BEGIN PRIVATE KEY-----', '')
    .replaceAll('-----END PRIVATE KEY-----', '')
    .replaceAll(/\s/g, '')

  const binaryStr = atob(pemBody)
  const bytes = new Uint8Array(binaryStr.length)
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i)
  }

  return crypto.subtle.importKey(
    'pkcs8',
    bytes.buffer,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  )
}

export function base64urlEncode(input: ArrayBuffer | string): string {
  let str: string
  if (typeof input === 'string') {
    str = btoa(input)
  } else {
    const bytes = new Uint8Array(input)
    let binary = ''
    for (const b of bytes) binary += String.fromCharCode(b)
    str = btoa(binary)
  }
  return str.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

/**
 * Convert a DER-encoded ECDSA signature to raw (r||s) format.
 * Web Crypto may return DER format on some platforms.
 */
export function derEcdsaSignatureToRaw(der: Uint8Array): Uint8Array {
  if (der.length === 64) return der

  if (der[0] !== 0x30) return der

  let offset = 2
  const lenByte = der[1]
  if (lenByte === undefined) return der
  if (lenByte & 0x80) offset += lenByte & 0x7f

  if (der[offset] !== 0x02) return der
  const rLen = der[offset + 1]
  if (rLen === undefined) return der
  offset += 2
  let r = der.slice(offset, offset + rLen)
  offset += rLen

  if (der[offset] !== 0x02) return der
  const sLen = der[offset + 1]
  if (sLen === undefined) return der
  offset += 2
  let s = der.slice(offset, offset + sLen)

  if (r.length > 32) r = r.slice(r.length - 32)
  if (s.length > 32) s = s.slice(s.length - 32)

  const raw = new Uint8Array(64)
  raw.set(r, 32 - r.length)
  raw.set(s, 64 - s.length)
  return raw
}
