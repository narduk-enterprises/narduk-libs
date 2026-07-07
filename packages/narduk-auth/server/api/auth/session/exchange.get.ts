import { createError, defineEventHandler, getRequestURL, getValidatedQuery, sendRedirect } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'
import { z } from 'zod'

import { exchangeSupabaseCode } from '#narduk-auth-server/utils/app-auth'
import {
  getAuthCallbackErrorMessage,
  logAuthCallbackFailure,
} from '#narduk-auth-server/utils/auth-callback'

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

function sanitizeReturnPath(value: string | undefined, fallback: string) {
  if (!value) return fallback

  try {
    const url = new URL(value, 'https://app.local')
    if (url.origin !== 'https://app.local' || !url.pathname.startsWith('/')) {
      return fallback
    }

    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return fallback
  }
}

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
  const returnPath = sanitizeReturnPath(query.data.returnPath, config.public.authCallbackPath)

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
    if (query.data.next) {
      callbackUrl.searchParams.set('next', query.data.next)
    }
    callbackUrl.searchParams.set('error', 'callback_exchange_failed')
    callbackUrl.searchParams.set('error_description', getAuthCallbackErrorMessage(error))

    return sendRedirect(event, callbackUrl.toString(), 302)
  }
})
