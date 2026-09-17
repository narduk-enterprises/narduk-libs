/**
 * The closed error vocabulary this package throws. Callers branch on `code`;
 * `message` is for logs and is never a stable contract.
 */
export const TENANCY_ERROR_CODES = [
  'not_found',
  'forbidden',
  'conflict',
  'invalid',
  'expired',
  'last_owner',
] as const

export type TenancyErrorCode = (typeof TENANCY_ERROR_CODES)[number]

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

function constraintMessage(cause: unknown): string {
  const parts: string[] = []
  const walk = (value: unknown, depth: number): void => {
    if (value == null || depth > 6) return
    if (typeof value === 'string') {
      parts.push(value)
      return
    }
    if (typeof value !== 'object') return
    if (value instanceof Error) {
      parts.push(value.message)
      walk(value.cause, depth + 1)
    }
  }
  walk(cause, 0)
  return parts.join('\n')
}

const UNIQUE_SLUG = /UNIQUE constraint failed:\s*tenancy_orgs\.slug/iu
const UNIQUE_MEMBERSHIP =
  /UNIQUE constraint failed:\s*tenancy_memberships\.org_id\s*,\s*tenancy_memberships\.user_id/iu

/** Unique-index races the pre-read cannot see. Callers map these to `conflict`. */
export function isTenancyUniqueConstraint(
  cause: unknown,
  kind: 'org-slug' | 'membership',
): boolean {
  const message = constraintMessage(cause)
  return kind === 'org-slug' ? UNIQUE_SLUG.test(message) : UNIQUE_MEMBERSHIP.test(message)
}
