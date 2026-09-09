/**
 * The closed error vocabulary this package throws. Callers branch on `code`;
 * `message` is for logs and is never a stable contract.
 */
export type TenancyErrorCode =
  | 'not_found'
  | 'forbidden'
  | 'conflict'
  | 'invalid'
  | 'expired'
  | 'last_owner'

export class TenancyError extends Error {
  readonly code: TenancyErrorCode

  constructor(code: TenancyErrorCode, message: string) {
    super(message)
    this.name = 'TenancyError'
    this.code = code
  }
}

export function isTenancyError(value: unknown): value is TenancyError {
  return value instanceof TenancyError
}
