import { createError } from 'h3'

import { isTenancyError, type TenancyError, type TenancyErrorCode } from './tenancy-error'

/**
 * The HTTP status for each `TenancyError` code.
 *
 * `expired` is 410 and `last_owner` is 409: both requests were well-formed and
 * permitted, and retrying either unchanged fails the same way, which is what
 * those statuses tell a client. `invalid` is the only 400.
 */
export const TENANCY_HTTP_STATUS: Readonly<Record<TenancyErrorCode, number>> = Object.freeze({
  not_found: 404,
  forbidden: 403,
  conflict: 409,
  invalid: 400,
  expired: 410,
  last_owner: 409,
})

/**
 * A safe sentence per code, used when the call site names none.
 *
 * `TenancyError.message` is log text, never a response: it embeds raw org and
 * user ids (`Org <uuid> must keep at least one owner.`). Nothing here ever
 * forwards it.
 */
export const TENANCY_DEFAULT_MESSAGES: Readonly<Record<TenancyErrorCode, string>> = Object.freeze({
  not_found: 'That no longer exists. Reload the page and try again.',
  forbidden: 'You are not allowed to do that.',
  conflict: 'Something changed while you were working. Reload the page and try again.',
  invalid: 'That request was not valid.',
  expired: 'That has expired.',
  last_owner:
    'An organization must keep at least one owner. Make somebody else an owner first, then try again.',
})

const REASON_PHRASES: Readonly<Record<number, string>> = Object.freeze({
  400: 'Bad Request',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  410: 'Gone',
})

export interface TenancyHttpOptions {
  /**
   * Codes answered as `not_found`, so a caller cannot tell "exists but not
   * yours" from "does not exist" (e.g. `['forbidden', 'invalid', 'expired']`).
   * They get the `not_found` status and message.
   */
  hideAsNotFound?: readonly TenancyErrorCode[]
  /** Per-call sentences, by the code that is answered (after `hideAsNotFound`). */
  messages?: Partial<Record<TenancyErrorCode, string>>
  /**
   * Builds the thrown error, for an app with its own envelope. The default is
   * `createError({ statusCode, statusMessage: <reason phrase>, message, data: { errorCode: code, message } })`.
   */
  toError?: (status: number, code: TenancyErrorCode, message: string) => Error
}

function defaultToError(status: number, code: TenancyErrorCode, message: string): Error {
  return createError({
    statusCode: status,
    statusMessage: REASON_PHRASES[status] ?? 'Error',
    message,
    data: { errorCode: code, message },
  })
}

/**
 * The HTTP error for a `TenancyError`: the status from `TENANCY_HTTP_STATUS`
 * and a safe sentence, never `error.message`.
 */
export function toTenancyHttpError(error: TenancyError, options: TenancyHttpOptions = {}): Error {
  const code: TenancyErrorCode = options.hideAsNotFound?.includes(error.code)
    ? 'not_found'
    : error.code
  const message = options.messages?.[code] ?? TENANCY_DEFAULT_MESSAGES[code]
  const status = TENANCY_HTTP_STATUS[code]
  return (options.toError ?? defaultToError)(status, code, message)
}

/**
 * Runs a tenancy call and rethrows a `TenancyError` as its HTTP error. Any
 * other error passes through unchanged.
 */
export async function withTenancyErrors<T>(
  operation: () => Promise<T>,
  options: TenancyHttpOptions = {},
): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (isTenancyError(error)) throw toTenancyHttpError(error, options)
    throw error
  }
}
