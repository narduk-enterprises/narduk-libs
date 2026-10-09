import { createHash, generateKeyPairSync, sign } from 'node:crypto'

import { verifyAuthenticationResponse } from '@simplewebauthn/server'
import { isoBase64URL } from '@simplewebauthn/server/helpers'
import { describe, expect, it } from 'vitest'

import { resolveWebauthnConfig } from '../shared/utils/webauthn-config'

/**
 * A native Apple app (NardukAuthKit `signInWithPasskey`) signs an assertion whose
 * clientDataJSON origin is `https://<rp id>` and carries no `crossOrigin`. This
 * drives the same verifier call `finishPasskeyAuthentication` makes, with a
 * synthetic ES256 authenticator, to prove such an assertion is accepted when
 * `AUTH_WEBAUTHN_ORIGIN` lists that origin and refused when it does not.
 */
const RP_ID = 'nardukenterprises.com'

function config(origins: string) {
  const resolved = resolveWebauthnConfig({
    authBackend: 'local',
    authProviders: ['email', 'passkey'],
    env: { AUTH_WEBAUTHN_RP_ID: RP_ID, AUTH_WEBAUTHN_ORIGIN: origins },
  })
  if (!resolved.enabled) throw new Error('config should resolve')
  return resolved
}

function nativeAssertion(challenge: string) {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const jwk = publicKey.export({ format: 'jwk' })
  const cose = new Map<number, number | Uint8Array>([
    [1, 2],
    [3, -7],
    [-1, 1],
    [-2, Buffer.from(jwk.x ?? '', 'base64url')],
    [-3, Buffer.from(jwk.y ?? '', 'base64url')],
  ])
  const coseBytes = encodeCoseKey(cose)
  const clientDataJSON = Buffer.from(
    JSON.stringify({ type: 'webauthn.get', challenge, origin: `https://${RP_ID}` }),
  )
  // rpIdHash | flags (UP + UV) | signCount
  const authenticatorData = Buffer.concat([
    createHash('sha256').update(RP_ID).digest(),
    Buffer.from([0x05]),
    Buffer.from([0, 0, 0, 0]),
  ])
  const signature = sign(
    'sha256',
    Buffer.concat([authenticatorData, createHash('sha256').update(clientDataJSON).digest()]),
    privateKey,
  )
  const id = isoBase64URL.fromBuffer(new Uint8Array(Buffer.from('native-credential-id')))
  return {
    credential: { id, publicKey: coseBytes, counter: 0 },
    response: {
      id,
      rawId: id,
      type: 'public-key' as const,
      clientExtensionResults: {},
      response: {
        authenticatorData: isoBase64URL.fromBuffer(new Uint8Array(authenticatorData)),
        clientDataJSON: isoBase64URL.fromBuffer(new Uint8Array(clientDataJSON)),
        signature: isoBase64URL.fromBuffer(new Uint8Array(signature)),
      },
    },
  }
}

/** Minimal CBOR for the five-entry EC2 COSE key (small ints, 32-byte strings). */
function encodeCoseKey(entries: Map<number, number | Uint8Array>): Uint8Array {
  const chunks: number[] = [0xa0 + entries.size]
  const int = (value: number) => (value >= 0 ? [value] : [0x20 + (-1 - value)])
  for (const [key, value] of entries) {
    chunks.push(...int(key))
    if (typeof value === 'number') chunks.push(...int(value))
    else chunks.push(0x58, value.length, ...value)
  }
  return new Uint8Array(chunks)
}

describe('native platform assertion against the server verifier', () => {
  const challenge = isoBase64URL.fromBuffer(new Uint8Array(Buffer.from('challenge-from-server')))

  it('accepts clientData origin https://<rp id> when AUTH_WEBAUTHN_ORIGIN lists it', async () => {
    const { response, credential } = nativeAssertion(challenge)
    const accepted = config(`https://ops.${RP_ID}, https://${RP_ID}`)
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: accepted.origins,
      expectedRPID: accepted.rpId,
      requireUserVerification: true,
      credential,
    })
    expect(verification.verified).toBe(true)
  })

  it('refuses it when only a subdomain origin is configured', async () => {
    const { response, credential } = nativeAssertion(challenge)
    const webOnly = config(`https://ops.${RP_ID}`)
    await expect(
      verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: webOnly.origins,
        expectedRPID: webOnly.rpId,
        requireUserVerification: true,
        credential,
      }),
    ).rejects.toThrow(/origin/iu)
  })
})
