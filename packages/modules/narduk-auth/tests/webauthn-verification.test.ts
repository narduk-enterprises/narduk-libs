import { isoBase64URL } from '@simplewebauthn/server/helpers'
import { describe, expect, it } from 'vitest'

import {
  assertPasskeyManagementPrincipal,
  evaluateSignatureCounter,
  isClaimedChallengeUsable,
  normalizePasskeyName,
  parseTransports,
  readPresentedChallenge,
} from '../server/lib/app-auth/webauthn-verification'

const COUNTER_REGRESSION = { ok: false, reason: 'counter-regression' } as const

function encodeClientData(value: unknown): string {
  return isoBase64URL.fromBuffer(new TextEncoder().encode(JSON.stringify(value)))
}

describe('evaluateSignatureCounter (clone detection, R6)', () => {
  it('accepts the counter-less authenticator case', () => {
    expect(evaluateSignatureCounter(0, 0)).toEqual({ ok: true, nextCounter: 0 })
  })

  it('accepts a strictly increasing counter', () => {
    expect(evaluateSignatureCounter(0, 1)).toEqual({ ok: true, nextCounter: 1 })
    expect(evaluateSignatureCounter(41, 42)).toEqual({ ok: true, nextCounter: 42 })
    expect(evaluateSignatureCounter(5, 9000)).toEqual({ ok: true, nextCounter: 9000 })
  })

  it('refuses a replayed counter', () => {
    expect(evaluateSignatureCounter(42, 42)).toEqual(COUNTER_REGRESSION)
  })

  it('refuses a regressed counter — the cloned-authenticator signal', () => {
    expect(evaluateSignatureCounter(42, 41)).toEqual(COUNTER_REGRESSION)
    expect(evaluateSignatureCounter(42, 0)).toEqual(COUNTER_REGRESSION)
  })

  it('does not let a credential that once reported a counter escape by dropping to zero', () => {
    // The 0/0 exemption must apply ONLY when the stored counter is also 0.
    expect(evaluateSignatureCounter(1, 0)).toEqual(COUNTER_REGRESSION)
  })

  it('fails closed on non-integer or negative counters', () => {
    for (const [stored, next] of [
      [0, Number.NaN],
      [Number.NaN, 0],
      [0, 1.5],
      [-1, 5],
      [0, -1],
      [0, Number.POSITIVE_INFINITY],
    ] as const) {
      expect(evaluateSignatureCounter(stored, next)).toEqual(COUNTER_REGRESSION)
    }
  })
})

describe('readPresentedChallenge', () => {
  it('extracts the challenge from a well-formed clientDataJSON', () => {
    const clientDataJSON = encodeClientData({
      type: 'webauthn.get',
      challenge: 'Q0hBTExFTkdF',
      origin: 'https://ops.nardukenterprises.com',
    })
    expect(readPresentedChallenge(clientDataJSON)).toBe('Q0hBTExFTkdF')
  })

  it('returns null rather than throwing for junk input', () => {
    expect(readPresentedChallenge('')).toBeNull()
    expect(readPresentedChallenge('not-base64url!!')).toBeNull()
    expect(readPresentedChallenge(encodeClientData({ type: 'webauthn.get' }))).toBeNull()
    expect(readPresentedChallenge(encodeClientData({ challenge: '' }))).toBeNull()
    expect(readPresentedChallenge(encodeClientData({ challenge: 42 }))).toBeNull()
    expect(readPresentedChallenge(encodeClientData(['array']))).toBeNull()
    expect(readPresentedChallenge(encodeClientData(null))).toBeNull()
    expect(readPresentedChallenge(isoBase64URL.fromBuffer(new Uint8Array([0xff, 0x00])))).toBeNull()
  })
})

describe('isClaimedChallengeUsable', () => {
  const now = 1_800_000_000

  it('accepts an unexpired challenge for the matching purpose', () => {
    expect(
      isClaimedChallengeUsable(
        { purpose: 'registration', expiresAt: now + 1 },
        'registration',
        now,
      ),
    ).toBe(true)
  })

  it('refuses a challenge issued for the other ceremony', () => {
    // A registration challenge presented to the authentication verify endpoint
    // has already been deleted by the time this runs, so the attempt is burned
    // as well as refused.
    expect(
      isClaimedChallengeUsable(
        { purpose: 'registration', expiresAt: now + 100 },
        'authentication',
        now,
      ),
    ).toBe(false)
  })

  it('refuses an expired challenge, including one expiring exactly now', () => {
    expect(
      isClaimedChallengeUsable(
        { purpose: 'authentication', expiresAt: now },
        'authentication',
        now,
      ),
    ).toBe(false)
    expect(
      isClaimedChallengeUsable(
        { purpose: 'authentication', expiresAt: now - 1 },
        'authentication',
        now,
      ),
    ).toBe(false)
  })

  it('refuses a missing row — an unknown or already-consumed challenge', () => {
    expect(isClaimedChallengeUsable(null, 'authentication', now)).toBe(false)
    expect(isClaimedChallengeUsable(undefined, 'registration', now)).toBe(false)
  })
})

describe('parseTransports and normalizePasskeyName', () => {
  it('tolerates malformed stored transports', () => {
    expect(parseTransports('["internal","hybrid"]')).toEqual(['internal', 'hybrid'])
    expect(parseTransports('[]')).toEqual([])
    expect(parseTransports('not json')).toEqual([])
    expect(parseTransports('{"a":1}')).toEqual([])
    expect(parseTransports('[1,"usb",null]')).toEqual(['usb'])
  })

  it('trims, caps and nulls out passkey names', () => {
    expect(normalizePasskeyName('  MacBook  ')).toBe('MacBook')
    expect(normalizePasskeyName('   ')).toBeNull()
    expect(normalizePasskeyName(null)).toBeNull()
    expect(normalizePasskeyName(undefined)).toBeNull()
    expect(normalizePasskeyName('x'.repeat(500))).toHaveLength(100)
  })
})

describe('assertPasskeyManagementPrincipal', () => {
  // Executed, not grepped. The route-guard suite proves the call site exists;
  // this proves the call does something, so a guard quietly turned into a
  // no-op fails here rather than shipping.
  it('refuses an API-key principal with 403', () => {
    let thrown: unknown
    try {
      assertPasskeyManagementPrincipal({ authMethod: 'api-key' })
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeDefined()
    expect((thrown as { statusCode?: number }).statusCode).toBe(403)
  })

  it('permits an interactive session principal', () => {
    expect(() => assertPasskeyManagementPrincipal({ authMethod: 'session' })).not.toThrow()
  })

  it('permits a principal whose method is absent rather than failing open on api-key', () => {
    // `requireAuth` always sets authMethod, so an absent one is a caller that
    // is not requireAuth's output. It must not be mistaken for an API key —
    // and, equally, an unrecognised value must not be silently refused.
    expect(() => assertPasskeyManagementPrincipal({})).not.toThrow()
    expect(() => assertPasskeyManagementPrincipal({ authMethod: undefined })).not.toThrow()
    expect(() => assertPasskeyManagementPrincipal({ authMethod: 'API-KEY' })).not.toThrow()
  })
})
