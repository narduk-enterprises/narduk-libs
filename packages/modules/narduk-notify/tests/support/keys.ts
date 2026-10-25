export interface TestApnsKey {
  /** The `.p8` contents, as a secret binding would hold them. */
  p8: string
  publicKey: CryptoKey
}

/** A fresh P-256 key per test run: no key material is ever committed. */
export async function generateTestApnsKey(): Promise<TestApnsKey> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])
  const pkcs8 = Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey)).toString(
    'base64',
  )
  const lines = pkcs8.match(/.{1,64}/gu) ?? []
  return {
    p8: ['-----BEGIN PRIVATE KEY-----', ...lines, '-----END PRIVATE KEY-----'].join('\n'),
    publicKey: pair.publicKey,
  }
}

function base64UrlDecode(segment: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(Buffer.from(segment, 'base64url'))
}

export interface VerifiedJwt {
  header: Record<string, unknown>
  payload: Record<string, unknown>
  valid: boolean
}

/** Verify an ES256 JWT the way APNs does: raw r||s signature over `header.payload`. */
export async function verifyJwt(token: string, publicKey: CryptoKey): Promise<VerifiedJwt> {
  const [header = '', payload = '', signature = ''] = token.split('.')
  const valid = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    publicKey,
    base64UrlDecode(signature),
    new TextEncoder().encode(`${header}.${payload}`),
  )
  return {
    header: JSON.parse(Buffer.from(header, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >,
    payload: JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >,
    valid,
  }
}

export const DEVICE_TOKEN = 'ab'.repeat(32)
export const ACTIVITY_TOKEN = 'cd'.repeat(40)
