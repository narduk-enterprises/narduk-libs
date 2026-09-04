import { readAppCookie, readAppRequestHeader } from '@narduk-enterprises/narduk-app/server/http'

import { useLogger } from '#layer/server/utils/logger'

import type { H3Event } from 'h3'

const PKCE_COOKIE_NAME = 'app_auth_pkce'
const DEFAULT_AUTH_CALLBACK_ERROR_MESSAGE =
  'The auth callback could not be exchanged for a session.'

function getAuthCallbackLogMessage(error: unknown) {
  if (!error || typeof error !== 'object') {
    return DEFAULT_AUTH_CALLBACK_ERROR_MESSAGE
  }

  const maybeError = error as {
    data?: { message?: string; statusMessage?: string }
    message?: string
    statusMessage?: string
  }

  return (
    maybeError.statusMessage ??
    maybeError.message ??
    maybeError.data?.statusMessage ??
    maybeError.data?.message ??
    DEFAULT_AUTH_CALLBACK_ERROR_MESSAGE
  )
}

export function getAuthCallbackErrorMessage(_error?: unknown) {
  return DEFAULT_AUTH_CALLBACK_ERROR_MESSAGE
}

export function logAuthCallbackFailure(
  event: H3Event,
  error: unknown,
  context: {
    next?: string | null
    returnPath?: string | null
  } = {},
) {
  const log = useLogger(event).child('AuthCallback')
  const statusCode =
    typeof error === 'object' &&
    error !== null &&
    'statusCode' in error &&
    typeof error.statusCode === 'number'
      ? error.statusCode
      : null

  log.error('Auth callback exchange failed', {
    requestHost: readAppRequestHeader(event, 'host') ?? null,
    next: context.next ?? null,
    returnPath: context.returnPath ?? null,
    hasPkceCookie: Boolean(readAppCookie(event, PKCE_COOKIE_NAME)),
    statusCode,
    statusMessage: getAuthCallbackLogMessage(error),
  })
}
