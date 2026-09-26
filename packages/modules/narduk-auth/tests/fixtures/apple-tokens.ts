/**
 * Mocked Apple signing keys for Sign in with Apple tests (narduk-libs#164):
 * an RS256 key pair published under `kid: test-key`, and a second key that
 * signs forgeries under the same kid.
 */

interface TestKeys {
  forgeKey: CryptoKey
  privateKey: CryptoKey
  publicJwk: { alg: string; e: string; kid: string; kty: string; n: string; use: string }
}

let keys: Promise<TestKeys> | null = null

async function rsaPair() {
  return crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )
}

export function appleTestKeys(): Promise<TestKeys> {
  keys ??= (async () => {
    const pair = await rsaPair()
    const forge = await rsaPair()
    const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey)
    return {
      forgeKey: forge.privateKey,
      privateKey: pair.privateKey,
      publicJwk: { alg: 'RS256', e: jwk.e!, kid: 'test-key', kty: 'RSA', n: jwk.n!, use: 'sig' },
    }
  })()
  return keys
}

function segment(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

export async function signAppleToken(
  payload: Record<string, unknown>,
  options: { forge?: boolean; kid?: string } = {},
): Promise<string> {
  const { forgeKey, privateKey } = await appleTestKeys()
  const input = `${segment({ alg: 'RS256', kid: options.kid ?? 'test-key' })}.${segment(payload)}`
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    options.forge ? forgeKey : privateKey,
    new TextEncoder().encode(input),
  )
  return `${input}.${Buffer.from(signature).toString('base64url')}`
}
