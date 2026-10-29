import { describe, expect, it } from 'vitest'

import { NotifyError } from '../src/errors'
import { encryptWebPushPayload } from '../src/web-push'

import { b64, decryptWebPush, generateReceiver, importEcdhPair } from './support/web-push'

// RFC 8291 section 5 and Appendix A.
const PLAINTEXT = 'When I grow up, I want to be a watermelon'
const AUTH_SECRET = 'BTBZMqHH6r4Tts7J_aSIgg'
const UA_PUBLIC =
  'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4'
const UA_PRIVATE = 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94'
const AS_PUBLIC =
  'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8'
const AS_PRIVATE = 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw'
const SALT = 'DGv6ra1nlYgDCS1FRnbzlw'
const RFC_BODY =
  'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml' +
  'mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT' +
  'pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN'

const textEncoder = new TextEncoder()

describe('Web Push payload encryption (RFC 8291 aes128gcm)', () => {
  it('reproduces the RFC 8291 Appendix A body byte for byte', async () => {
    const body = await encryptWebPushPayload(
      textEncoder.encode(PLAINTEXT),
      { p256dh: UA_PUBLIC, auth: AUTH_SECRET },
      {
        salt: b64(SALT),
        senderKeyPair: await importEcdhPair(AS_PUBLIC, AS_PRIVATE),
        recordSize: 4096,
      },
    )
    expect(body).toHaveLength(144)
    expect([...body]).toEqual([...b64(RFC_BODY)])
    // The 86-octet header the appendix lists: salt, rs 4096, idlen 65, sender key.
    expect(Buffer.from(body.subarray(0, 86)).toString('base64url')).toBe(
      'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
    )
  })

  it('decrypts the RFC 8291 body with the receiver private key', async () => {
    const receiverPair = await importEcdhPair(UA_PUBLIC, UA_PRIVATE)
    const decrypted = await decryptWebPush(b64(RFC_BODY), {
      p256dh: UA_PUBLIC,
      auth: AUTH_SECRET,
      privateKey: receiverPair.privateKey,
    })
    expect(new TextDecoder().decode(decrypted.plaintext)).toBe(PLAINTEXT)
  })

  it('round-trips through an independent receiver with a fresh salt and sender key each time', async () => {
    const receiver = await generateReceiver()
    const keys = { p256dh: receiver.p256dh, auth: receiver.auth }
    const first = await encryptWebPushPayload(textEncoder.encode('Charizard ETB restocked'), keys)
    const second = await encryptWebPushPayload(textEncoder.encode('Charizard ETB restocked'), keys)
    const decrypted = await decryptWebPush(first, receiver)
    expect(new TextDecoder().decode(decrypted.plaintext)).toBe('Charizard ETB restocked')
    expect(decrypted.recordSize).toBe(4096)
    expect(decrypted.senderPublic).toHaveLength(65)
    expect(Buffer.from(first.subarray(0, 16)).equals(Buffer.from(second.subarray(0, 16)))).toBe(
      false,
    )
    expect(Buffer.from(first.subarray(21, 86)).equals(Buffer.from(second.subarray(21, 86)))).toBe(
      false,
    )
  })

  it('round-trips an empty-looking boundary: the largest payload one 4096-byte record holds', async () => {
    const receiver = await generateReceiver()
    const largest = new Uint8Array(3993).fill(0x61)
    const body = await encryptWebPushPayload(largest, {
      p256dh: receiver.p256dh,
      auth: receiver.auth,
    })
    expect(body).toHaveLength(4096)
    expect((await decryptWebPush(body, receiver)).plaintext).toEqual(largest)
  })

  it('refuses plaintext that does not fit one record', async () => {
    const receiver = await generateReceiver()
    const keys = { p256dh: receiver.p256dh, auth: receiver.auth }
    const error = await encryptWebPushPayload(new Uint8Array(4080), keys).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(NotifyError)
    expect((error as NotifyError).code).toBe('payload_too_large')
  })

  it('rejects malformed subscription keys', async () => {
    const receiver = await generateReceiver()
    const plain = new Uint8Array([1])
    await expect(
      encryptWebPushPayload(plain, { p256dh: 'AAAA', auth: receiver.auth }),
    ).rejects.toThrow(/p256dh must be 65 bytes/u)
    await expect(
      encryptWebPushPayload(plain, { p256dh: receiver.p256dh, auth: 'AAAA' }),
    ).rejects.toThrow(/auth must be 16 bytes/u)
    await expect(
      encryptWebPushPayload(plain, { p256dh: receiver.p256dh, auth: '!!!!' }),
    ).rejects.toThrow(/not base64url/u)
    // 65 bytes, but not a point on the curve.
    const offCurve = Buffer.alloc(65, 7)
    offCurve[0] = 4
    await expect(
      encryptWebPushPayload(plain, { p256dh: offCurve.toString('base64url'), auth: receiver.auth }),
    ).rejects.toThrow(/valid P-256 public key/u)
  })
})
