import { ZodError } from 'zod'

function isHttpErrorLike(error: unknown): error is { statusCode: number } {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'statusCode' in error &&
    typeof (error as { statusCode: unknown }).statusCode === 'number',
  )
}

function formatValidationError(error: ZodError): string {
  return error.issues.map((issue) => issue.message).join(', ') || 'Invalid request body'
}

/**
 * Classify a caught error for mutation handlers. `http` means rethrow as-is;
 * `message` means the caller should `createError` with the given fields.
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
      kind: 'message',
      statusCode: 400,
      statusMessage: `Validation error: ${formatValidationError(error)}`,
    }
  }

  return {
    kind: 'message',
    statusCode: 400,
    statusMessage: 'Invalid request body',
  }
}
