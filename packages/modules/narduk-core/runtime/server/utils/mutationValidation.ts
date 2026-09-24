import { ZodError } from 'zod'

import { createValidationFailedError } from './validatedHandler'

function isHttpErrorLike(error: unknown): error is { statusCode: number } {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'statusCode' in error &&
    typeof (error as { statusCode: unknown }).statusCode === 'number',
  )
}

/**
 * Classify a caught error for mutation handlers. `http` means rethrow as-is;
 * `message` means the caller should `createError` with the given fields.
 *
 * A `ZodError` becomes the same 400 {@link createValidationFailedError} that
 * `defineValidatedHandler` answers with, so caller key names never land in
 * `statusMessage` (narduk-libs#371).
 */
export function describeValidationFailure(
  error: unknown,
):
  | { error: unknown; kind: 'http' }
  | { kind: 'message'; statusCode: number; statusMessage: string } {
  if (isHttpErrorLike(error)) {
    return { error, kind: 'http' as const }
  }

  if (error instanceof ZodError) {
    return {
      error: createValidationFailedError('body', error.issues),
      kind: 'http' as const,
    }
  }

  return {
    kind: 'message',
    statusCode: 400,
    statusMessage: 'Invalid request body',
  }
}
