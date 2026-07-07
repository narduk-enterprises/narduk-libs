/* eslint-disable no-console -- debug-only fetch cancellation logs, same contract as urlValidator */
/**
 * Small helpers for Response stream lifecycle and content-type gating, shared by
 * `urlValidator` (SSRF-safe fetch) without pulling in the full orchestrator.
 */

/**
 * Cancel a Response body we are not going to read.
 */
export async function drainUnusedResponse(response: Response, debug: boolean): Promise<void> {
  try {
    await response.body?.cancel()
  } catch (cancelError: unknown) {
    if (debug) {
      console.log(
        '[fetchWithValidatedRedirects] Failed to cancel unused Response body:',
        cancelError instanceof Error ? cancelError.message : String(cancelError),
      )
    }
  }
}

export async function bestEffortCancelReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  debug: boolean,
): Promise<void> {
  try {
    await reader.cancel()
  } catch (err: unknown) {
    if (debug) {
      console.log(
        '[fetchWithValidatedRedirects] Failed to cancel response reader:',
        err instanceof Error ? err.message : String(err),
      )
    }
  }
}

/**
 * True only for Content-Types we know cannot carry parseable HTML.
 */
export function isKnownNonHtmlContentType(contentType: string | null | undefined): boolean {
  if (contentType == null) return false
  const ct = contentType.trim()
  if (!ct) return false
  return (
    ct.includes('application/json') ||
    ct.includes('image/') ||
    ct.includes('application/octet-stream') ||
    (ct.includes('text/plain') && !ct.includes('html')) ||
    ct.startsWith('audio/') ||
    ct.startsWith('video/') ||
    ct.startsWith('font/') ||
    ct.startsWith('application/pdf')
  )
}
