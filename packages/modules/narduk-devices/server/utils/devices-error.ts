/**
 * The closed error vocabulary this package throws. Callers branch on `code`;
 * `message` is for logs and is never a stable contract. Claim outcomes are
 * returned as statuses, not thrown: a `DevicesError` means the call itself
 * could not be honoured.
 */
export const DEVICES_ERROR_CODES = [
  'not_found',
  'forbidden',
  'conflict',
  'invalid',
  'expired',
  'revoked',
  'unauthorized',
  'rate_limited',
] as const

export type DevicesErrorCode = (typeof DEVICES_ERROR_CODES)[number]

export class DevicesError extends Error {
  readonly code: DevicesErrorCode
  /** Populated for `rate_limited`; seconds until the subject may retry. */
  readonly retryAfterSeconds: number | undefined

  constructor(
    code: DevicesErrorCode,
    message: string,
    options: { retryAfterSeconds?: number } = {},
  ) {
    super(message)
    this.name = 'DevicesError'
    this.code = code
    this.retryAfterSeconds = options.retryAfterSeconds
  }
}

export function isDevicesError(value: unknown): value is DevicesError {
  return value instanceof DevicesError
}
