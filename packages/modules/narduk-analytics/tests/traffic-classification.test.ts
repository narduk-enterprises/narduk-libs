import { createEvent } from 'h3'
import { beforeAll, describe, expect, it } from 'vitest'

import { resolveBrowserTrafficProperties } from '../app/traffic/trafficClassBrowser'
import {
  createTrafficReplayGuard,
  enrollmentReturnUrl,
  resolveServerTrafficProperties,
  unverifiedPortalReturn,
  verifyEnrollmentToken,
} from '../server/utils/traffic-enrollment'
import {
  bytesToBase64Url,
  TRAFFIC_CLAIM_PUBLIC_KEYS,
  TRAFFIC_CLASS_TYP,
  TRAFFIC_ENROLL_TYP,
  verifyOwnerClassClaim,
} from '../server/utils/traffic/trafficClaim'
import {
  parseAutomationMarker,
  resolveTrafficProperties,
  TRAFFIC_CLASSIFICATION_VERSION,
} from '../server/utils/traffic/trafficClass'

import type { TrafficPublicJwk } from '../server/utils/traffic/trafficClaim'
import type { H3Event } from 'h3'
import type { IncomingMessage, ServerResponse } from 'node:http'

const ORIGIN = 'https://borderwaitstat.us'
const PORTAL = 'https://ops.nardukenterprises.com'
const NOW_MS = Date.UTC(2026, 9, 5, 12, 0, 0)
const NOW = Math.floor(NOW_MS / 1000)

let privateKey: CryptoKey
let otherPrivateKey: CryptoKey
let keys: Record<string, TrafficPublicJwk>

async function publicJwk(key: CryptoKey): Promise<TrafficPublicJwk> {
  const jwk = await crypto.subtle.exportKey('jwk', key)
  return { kty: 'EC', crv: 'P-256', x: jwk.x!, y: jwk.y! }
}

beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair
  const other = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair
  privateKey = pair.privateKey
  otherPrivateKey = other.privateKey
  keys = { test1: await publicJwk(pair.publicKey) }
})

function segment(value: unknown): string {
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(value)))
}

async function sign(
  payload: Record<string, unknown>,
  options: { key?: CryptoKey; kid?: string } = {},
): Promise<string> {
  const input = `${segment({ alg: 'ES256', kid: options.kid ?? 'test1', typ: 'JWT' })}.${segment(payload)}`
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    options.key ?? privateKey,
    new TextEncoder().encode(input),
  )
  return `${input}.${bytesToBase64Url(new Uint8Array(signature))}`
}

function claim(overrides: Record<string, unknown> = {}) {
  return sign({
    typ: TRAFFIC_CLASS_TYP,
    cls: 'owner',
    aud: ORIGIN,
    iat: NOW,
    exp: NOW + 30 * 86_400,
    ...overrides,
  })
}

async function enrollToken(overrides: Record<string, unknown> = {}, signOptions = {}) {
  return sign(
    {
      typ: TRAFFIC_ENROLL_TYP,
      act: 'enroll',
      aud: ORIGIN,
      iat: NOW,
      exp: NOW + 120,
      jti: crypto.randomUUID(),
      ret: `${PORTAL}/traffic/enroll?act=enroll&q=1`,
      claim: await claim(),
      ...overrides,
    },
    signOptions,
  )
}

function makeEvent(headers: Record<string, string>, url = '/'): H3Event {
  const request = {
    headers: { host: 'borderwaitstat.us', 'x-forwarded-proto': 'https', ...headers },
    method: 'GET',
    url,
    connection: { encrypted: true },
    socket: { encrypted: true },
  } as unknown as IncomingMessage
  const response = {
    getHeader: () => {},
    setHeader: () => {},
  } as unknown as ServerResponse
  return createEvent(request, response)
}

describe('automation user-agent marker', () => {
  it('reads the tool from NardukAutomation/<tool>, lowercased', () => {
    const ua =
      'Mozilla/5.0 (Linux; Android 11; moto g power (2022)) Chrome/141.0 Mobile Safari/537.36 NardukAutomation/lighthouse'
    expect(parseAutomationMarker(ua)).toBe('lighthouse')
    expect(parseAutomationMarker('x NardukAutomation/Narduk-App-Tools.v2')).toBe(
      'narduk-app-tools.v2',
    )
  })

  it('is null for ordinary or absent user agents', () => {
    expect(parseAutomationMarker('Mozilla/5.0 Chrome/141.0')).toBeNull()
    expect(parseAutomationMarker('NardukAutomation/')).toBeNull()
    expect(parseAutomationMarker(undefined)).toBeNull()
    expect(parseAutomationMarker('')).toBeNull()
  })

  it('caps the tool length so the property stays low-cardinality', () => {
    expect(parseAutomationMarker(`NardukAutomation/${'a'.repeat(200)}`)).toHaveLength(40)
  })
})

describe('class precedence', () => {
  it('automation beats a signed owner beats the unsigned flag beats unmarked', () => {
    expect(
      resolveTrafficProperties({
        automationTool: 'lighthouse',
        signedOwner: true,
        unsignedOwner: true,
      }),
    ).toEqual({
      classification_version: TRAFFIC_CLASSIFICATION_VERSION,
      traffic_class: 'automation',
      traffic_evidence: 'ua_marker',
      automation_tool: 'lighthouse',
    })
    expect(resolveTrafficProperties({ signedOwner: true, unsignedOwner: true })).toEqual({
      classification_version: 1,
      traffic_class: 'owner',
      traffic_evidence: 'signed_enrollment',
    })
    expect(resolveTrafficProperties({ unsignedOwner: true })).toEqual({
      classification_version: 1,
      traffic_class: 'owner',
      traffic_evidence: 'unsigned_claim',
    })
    expect(resolveTrafficProperties({})).toEqual({
      classification_version: 1,
      traffic_class: 'unmarked',
      traffic_evidence: 'none',
    })
  })
})

describe('class claim', () => {
  it('verifies an owner claim bound to this origin', async () => {
    expect(await verifyOwnerClassClaim(await claim(), ORIGIN, { keys, nowMs: NOW_MS })).toBe(true)
  })

  it('refuses an expired, wrong-origin, wrong-key or tampered claim', async () => {
    const opts = { keys, nowMs: NOW_MS }
    expect(await verifyOwnerClassClaim(await claim({ exp: NOW - 1 }), ORIGIN, opts)).toBe(false)
    expect(
      await verifyOwnerClassClaim(await claim({ aud: 'https://lakestat.us' }), ORIGIN, opts),
    ).toBe(false)
    expect(
      await verifyOwnerClassClaim(
        await sign(
          { typ: TRAFFIC_CLASS_TYP, cls: 'owner', aud: ORIGIN, iat: NOW, exp: NOW + 60 },
          { key: otherPrivateKey },
        ),
        ORIGIN,
        opts,
      ),
    ).toBe(false)
    const [h, , s] = (await claim()).split('.')
    const forged = `${h}.${segment({ typ: TRAFFIC_CLASS_TYP, cls: 'owner', aud: ORIGIN, iat: NOW, exp: NOW + 9e9 })}.${s}`
    expect(await verifyOwnerClassClaim(forged, ORIGIN, opts)).toBe(false)
    expect(await verifyOwnerClassClaim(await claim({ cls: 'automation' }), ORIGIN, opts)).toBe(
      false,
    )
  })

  it('ships a real P-256 public key for v1', async () => {
    const key = await crypto.subtle.importKey(
      'jwk',
      TRAFFIC_CLAIM_PUBLIC_KEYS.v1!,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    )
    expect(key.type).toBe('public')
  })
})

describe('enrollment token', () => {
  const base = () => ({ audience: ORIGIN, keys, nowMs: NOW_MS, replay: createTrafficReplayGuard() })

  it('grants the claim and the portal return on a valid token', async () => {
    const result = await verifyEnrollmentToken(await enrollToken(), base())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.grant.action).toBe('enroll')
    expect(result.grant.claimMaxAge).toBe(30 * 86_400)
    expect(result.grant.returnTo).toBe(`${PORTAL}/traffic/enroll?act=enroll&q=1`)
  })

  it('refuses an expired token', async () => {
    const result = await verifyEnrollmentToken(
      await enrollToken({ iat: NOW - 200, exp: NOW - 80 }),
      base(),
    )
    expect(result).toEqual({ ok: false, reason: 'expired' })
  })

  it('refuses a replayed token', async () => {
    const options = base()
    const token = await enrollToken()
    expect((await verifyEnrollmentToken(token, options)).ok).toBe(true)
    expect(await verifyEnrollmentToken(token, options)).toEqual({ ok: false, reason: 'replayed' })
  })

  it('refuses a token minted for another origin', async () => {
    const result = await verifyEnrollmentToken(
      await enrollToken({ aud: 'https://lakestat.us' }),
      base(),
    )
    expect(result).toEqual({ ok: false, reason: 'wrong_origin' })
  })

  it('refuses a bad signature, and an unknown key version', async () => {
    expect(
      await verifyEnrollmentToken(await enrollToken({}, { key: otherPrivateKey }), base()),
    ).toEqual({ ok: false, reason: 'bad_signature' })
    expect(await verifyEnrollmentToken(await enrollToken({}, { kid: 'v0' }), base())).toEqual({
      ok: false,
      reason: 'bad_signature',
    })
  })

  it('refuses a return URL that is not the portal, and a long-lived token', async () => {
    expect(
      await verifyEnrollmentToken(await enrollToken({ ret: 'https://evil.example/x' }), base()),
    ).toEqual({ ok: false, reason: 'bad_return' })
    expect(await verifyEnrollmentToken(await enrollToken({ exp: NOW + 3600 }), base())).toEqual({
      ok: false,
      reason: 'malformed',
    })
  })

  it('does not burn a token that fails a non-replay check', async () => {
    const options = base()
    const jti = crypto.randomUUID()
    await verifyEnrollmentToken(await enrollToken({ jti, ret: 'http://x' }), options)
    expect((await verifyEnrollmentToken(await enrollToken({ jti }), options)).ok).toBe(true)
  })

  it('grants a clear without a claim', async () => {
    const result = await verifyEnrollmentToken(
      await enrollToken({ act: 'clear', claim: undefined }),
      base(),
    )
    expect(result.ok && result.grant.action).toBe('clear')
  })

  it('only ever falls back to the portal return, and appends the outcome', async () => {
    expect(unverifiedPortalReturn(await enrollToken({}, { key: otherPrivateKey }))).toBe(
      `${PORTAL}/traffic/enroll?act=enroll&q=1`,
    )
    expect(unverifiedPortalReturn(await enrollToken({ ret: 'https://evil.example/' }))).toBeNull()
    // A forged token may not pick another portal page either.
    expect(
      unverifiedPortalReturn(
        await enrollToken({ ret: `${PORTAL}/logout` }, { key: otherPrivateKey }),
      ),
    ).toBeNull()
    expect(
      unverifiedPortalReturn(
        await enrollToken({ ret: `${PORTAL}/..//evil.example` }, { key: otherPrivateKey }),
      ),
    ).toBeNull()
    expect(unverifiedPortalReturn('garbage')).toBeNull()
    expect(enrollmentReturnUrl(`${PORTAL}/a?i=2`, 'replayed')).toBe(
      `${PORTAL}/a?i=2&outcome=replayed`,
    )
  })
})

describe('browser and server classification', () => {
  it('tags an owner-only app session as authenticated owner, below a signed claim and automation', async () => {
    const yes = async () => true
    const base = { cookie: '', origin: ORIGIN, userAgent: 'Chrome', authenticatedOwner: yes }
    expect(await resolveBrowserTrafficProperties(base, { keys, nowMs: NOW_MS })).toMatchObject({
      traffic_class: 'owner',
      traffic_evidence: 'authenticated_session',
    })
    const withClaim = { ...base, cookie: `__Host-narduk_traffic=${await claim()}` }
    expect(await resolveBrowserTrafficProperties(withClaim, { keys, nowMs: NOW_MS })).toMatchObject(
      {
        traffic_evidence: 'signed_enrollment',
      },
    )
    const bot = { ...base, userAgent: 'Chrome NardukAutomation/vqa' }
    expect(await resolveBrowserTrafficProperties(bot)).toMatchObject({
      traffic_class: 'automation',
    })
    const signedOut = { ...base, authenticatedOwner: async () => false }
    expect(await resolveBrowserTrafficProperties(signedOut)).toMatchObject({
      traffic_class: 'unmarked',
    })
  })

  it('classifies a browser holding a valid claim as a signed owner', async () => {
    const cookie = `a=1; __Host-narduk_traffic=${await claim()}; narduk_owner=true`
    const inputs = { cookie, origin: ORIGIN, userAgent: 'Chrome' }
    expect(await resolveBrowserTrafficProperties(inputs, { keys, nowMs: NOW_MS })).toMatchObject({
      traffic_class: 'owner',
      traffic_evidence: 'signed_enrollment',
    })
    // A claim the shipped key did not sign falls back to the unsigned flag.
    expect(await resolveBrowserTrafficProperties(inputs, { nowMs: NOW_MS })).toMatchObject({
      traffic_class: 'owner',
      traffic_evidence: 'unsigned_claim',
    })
  })

  it('classifies an automation user agent on the server, ignoring cookies', async () => {
    const event = makeEvent({
      'user-agent': 'Chrome NardukAutomation/lighthouse',
      cookie: 'narduk_owner=true',
    })
    expect(await resolveServerTrafficProperties(event)).toMatchObject({
      traffic_class: 'automation',
      automation_tool: 'lighthouse',
    })
  })

  it('classifies a server request with a valid claim cookie as a signed owner', async () => {
    const event = makeEvent({
      'user-agent': 'Chrome',
      cookie: `__Host-narduk_traffic=${await claim()}`,
    })
    expect(await resolveServerTrafficProperties(event, { keys, nowMs: NOW_MS })).toMatchObject({
      traffic_class: 'owner',
      traffic_evidence: 'signed_enrollment',
    })
    expect(
      await resolveServerTrafficProperties(makeEvent({ 'user-agent': 'Chrome' })),
    ).toMatchObject({
      traffic_class: 'unmarked',
      classification_version: 1,
    })
  })
})
