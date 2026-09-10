import { generateKeyPairSync, sign } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import {
  base64UrlDecode,
  base64UrlEncode,
  canonicalBytes,
  canonicalJson,
  isBase64Url,
  randomBase64Url,
  sha256Hex,
  verifyEd25519,
} from '../server/utils/devices-signing'

describe('canonical JSON', () => {
  it('sorts keys at every depth and drops whitespace and undefined members', () => {
    expect(
      canonicalJson({
        z: 1,
        a: { d: [3, { y: 'x', b: null }], c: true },
        m: undefined,
        u: 'ü',
      }),
    ).toBe('{"a":{"c":true,"d":[3,{"b":null,"y":"x"}]},"u":"ü","z":1}')
    expect(canonicalBytes({ a: 'é' })).toEqual(new TextEncoder().encode('{"a":"é"}'))
    expect(canonicalJson([{ b: 1, a: 2 }, 'x'])).toBe('[{"a":2,"b":1},"x"]')
  })

  it('reproduces the inherited receipt test vector byte for byte', () => {
    // edge-cloud-v1 §"Receipt Signature Test Vector": sorted keys, no whitespace.
    const payload = {
      status: 'succeeded',
      commandId: 'cmd_test_vector_001',
      deliverySequence: 1,
      edgeDeviceId: 'edge_test_vector_001',
      installationId: 'inst_test_vector_001',
      observedAt: '2026-06-05T12:00:00.000Z',
      receiptHash: 'sha256:7d865e959b4abf14d912678ffeaa57f98c0478d55856741f3906686b00b898d5',
      revocationGeneration: 1,
      sessionId: 'eds_test_vector_001',
      tenantId: 'tenant_test_vector_001',
      vesselId: 'vessel_test_vector_001',
    }
    expect(canonicalJson(payload)).toBe(
      '{"commandId":"cmd_test_vector_001","deliverySequence":1,"edgeDeviceId":"edge_test_vector_001","installationId":"inst_test_vector_001","observedAt":"2026-06-05T12:00:00.000Z","receiptHash":"sha256:7d865e959b4abf14d912678ffeaa57f98c0478d55856741f3906686b00b898d5","revocationGeneration":1,"sessionId":"eds_test_vector_001","status":"succeeded","tenantId":"tenant_test_vector_001","vesselId":"vessel_test_vector_001"}',
    )
  })
})

describe('base64url and hashing', () => {
  it('round-trips bytes without padding', () => {
    const bytes = Uint8Array.from({ length: 70 }, (_, index) => (index * 37) % 256)
    const encoded = base64UrlEncode(bytes)
    expect(encoded).not.toMatch(/[=+/]/u)
    expect(isBase64Url(encoded)).toBe(true)
    expect(base64UrlDecode(encoded)).toEqual(bytes)
    expect(base64UrlEncode(new Uint8Array())).toBe('')
    expect(isBase64Url('a+b')).toBe(false)
    expect(() => base64UrlDecode('a+b')).toThrow(TypeError)
  })

  it('draws the documented entropy and hashes with SHA-256', async () => {
    expect(randomBase64Url(32)).toHaveLength(43)
    expect(randomBase64Url(32)).not.toBe(randomBase64Url(32))
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe(await sha256Hex('abc'))
  })
})

describe('verifyEd25519', () => {
  it('verifies a signature produced by Node crypto over the same bytes', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519')
    const raw = Buffer.from(publicKey.export({ format: 'jwk' }).x ?? '', 'base64url')
    const message = canonicalBytes({ b: 2, a: 1 })
    const signature = new Uint8Array(sign(null, message, privateKey))

    expect(await verifyEd25519({ message, publicKey: new Uint8Array(raw), signature })).toBe(true)
    expect(
      await verifyEd25519({
        message: canonicalBytes({ b: 2, a: 2 }),
        publicKey: new Uint8Array(raw),
        signature,
      }),
    ).toBe(false)
    expect(await verifyEd25519({ message, publicKey: new Uint8Array(31), signature })).toBe(false)
    expect(
      await verifyEd25519({
        message,
        publicKey: new Uint8Array(raw),
        signature: signature.slice(1),
      }),
    ).toBe(false)
    // A structurally valid but wrong key never throws, it just fails.
    expect(await verifyEd25519({ message, publicKey: new Uint8Array(32).fill(1), signature })).toBe(
      false,
    )
  })
})
