import { createError, defineEventHandler, getRequestURL, getValidatedQuery, sendRedirect } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'
import { z } from 'zod'

import { exchangeSupabaseCode } from '#narduk-auth-server/utils/app-auth'
import {
  getAuthCallbackErrorMessage,
  logAuthCallbackFailure,
} from '#narduk-auth-server/utils/auth-callback'

import { sanitizeSameOriginPath } from '../../../../shared/utils/same-origin-path'

const emailVerificationTypeSchema = z.enum([
  'signup',
  'invite',
  'magiclink',
  'recovery',
  'email_change',
  'email',
])

const querySchema = z.union([
  z.object({
    code: z.string().min(1),
    next: z.string().optional(),
    returnPath: z.string().optional(),
  }),
  z.object({
    token_hash: z.string().min(1),
    type: emailVerificationTypeSchema,
    next: z.string().optional(),
    returnPath: z.string().optional(),
  }),
])

export default defineEventHandler(async (event) => {
  const query = await getValidatedQuery(event, (value) => querySchema.safeParse(value))
  if (!query.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid auth callback parameters.' })
  }

  const config = useRuntimeConfig(event) as unknown as {
    public: {
      authCallbackPath: string
      authRedirectPath: string
    }
  }
  const returnPath = sanitizeSameOriginPath(query.data.returnPath, config.public.authCallbackPath)

  try {
    const result =
      'code' in query.data
        ? await exchangeSupabaseCode(event, {
            code: query.data.code,
            next: query.data.next,
          })
        : await exchangeSupabaseCode(event, {
            tokenHash: query.data.token_hash,
            verificationType: query.data.type,
            next: query.data.next,
          })

    return sendRedirect(event, result.redirectTo ?? config.public.authRedirectPath, 302)
  } catch (error) {
    logAuthCallbackFailure(event, error, {
      next: query.data.next ?? null,
      returnPath,
    })

    const callbackUrl = new URL(returnPath, getRequestURL(event).origin)
    // Re-emit `next` only if it survives the same-origin guard: the failure
    // branch hands it to the callback page, so an unsanitized value would make
    // this endpoint a laundering step for a hostile redirect target.
    const safeNext = query.data.next ? sanitizeSameOriginPath(query.data.next, '') : ''
    if (safeNext) {
      callbackUrl.searchParams.set('next', safeNext)
    }
    callbackUrl.searchParams.set('error', 'callback_exchange_failed')
    callbackUrl.searchParams.set('error_description', getAuthCallbackErrorMessage(error))

    return sendRedirect(event, callbackUrl.toString(), 302)
  }
})
