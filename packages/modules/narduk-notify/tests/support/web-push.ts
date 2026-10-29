/**
 * Test-only receiver side of RFC 8291 (a user agent), independent of the
 * implementation under test: it derives keys from the receiver's private key.
 */
import { base64UrlEncode } from '../../src/apns-token'

export function b64(value: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(Buffer.from(value, 'base64url'))
}

function concat(...parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  return new Uint8Array(Buffer.concat(parts))
}

async function hkdf(
  secret: Uint8Array<ArrayBuffer>,
  salt: Uint8Array<ArrayBuffer>,
  info: Uint8Array<ArrayBuffer>,
  bits: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bits),
  )
}

/** An ECDH key pair from base64url raw public point and private scalar. */
export async function importEcdhPair(
  publicKey: string,
  privateKey: string,
): Promise<CryptoKeyPair> {
  const point = b64(publicKey)
  const x = base64UrlEncode(point.subarray(1, 33))
  const y = base64UrlEncode(point.subarray(33, 65))
  const alg = { name: 'ECDH', namedCurve: 'P-256' }
  return {
    privateKey: await crypto.subtle.importKey(
      'jwk',
      { kty: 'EC', crv: 'P-256', x, y, d: privateKey },
      alg,
      false,
      ['deriveBits'],
    ),
    publicKey: await crypto.subtle.importKey(
      'jwk',
      { kty: 'EC', crv: 'P-256', x, y },
      alg,
      true,
      [],
    ),
  }
}

export interface TestReceiver {
  auth: string
  p256dh: string
  privateKey: CryptoKey
}

/** A fresh receiver: the subscription keys a browser would hand over, and its private key. */
export async function generateReceiver(): Promise<TestReceiver> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])) as CryptoKeyPair
  return {
    p256dh: base64UrlEncode(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))),
    auth: base64UrlEncode(crypto.getRandomValues(new Uint8Array(16))),
    privateKey: pair.privateKey,
  }
}

export interface DecryptedPush {
  plaintext: Uint8Array
  recordSize: number
  salt: Uint8Array
  senderPublic: Uint8Array
}

/** Decrypt a single-record aes128gcm body the way a user agent does. */
export async function decryptWebPush(
  body: Uint8Array,
  receiver: Pick<TestReceiver, 'auth' | 'p256dh' | 'privateKey'>,
): Promise<DecryptedPush> {
  const salt = body.slice(0, 16)
  const recordSize = new DataView(body.buffer, body.byteOffset).getUint32(16, false)
  const idLength = body[20] ?? 0
  const senderPublic = body.slice(21, 21 + idLength)
  const record = body.slice(21 + idLength)

  const sender = await crypto.subtle.importKey(
    'raw',
    senderPublic,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  )
  const ecdh = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: sender }, receiver.privateKey, 256),
  )
  const encoder = new TextEncoder()
  const ikm = await hkdf(
    ecdh,
    b64(receiver.auth),
    concat(encoder.encode('WebPush: info\0'), b64(receiver.p256dh), senderPublic),
    256,
  )
  const saltBytes = new Uint8Array(salt)
  const cek = await hkdf(ikm, saltBytes, encoder.encode('Content-Encoding: aes128gcm\0'), 128)
  const nonce = await hkdf(ikm, saltBytes, encoder.encode('Content-Encoding: nonce\0'), 96)
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt'])
  const padded = new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, new Uint8Array(record)),
  )
  // Strip trailing zero padding and the 0x02 (last record) delimiter.
  let end = padded.length
  while (end > 0 && padded[end - 1] === 0) end -= 1
  if (padded[end - 1] !== 2) throw new Error('missing last-record delimiter')
  return { plaintext: padded.slice(0, end - 1), recordSize, salt, senderPublic }
}
