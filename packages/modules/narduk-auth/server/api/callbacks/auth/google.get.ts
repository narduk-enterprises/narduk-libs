import { defineEventHandler, getQuery, getRequestURL, sendRedirect } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'
import { z } from 'zod'

import { enforceRateLimitPolicy, RATE_LIMIT_POLICIES } from '#layer/server/utils/rateLimit'
import { completeLocalGoogleWebSignIn } from '#narduk-auth-server/lib/app-auth/google-local'
import {
  getAuthCallbackErrorMessage,
  logAuthCallbackFailure,
} from '#narduk-auth-server/utils/auth-callback'
import { resolveGoogleSignInForEvent } from '#narduk-auth-server/utils/auth-runtime-env'

/** The fields of Google's redirect this route reads; anything else (`scope`, `authuser`) is dropped. */
const googleQuerySchema = z.object({
  code: z.string().max(2048).optional(),
  error: z.string().max(200).optional(),
  state: z.string().max(200).optional(),
})

/** Google flow refusals carry a code and a message written for the user; others stay generic. */
function googleErrorMessage(error: unknown): string {
  const data = (error as { data?: { code?: unknown } } | null)?.data
  const message = (error as { statusMessage?: unknown } | null)?.statusMessage
  return typeof data?.code === 'string' &&
    data.code.startsWith('google_') &&
    typeof message === 'string'
    ? message
    : getAuthCallbackErrorMessage(error)
}

/**
 * GET /api/callbacks/auth/google — Google's redirect back to the local backend
 * (narduk-libs#1951). Its CSRF check is the single-use state cookie bound at
 * `/api/auth/google/start`; the code is redeemed with the PKCE verifier from
 * that cookie and the ID token is verified before anything is written. It
 * always answers with a redirect: to `next` on success, or to the auth callback
 * page with an error.
 */
export default defineEventHandler(async (event) => {
  await enforceRateLimitPolicy(event, RATE_LIMIT_POLICIES.authLogin)
  try {
    const query = googleQuerySchema.parse(getQuery(event))
    const result = await completeLocalGoogleWebSignIn(
      event,
      resolveGoogleSignInForEvent(event, 'local'),
      query,
    )
    return sendRedirect(event, result.redirectTo, 302)
  } catch (error) {
    const config = useRuntimeConfig(event) as unknown as { public: { authCallbackPath: string } }
    logAuthCallbackFailure(event, error, {
      next: null,
      returnPath: config.public.authCallbackPath,
    })
    const callbackUrl = new URL(config.public.authCallbackPath, getRequestURL(event).origin)
    callbackUrl.searchParams.set('error', 'google_sign_in_failed')
    callbackUrl.searchParams.set('error_description', googleErrorMessage(error))
    return sendRedirect(event, callbackUrl.toString(), 302)
  }
})
