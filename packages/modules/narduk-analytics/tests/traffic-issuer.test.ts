import { afterEach, describe, expect, it } from 'vitest'

import { verifyEnrollmentToken } from '../server/utils/traffic-enrollment'
import {
  parseJws,
  TRAFFIC_CLASS_TYP,
  TRAFFIC_ENROLL_TYP,
  verifyOwnerClassClaim,
} from '../server/utils/traffic/trafficClaim'
import {
  importTrafficSigner,
  mintEnrollmentToken,
  probeTrafficEnrollment,
  resetTrafficEnrollmentProbeCache,
  TRAFFIC_CLAIM_SECONDS,
  TRAFFIC_ENROLLMENT_TOKEN_SECONDS,
} from '../server/utils/traffic/trafficIssuer'

import type { ReplayGuard } from '../server/utils/traffic-enrollment'
import type { TrafficPublicJwk } from '../server/utils/traffic/trafficClaim'

/**
 * Golden tokens minted by the operator portal's own issuer as deployed before
 * the issuer moved here (operator-portal `apps/web/server/utils/traffic-enrollment.ts`
 * at 368ec93e), with a throwaway test key whose private half was discarded.
 * They prove the verifier every product site runs (1.28.1, unchanged here)
 * accepts what the portal has been minting, and they pin the wire format the
 * moved issuer must keep producing.
 */
const GOLDEN = {
  nowMs: 1_791_288_000_000,
  origin: 'https://example.nardukenterprises.com',
  key: {
    kty: 'EC',
    crv: 'P-256',
    x: 'AHOsLS5GhV8uClntaHoSwf8dpwQJlUojixfU1yzOuog',
    y: 'fi6BopufDcuqKYr5ZOX609bhNOEbdPqtgo_aV2IgVW8',
  } satisfies TrafficPublicJwk,
  enroll:
    'eyJhbGciOiJFUzI1NiIsImtpZCI6ImZpeHR1cmUiLCJ0eXAiOiJKV1QifQ.eyJ0eXAiOiJuYXJkdWstdHJhZmZpYy1lbnJvbGwiLCJhY3QiOiJlbnJvbGwiLCJhdWQiOiJodHRwczovL2V4YW1wbGUubmFyZHVrZW50ZXJwcmlzZXMuY29tIiwiaWF0IjoxNzkxMjg4MDAwLCJleHAiOjE3OTEyODgxMjAsImp0aSI6IlhCLVpQUGdKd2pWSk5kSTROYTg3NmpyMyIsInJldCI6Imh0dHBzOi8vb3BzLm5hcmR1a2VudGVycHJpc2VzLmNvbS90cmFmZmljL2Vucm9sbD9hY3Q9ZW5yb2xsJmRvbmU9JTJGcG9ydGZvbGlvJTJGYW5hbHl0aWNzJnE9Jm49MCZmPTAmcz0wIiwiY2xhaW0iOiJleUpoYkdjaU9pSkZVekkxTmlJc0ltdHBaQ0k2SW1acGVIUjFjbVVpTENKMGVYQWlPaUpLVjFRaWZRLmV5SjBlWEFpT2lKdVlYSmtkV3N0ZEhKaFptWnBZeTFqYkdGemN5SXNJbU5zY3lJNkltOTNibVZ5SWl3aVlYVmtJam9pYUhSMGNITTZMeTlsZUdGdGNHeGxMbTVoY21SMWEyVnVkR1Z5Y0hKcGMyVnpMbU52YlNJc0ltbGhkQ0k2TVRjNU1USTRPREF3TUN3aVpYaHdJam94Tnprek9EZ3dNREF3ZlEudVVmTGpqVE5hLXlhWkF5SUkybTFkMkFydkFsRmFFTmFlUzdVekxTSENsZGFFeFRxXzJZQTRGbEx2RjJrdUxmREdsck44cEJobl9fREY0WmFkT2VVOXcifQ.w7QtKfmHYGZOzemaMfhA8hydAKMkN-HONqI2iCKuxpYzC19oe56_q_0qAbgIxFfR_spgipXOaj8whcPKHpQMtA',
  clear:
    'eyJhbGciOiJFUzI1NiIsImtpZCI6ImZpeHR1cmUiLCJ0eXAiOiJKV1QifQ.eyJ0eXAiOiJuYXJkdWstdHJhZmZpYy1lbnJvbGwiLCJhY3QiOiJjbGVhciIsImF1ZCI6Imh0dHBzOi8vZXhhbXBsZS5uYXJkdWtlbnRlcnByaXNlcy5jb20iLCJpYXQiOjE3OTEyODgwMDAsImV4cCI6MTc5MTI4ODEyMCwianRpIjoiR1FxMm5QdnpkNkJzTDFjSWVWMHNMemJzIiwicmV0IjoiaHR0cHM6Ly9vcHMubmFyZHVrZW50ZXJwcmlzZXMuY29tL3RyYWZmaWMvZW5yb2xsP2FjdD1jbGVhciZkb25lPSUyRmxvZ291dCZxPSZuPTAmZj0wJnM9MCJ9.t03B_4iNZev_UNM3TaaE5GnaDV-GC6rJV8pdel1UQ8P4Rnh9psqQmnQRNv5AR_PFRTzBcPG6DdrvPBkIrrLsOw',
} as const

const RETURN_TO =
  'https://ops.nardukenterprises.com/traffic/enroll?act=enroll&done=%2Fportfolio%2Fanalytics&q=&n=0&f=0&s=0'

function freshReplay(): ReplayGuard {
  const seen = new Set<string>()
  return {
    async markUsed(jti) {
      if (seen.has(jti)) return false
      seen.add(jti)
      return true
    },
  }
}

/** A test signer, its private JWK as the portal's secret stores it, and its public half. */
async function testSigner(kid: string) {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair
  const priv = await crypto.subtle.exportKey('jwk', pair.privateKey)
  const pub = await crypto.subtle.exportKey('jwk', pair.publicKey)
  const secret = JSON.stringify({ kty: 'EC', crv: 'P-256', x: priv.x, y: priv.y, d: priv.d, kid })
  const signer = await importTrafficSigner(secret)
  const publicKey: TrafficPublicJwk = { kty: 'EC', crv: 'P-256', x: pub.x!, y: pub.y! }
  return { signer: signer!, keys: { [kid]: publicKey } }
}

function segments(token: string): { header: string; payload: Record<string, unknown> } {
  const [header] = token.split('.')
  return {
    header: atob(header!.replaceAll('-', '+').replaceAll('_', '/')),
    payload: parseJws(token)!.payload,
  }
}

describe('golden tokens from the portal issuer as deployed', () => {
  it('verifies an enroll token and its owner class claim', async () => {
    const result = await verifyEnrollmentToken(GOLDEN.enroll, {
      audience: GOLDEN.origin,
      keys: { fixture: GOLDEN.key },
      nowMs: GOLDEN.nowMs,
      replay: freshReplay(),
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.grant.action).toBe('enroll')
    expect(result.grant.returnTo).toBe(RETURN_TO)
    expect(result.grant.claimMaxAge).toBe(TRAFFIC_CLAIM_SECONDS)
    expect(
      await verifyOwnerClassClaim(result.grant.claim, GOLDEN.origin, {
        keys: { fixture: GOLDEN.key },
        nowMs: GOLDEN.nowMs + 29 * 24 * 3600 * 1000,
      }),
    ).toBe(true)
  })

  it('verifies a clear token', async () => {
    const result = await verifyEnrollmentToken(GOLDEN.clear, {
      audience: GOLDEN.origin,
      keys: { fixture: GOLDEN.key },
      nowMs: GOLDEN.nowMs,
      replay: freshReplay(),
    })
    expect(result.ok && result.grant.action).toBe('clear')
  })
})

describe('the moved issuer', () => {
  it('mints tokens whose headers and payload shape match the golden tokens byte for byte', async () => {
    const { signer, keys } = await testSigner('fixture')
    const minted = await mintEnrollmentToken(signer, {
      act: 'enroll',
      origin: GOLDEN.origin,
      returnTo: RETURN_TO,
      nowMs: GOLDEN.nowMs,
    })
    const ours = segments(minted)
    const theirs = segments(GOLDEN.enroll)
    expect(ours.header).toBe(theirs.header)
    expect(Object.keys(ours.payload)).toEqual(Object.keys(theirs.payload))
    const { jti: ourJti, claim: ourClaim, ...ourRest } = ours.payload
    const { jti: theirJti, claim: theirClaim, ...theirRest } = theirs.payload
    expect(ourRest).toEqual(theirRest)
    expect(String(ourJti)).toMatch(/^[\w-]{24}$/u)
    expect(String(theirJti)).toMatch(/^[\w-]{24}$/u)
    // The class claim: same header and the exact same payload segment.
    expect(String(ourClaim).split('.').slice(0, 2)).toEqual(
      String(theirClaim).split('.').slice(0, 2),
    )

    const result = await verifyEnrollmentToken(minted, {
      audience: GOLDEN.origin,
      keys,
      nowMs: GOLDEN.nowMs,
      replay: freshReplay(),
    })
    expect(result.ok).toBe(true)
  })

  it('mints a clear token with no claim, and sets a two-minute life', async () => {
    const { signer, keys } = await testSigner('v9')
    const minted = await mintEnrollmentToken(signer, {
      act: 'clear',
      origin: GOLDEN.origin,
      returnTo: RETURN_TO,
      nowMs: GOLDEN.nowMs,
    })
    const { payload } = segments(minted)
    expect(payload.typ).toBe(TRAFFIC_ENROLL_TYP)
    expect(payload.claim).toBeUndefined()
    expect(Number(payload.exp) - Number(payload.iat)).toBe(TRAFFIC_ENROLLMENT_TOKEN_SECONDS)
    const result = await verifyEnrollmentToken(minted, {
      audience: GOLDEN.origin,
      keys,
      nowMs: GOLDEN.nowMs,
      replay: freshReplay(),
    })
    expect(result.ok && result.grant.action).toBe('clear')
  })

  it('binds the class claim to its origin', async () => {
    const { signer, keys } = await testSigner('v9')
    const minted = await mintEnrollmentToken(signer, {
      act: 'enroll',
      origin: GOLDEN.origin,
      returnTo: RETURN_TO,
      nowMs: GOLDEN.nowMs,
    })
    const claim = String(segments(minted).payload.claim)
    expect(parseJws(claim)!.payload.typ).toBe(TRAFFIC_CLASS_TYP)
    expect(
      await verifyOwnerClassClaim(claim, 'https://other.example', { keys, nowMs: GOLDEN.nowMs }),
    ).toBe(false)
  })

  it('refuses a secret that is not an ES256 private JWK with a kid', async () => {
    expect(await importTrafficSigner(undefined)).toBeNull()
    expect(await importTrafficSigner('')).toBeNull()
    expect(await importTrafficSigner('not json')).toBeNull()
    expect(await importTrafficSigner(JSON.stringify({ ...GOLDEN.key, kid: 'v1' }))).toBeNull()
    expect(await importTrafficSigner(JSON.stringify({ ...GOLDEN.key, d: 'AAAA' }))).toBeNull()
  })
})

describe('probeTrafficEnrollment', () => {
  afterEach(() => resetTrafficEnrollmentProbeCache())

  const answer = (status: number, body: unknown) =>
    (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch

  it('counts only 200 { enrollment: 1 }', async () => {
    expect(
      await probeTrafficEnrollment('https://a.example', {
        fetchImpl: answer(200, { enrollment: 1 }),
      }),
    ).toBe(true)
    expect(
      await probeTrafficEnrollment('https://b.example', {
        fetchImpl: answer(200, { enrollment: 2 }),
      }),
    ).toBe(false)
    expect(await probeTrafficEnrollment('https://c.example', { fetchImpl: answer(404, {}) })).toBe(
      false,
    )
    const thrown = (async () => {
      throw new Error('down')
    }) as unknown as typeof fetch
    expect(await probeTrafficEnrollment('https://d.example', { fetchImpl: thrown })).toBe(false)
  })

  it('caches an answer for ten minutes and sends an automation user agent', async () => {
    const agents: string[] = []
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      agents.push(String((init.headers as Record<string, string>)['user-agent']))
      return new Response('{"enrollment":1}', { status: 200 })
    }) as unknown as typeof fetch
    await probeTrafficEnrollment('https://e.example', {
      fetchImpl,
      nowMs: 0,
      userAgent: 'x NardukAutomation/p',
    })
    await probeTrafficEnrollment('https://e.example', { fetchImpl, nowMs: 9 * 60_000 })
    await probeTrafficEnrollment('https://e.example', { fetchImpl, nowMs: 11 * 60_000 })
    expect(agents).toEqual([
      'x NardukAutomation/p',
      'narduk-analytics NardukAutomation/enrollment-probe',
    ])
  })
})
