/**
 * Every failure this package raises is a `NardukPostgresError` carrying a
 * stable `code`. Callers branch on the code, never on the message text, and no
 * message ever carries a connection string, a password or a query parameter --
 * `redactConnectionString` is applied before a DSN reaches a message or a
 * `details` field, and a driver `cause` is replaced with a redacted copy
 * before it is attached (postgres.js / `pg` embed the DSN in `cause.message`).
 */

import { redactErrorCause, redactSecrets, rememberUnredactedCause } from './redact.js'

export const POSTGRES_ERROR_CODES = [
  'CONNECTION_STRING_MISSING',
  'CONNECTION_LIMIT_EXCEEDED',
  'HYPERDRIVE_BINDING_INVALID',
  'MIGRATION_DUPLICATE',
  'MIGRATION_LOCK_TIMEOUT',
  'MIGRATION_MISSING',
  'MIGRATION_MODIFIED',
  'MIGRATION_NAME_INVALID',
  'MIGRATION_OUT_OF_ORDER',
  'MIGRATION_STATEMENT_UNTERMINATED',
  'MIGRATION_TABLE_INVALID',
  'MIGRATION_TRANSACTION_FORBIDDEN',
  'MIGRATION_UNLOCK_FAILED',
  'PARAMETER_BUDGET_EXCEEDED',
  'PARAMETER_BUDGET_INVALID',
  'PROTOCOL_VIOLATION',
  'ROLE_UNKNOWN',
  'TUNING_INVALID',
] as const

export type PostgresErrorCode = (typeof POSTGRES_ERROR_CODES)[number]

export class NardukPostgresError extends Error {
  readonly code: PostgresErrorCode
  readonly details: Readonly<Record<string, unknown>>

  constructor(
    code: PostgresErrorCode,
    message: string,
    details: Record<string, unknown> = {},
    options?: { cause?: unknown },
  ) {
    const originalCause = options?.cause
    super(`${code}: ${redactSecrets(message)}`, {
      cause: originalCause === undefined ? undefined : redactErrorCause(originalCause),
    })
    this.name = 'NardukPostgresError'
    this.code = code
    this.details = Object.freeze({ ...details })
    if (originalCause !== undefined) rememberUnredactedCause(this, originalCause)
  }
}

export function isNardukPostgresError(value: unknown): value is NardukPostgresError {
  return value instanceof NardukPostgresError
}
