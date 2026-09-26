import { createError, defineEventHandler, getValidatedQuery, sendRedirect } from 'h3'
import { z } from 'zod'

import { enforceRateLimitPolicy, RATE_LIMIT_POLICIES } from '#layer/server/utils/rateLimit'
import { startLocalAppleWebSignIn } from '#narduk-auth-server/lib/app-auth/apple-local'
import { resolveAppleSignInForEvent } from '#narduk-auth-server/utils/auth-runtime-env'

const querySchema = z.object({ next: z.string().max(2048).optional() })

/**
 * GET /api/auth/apple/start — local-backend Sign in with Apple (narduk-libs#164).
 * Binds a state and nonce to this browser, then redirects to Apple. 501 when the
 * app has no `AUTH_APPLE_SERVICES_ID` or does not advertise `apple`.
 */
export default defineEventHandler(async (event) => {
  await enforceRateLimitPolicy(event, RATE_LIMIT_POLICIES.authLogin)
  const query = await getValidatedQuery(event, (value) => querySchema.safeParse(value))
  if (!query.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid Apple sign-in parameters.' })
  }
  const url = await startLocalAppleWebSignIn(
    event,
    resolveAppleSignInForEvent(event, 'local'),
    query.data.next ?? null,
  )
  return sendRedirect(event, url, 302)
})
