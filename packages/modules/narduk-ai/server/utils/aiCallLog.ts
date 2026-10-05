/**
 * Provider-call records for the xAI / chat-completion clients.
 *
 * The clients take no H3 event, so the caller injects a logger: narduk-core's
 * `useLogger(event).child('AI')` and a narduk-logging `Logger` both fit. With
 * no logger nothing is written; this module never configures logging itself.
 *
 * Records carry only the provider host, the operation, the model, status,
 * timing, attempt count and token usage. Never the API key, the messages, the
 * model output or the provider's error text, which can echo the prompt.
 */
export interface AiCallLogger {
  error: (message: string, data?: Record<string, unknown>) => void
  info: (message: string, data?: Record<string, unknown>) => void
  warn: (message: string, data?: Record<string, unknown>) => void
}

export type AiCallFailureReason =
  'aborted' | 'http_status' | 'invalid_response' | 'network' | 'timeout'

export interface AiCallFields {
  /** Absent for calls that name no model, such as listing models. */
  model?: string
  operation: string
  provider: string
}

/** The host alone: a base URL from configuration may carry a path or query. */
export function aiProviderHost(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return 'unknown'
  }
}

export function statusCodeOf(error: unknown): number | undefined {
  if (error && typeof error === 'object' && 'statusCode' in error) {
    const status = (error as { statusCode?: unknown }).statusCode
    if (typeof status === 'number') return status
  }
  return undefined
}

export function logAiCallFailure(
  logger: AiCallLogger | undefined,
  fields: AiCallFields,
  failure: {
    attempts?: number
    durationMs: number
    reason: AiCallFailureReason
    statusCode?: number
  },
): void {
  if (!logger) return
  const record = {
    ...fields,
    ...failure,
  }
  if (failure.reason === 'aborted') logger.warn('AI provider call aborted', record)
  else logger.error('AI provider call failed', record)
}
