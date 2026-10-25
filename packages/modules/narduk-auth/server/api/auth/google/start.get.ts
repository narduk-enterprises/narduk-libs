import { createError, defineEventHandler, getValidatedQuery, sendRedirect } from 'h3'
import { z } from 'zod'

import { enforceRateLimitPolicy, RATE_LIMIT_POLICIES } from '#layer/server/utils/rateLimit'
import { startLocalGoogleWebSignIn } from '#narduk-auth-server/lib/app-auth/google-local'
import { resolveGoogleSignInForEvent } from '#narduk-auth-server/utils/auth-runtime-env'

const querySchema = z.object({ next: z.string().max(2048).optional() })

/**
 * GET /api/auth/google/start — local-backend Google sign-in (narduk-libs#1951).
 * Binds a state, nonce and PKCE verifier to this browser, then redirects to
 * Google. 501 when the app has no Google OAuth client or does not advertise
 * `google`.
 */
export default defineEventHandler(async (event) => {
  await enforceRateLimitPolicy(event, RATE_LIMIT_POLICIES.authLogin)
  const query = await getValidatedQuery(event, (value) => querySchema.safeParse(value))
  if (!query.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid Google sign-in parameters.' })
  }
  const url = await startLocalGoogleWebSignIn(
    event,
    resolveGoogleSignInForEvent(event, 'local'),
    query.data.next ?? null,
  )
  return sendRedirect(event, url, 302)
})
