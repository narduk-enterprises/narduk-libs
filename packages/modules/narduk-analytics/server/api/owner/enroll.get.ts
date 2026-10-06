/**
 * Owner-browser enrollment hop (classification_version 1).
 *
 * GET /api/owner/enroll?t=<token>
 *   The operator portal's top-level redirect chain lands here once per estate
 *   origin. The token is an ES256 JWS the portal signed: ~2 minutes, single
 *   use, bound to this origin, carrying the owner class claim and the portal
 *   return URL. On success this sets (or, for the sign-out chain, clears) the
 *   first-party `__Host-narduk_traffic` cookie and redirects back to the
 *   portal with `outcome=ok`. On failure it still returns to the portal when
 *   the return URL is the portal's own, with `outcome=<reason>`, so one bad
 *   hop never strands the chain.
 *
 * GET /api/owner/enroll (no token)
 *   Capability probe: `{ "enrollment": 1 }`. The portal asks before it routes
 *   a browser here, so an app that has not adopted this version is skipped
 *   instead of answering the browser with a 404.
 *
 * The cookie carries a signed class claim and nothing else: no identity, no
 * email, no person id. No signing secret exists on this origin; it verifies
 * with the public keys in `server/utils/traffic/trafficClaim.ts`.
 */
import { sendRedirect } from 'h3'
import { z } from 'zod'

import { enforceRateLimitPolicy, RATE_LIMIT_POLICIES } from '#layer/server/utils/rateLimit'
import {
  applyTrafficClaimCookie,
  enrollmentReturnUrl,
  trafficRequestOrigin,
  unverifiedPortalReturn,
  verifyEnrollmentToken,
} from '#narduk-analytics-server/utils/traffic-enrollment'

/** A compact JWS is far shorter than this; the cap bounds what is parsed. */
const enrollQuery = z.object({ t: z.string().max(4096).optional() })

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  setResponseHeader(event, 'Referrer-Policy', 'no-referrer')

  const parsed = enrollQuery.safeParse(getQuery(event))
  const token = parsed.success ? parsed.data.t : undefined
  if (typeof token !== 'string' || !token) {
    return { enrollment: 1 }
  }

  await enforceRateLimitPolicy(event, RATE_LIMIT_POLICIES.ownerTag)

  const result = await verifyEnrollmentToken(token, { audience: trafficRequestOrigin(event) })
  if (result.ok) {
    applyTrafficClaimCookie(event, result.grant, !import.meta.dev)
    return sendRedirect(event, enrollmentReturnUrl(result.grant.returnTo, 'ok'), 302)
  }

  const fallback = unverifiedPortalReturn(token)
  if (fallback) return sendRedirect(event, enrollmentReturnUrl(fallback, result.reason), 302)
  throw createError({ statusCode: 400, message: `Enrollment refused: ${result.reason}.` })
})
