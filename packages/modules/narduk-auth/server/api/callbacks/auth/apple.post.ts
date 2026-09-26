import { getRequestURL, sendRedirect } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'
import { z } from 'zod'

import {
  defineCallbackMutation,
  requireMutationBody,
  withValidatedBody,
} from '#layer/server/utils/mutation'
import { RATE_LIMIT_POLICIES } from '#layer/server/utils/rateLimit'
import { completeLocalAppleWebSignIn } from '#narduk-auth-server/lib/app-auth/apple-local'
import {
  getAuthCallbackErrorMessage,
  logAuthCallbackFailure,
} from '#narduk-auth-server/utils/auth-callback'
import { resolveAppleSignInForEvent } from '#narduk-auth-server/utils/auth-runtime-env'

/** The fields of Apple's form_post this route reads; anything else (`code`) is dropped. */
const appleFormSchema = z.object({
  error: z.string().max(200).optional(),
  id_token: z.string().max(8192).optional(),
  state: z.string().max(200).optional(),
  user: z.string().max(4096).optional(),
})

/** Apple flow refusals carry a code and a message written for the user; others stay generic. */
function appleErrorMessage(error: unknown): string {
  const data = (error as { data?: { code?: unknown } } | null)?.data
  const message = (error as { statusMessage?: unknown } | null)?.statusMessage
  return typeof data?.code === 'string' &&
    data.code.startsWith('apple_') &&
    typeof message === 'string'
    ? message
    : getAuthCallbackErrorMessage(error)
}

/**
 * POST /api/callbacks/auth/apple — Apple's `form_post` back to the local backend
 * (narduk-libs#164). It is a cross-site POST from appleid.apple.com, which can
 * carry no `X-Requested-With`, so it lives under `/api/callbacks/` (exempt from
 * narduk-core's header CSRF check). Its CSRF check is the single-use state
 * cookie bound at `/api/auth/apple/start`, and the identity token is verified
 * before anything is written. It always answers with a redirect: to `next` on
 * success, or to the auth callback page with an error.
 */
export default defineCallbackMutation(
  {
    rateLimit: RATE_LIMIT_POLICIES.authLogin,
    parseBody: withValidatedBody(appleFormSchema.parse),
  },
  async ({ event, body }) => {
    try {
      const result = await completeLocalAppleWebSignIn(
        event,
        resolveAppleSignInForEvent(event, 'local'),
        requireMutationBody(body),
      )
      // 303: the browser follows a POST's redirect with a GET.
      return sendRedirect(event, result.redirectTo, 303)
    } catch (error) {
      const config = useRuntimeConfig(event) as unknown as { public: { authCallbackPath: string } }
      logAuthCallbackFailure(event, error, {
        next: null,
        returnPath: config.public.authCallbackPath,
      })
      const callbackUrl = new URL(config.public.authCallbackPath, getRequestURL(event).origin)
      callbackUrl.searchParams.set('error', 'apple_sign_in_failed')
      callbackUrl.searchParams.set('error_description', appleErrorMessage(error))
      return sendRedirect(event, callbackUrl.toString(), 303)
    }
  },
)
