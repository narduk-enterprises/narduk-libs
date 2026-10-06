import { deleteCookie, getCookie, getRequestHeader, getRequestURL, setCookie } from 'h3'

import {
  normalizeOrigin,
  parseJws,
  TRAFFIC_CLAIM_COOKIE,
  TRAFFIC_CLAIM_DEV_COOKIE,
  TRAFFIC_CLASS_TYP,
  TRAFFIC_ENROLL_TYP,
  TRAFFIC_ENROLLMENT_ISSUERS,
  verifyOwnerClassClaim,
  verifyTrafficToken,
} from '#narduk-analytics-server/utils/traffic/trafficClaim'
import {
  hasUnsignedOwnerFlag,
  parseAutomationMarker,
  resolveTrafficProperties,
} from '#narduk-analytics-server/utils/traffic/trafficClass'

import type {
  ClaimFailure,
  TrafficPublicJwk,
} from '#narduk-analytics-server/utils/traffic/trafficClaim'
import type { TrafficProperties } from '#narduk-analytics-server/utils/traffic/trafficClass'
import type { H3Event } from 'h3'

/**
 * Enrollment: the server half of "portal login enrolls the browser".
 *
 * The operator portal sends a signed-in browser through a top-level redirect
 * chain, one hop per estate origin, each carrying a ~2-minute single-use token
 * bound to that origin. `/api/owner/enroll` verifies it here, then sets (or,
 * for a sign-out chain, clears) the first-party class-claim cookie and
 * redirects to the signed return URL. Top-level navigation makes the cookie
 * first-party, so it works in Safari: no iframe, no third-party cookie, no
 * fingerprint.
 */

export type EnrollmentAction = 'clear' | 'enroll'
export type EnrollmentFailure = ClaimFailure | 'bad_return' | 'replayed'

export interface EnrollmentGrant {
  action: EnrollmentAction
  /** The class claim to store; present for `enroll` only. */
  claim?: string
  /** Seconds until the claim expires (cookie Max-Age). */
  claimMaxAge?: number
  returnTo: string
}

/** Remembers token ids until they expire. `markUsed` is false when already seen. */
export interface ReplayGuard {
  markUsed(jti: string, expiresAtSec: number, nowSec: number): Promise<boolean>
}

const MAX_TOKEN_LIFETIME_SECONDS = 5 * 60

/**
 * The default replay guard: this isolate's memory, then the Workers Cache API
 * for the colo when it exists. Single use is therefore exact within a colo and
 * best effort across colos; the token's two-minute life, origin binding and
 * top-level delivery bound the rest, and the most a replay can win is the
 * `owner` analytics label on the replayer's own browser.
 */
export function createTrafficReplayGuard(): ReplayGuard {
  const seen = new Map<string, number>()
  return {
    async markUsed(jti, expiresAtSec, nowSec) {
      for (const [key, exp] of seen) if (exp <= nowSec) seen.delete(key)
      if (seen.has(jti)) return false
      seen.set(jti, expiresAtSec)

      const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default
      if (!cache) return true
      const key = new Request(`https://narduk-traffic-replay.invalid/${encodeURIComponent(jti)}`)
      try {
        if (await cache.match(key)) return false
        const ttl = Math.max(1, expiresAtSec - nowSec)
        await cache.put(key, new Response('1', { headers: { 'Cache-Control': `max-age=${ttl}` } }))
      } catch {
        // The in-memory guard above already ran; a cache outage does not
        // block enrollment.
      }
      return true
    },
  }
}

const defaultReplayGuard = createTrafficReplayGuard()

export interface VerifyEnrollmentOptions {
  audience: string
  keys?: Readonly<Record<string, TrafficPublicJwk>>
  nowMs?: number
  replay?: ReplayGuard
}

/** Return URLs may only lead back to the issuing portal. */
function trustedReturn(value: unknown): string | null {
  if (typeof value !== 'string') return null
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== 'https:') return null
  const origin = normalizeOrigin(url.href)
  return (TRAFFIC_ENROLLMENT_ISSUERS as readonly string[]).includes(origin) ? url.href : null
}

/**
 * Verify an enrollment token: signature, type, origin binding, lifetime, a
 * trusted return URL, then single use. The replay check runs last so a token
 * that fails any other check is not burned.
 */
export async function verifyEnrollmentToken(
  token: string,
  options: VerifyEnrollmentOptions,
): Promise<{ grant: EnrollmentGrant; ok: true } | { ok: false; reason: EnrollmentFailure }> {
  const nowMs = options.nowMs ?? Date.now()
  const nowSec = Math.floor(nowMs / 1000)
  const verified = await verifyTrafficToken(token, {
    audience: options.audience,
    typ: TRAFFIC_ENROLL_TYP,
    keys: options.keys,
    nowMs,
  })
  if (!verified.ok) return verified

  const { payload } = verified
  const action = payload.act
  const jti = payload.jti
  const exp = payload.exp as number
  const iat = payload.iat as number
  if (action !== 'enroll' && action !== 'clear') return { ok: false, reason: 'malformed' }
  if (typeof jti !== 'string' || !/^[\w-]{16,128}$/u.test(jti)) {
    return { ok: false, reason: 'malformed' }
  }
  if (exp - iat > MAX_TOKEN_LIFETIME_SECONDS) return { ok: false, reason: 'malformed' }

  const returnTo = trustedReturn(payload.ret)
  if (!returnTo) return { ok: false, reason: 'bad_return' }

  let claim: string | undefined
  let claimMaxAge: number | undefined
  if (action === 'enroll') {
    if (typeof payload.claim !== 'string') return { ok: false, reason: 'malformed' }
    const claimResult = await verifyTrafficToken(payload.claim, {
      audience: options.audience,
      typ: TRAFFIC_CLASS_TYP,
      keys: options.keys,
      nowMs,
    })
    if (!claimResult.ok) return claimResult
    if (claimResult.payload.cls !== 'owner') return { ok: false, reason: 'malformed' }
    claim = payload.claim
    claimMaxAge = (claimResult.payload.exp as number) - nowSec
  }

  const replay = options.replay ?? defaultReplayGuard
  if (!(await replay.markUsed(jti, exp, nowSec))) return { ok: false, reason: 'replayed' }

  return { ok: true, grant: { action, claim, claimMaxAge, returnTo } }
}

/**
 * Best-effort return for a failed hop, read from an UNVERIFIED token: only
 * ever the portal's own origin, so it can never become an open redirect.
 */
export function unverifiedPortalReturn(token: string): string | null {
  return trustedReturn(parseJws(token)?.payload.ret)
}

/** This request's own origin, as the browser addressed it. */
export function trafficRequestOrigin(event: H3Event): string {
  return normalizeOrigin(getRequestURL(event).href)
}

export function trafficClaimCookieName(secure: boolean): string {
  return secure ? TRAFFIC_CLAIM_COOKIE : TRAFFIC_CLAIM_DEV_COOKIE
}

/**
 * Client-readable on purpose: the analytics plugin verifies it in the browser
 * at init, with the public key, before the first capture. It is a signature,
 * not a secret, and carries no identity.
 */
export function applyTrafficClaimCookie(
  event: H3Event,
  grant: EnrollmentGrant,
  secure: boolean,
): void {
  const name = trafficClaimCookieName(secure)
  if (grant.action === 'clear' || !grant.claim) {
    deleteCookie(event, name, { path: '/', ...(secure ? { secure: true } : {}) })
    return
  }
  setCookie(event, name, grant.claim, {
    httpOnly: false,
    maxAge: Math.max(0, grant.claimMaxAge ?? 0),
    path: '/',
    sameSite: 'lax',
    secure,
  })
}

/** Append the outcome so the portal can show which origins enrolled. */
export function enrollmentReturnUrl(returnTo: string, outcome: 'ok' | EnrollmentFailure): string {
  const url = new URL(returnTo)
  url.searchParams.set('outcome', outcome)
  return url.href
}

/**
 * Traffic properties for a server-side event, from this request alone: the
 * user agent's automation marker and the verified class-claim cookie. For
 * server captures such as a document-served event, so they classify the same
 * way the browser does.
 */
export async function resolveServerTrafficProperties(
  event: H3Event,
  options: { keys?: Readonly<Record<string, TrafficPublicJwk>>; nowMs?: number } = {},
): Promise<TrafficProperties> {
  const automationTool = parseAutomationMarker(getRequestHeader(event, 'user-agent'))
  if (automationTool) return resolveTrafficProperties({ automationTool })
  const claim = getCookie(event, TRAFFIC_CLAIM_COOKIE) ?? getCookie(event, TRAFFIC_CLAIM_DEV_COOKIE)
  const signedOwner = await verifyOwnerClassClaim(claim, trafficRequestOrigin(event), options)
  return resolveTrafficProperties({
    signedOwner,
    unsignedOwner: hasUnsignedOwnerFlag(getRequestHeader(event, 'cookie')),
  })
}
