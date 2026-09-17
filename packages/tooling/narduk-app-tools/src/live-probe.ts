/**
 * The one HTTP layer app-tools uses to read a running deployment.
 *
 * Item 10 (`foundation:check:security-headers`) already probed a live origin
 * for response headers; `narduk-app verify --live` needs the same request plus
 * the response body. Rather than stand up a second fetch path -- with its own
 * timeout, redirect and user-agent behaviour, which would diverge -- both read
 * from here. `evaluate-security-headers.createFetchProbe` is now a thin wrapper
 * over `createLiveProbe`.
 *
 * Deliberate choices, carried over from the item 10 probe:
 *   - GET, never HEAD. A HEAD can be answered by a different handler than the
 *     GET a browser makes, and Nitro's render hooks -- where nuxt-security sets
 *     headers -- only run for a rendered response.
 *   - redirect: follow. `verify --live` reports `redirected` and the final URL
 *     so a caller can still tell that it happened.
 *   - A transport failure is returned as `{ error }`, not thrown: "we could not
 *     read it" is a verdict the callers render, not an exception they catch.
 */

export interface LiveResponse {
  /** The URL that was requested. */
  url: string
  /** The URL that finally answered, when redirects were followed. */
  finalUrl?: string
  redirected?: boolean
  status?: number
  /** Lowercased header names to values. Absent when the request failed. */
  headers?: Record<string, string>
  /** Present only when the request asked for the body. Truncated at `maxBodyBytes`. */
  body?: string
  /** True when the body was cut short at `maxBodyBytes`. */
  bodyTruncated?: boolean
  /** Present when the request could not be completed at all. */
  error?: string
}

export interface LiveProbeOptions {
  /** Read and return the response body. Off by default: a header probe should not pay for it. */
  readBody?: boolean
  /** Hard ceiling on a returned body, so a large page cannot exhaust the process. */
  maxBodyBytes?: number
  timeoutMs?: number
  userAgent?: string
}

export type LiveProbe = (url: string, options?: LiveProbeOptions) => Promise<LiveResponse>

export const DEFAULT_LIVE_TIMEOUT_MS = 15_000
export const DEFAULT_MAX_BODY_BYTES = 1_048_576
export const DEFAULT_LIVE_USER_AGENT = 'narduk-app-tools/live-probe'

/** Build a probe bound to these defaults; per-call options still win. */
export function createLiveProbe(defaults: LiveProbeOptions = {}): LiveProbe {
  return async (url, options = {}) => {
    const timeoutMs = options.timeoutMs ?? defaults.timeoutMs ?? DEFAULT_LIVE_TIMEOUT_MS
    const maxBodyBytes = options.maxBodyBytes ?? defaults.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES
    const readBody = options.readBody ?? defaults.readBody ?? false
    const userAgent = options.userAgent ?? defaults.userAgent ?? DEFAULT_LIVE_USER_AGENT
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        headers: { 'user-agent': userAgent },
        signal: controller.signal,
      })
      const headers: Record<string, string> = {}
      response.headers.forEach((value, name) => {
        headers[name.toLowerCase()] = value
      })
      const buffer = await response.arrayBuffer().catch(() => new ArrayBuffer(0))
      const result: LiveResponse = { url, status: response.status, headers }
      if (response.url && response.url !== url) {
        result.finalUrl = response.url
        result.redirected = true
      }
      if (readBody) {
        const bytes = new Uint8Array(buffer)
        const truncated = bytes.byteLength > maxBodyBytes
        result.body = new TextDecoder().decode(truncated ? bytes.slice(0, maxBodyBytes) : bytes)
        if (truncated) result.bodyTruncated = true
      }
      return result
    } catch (error) {
      return { url, error: error instanceof Error ? error.message : String(error) }
    } finally {
      clearTimeout(timer)
    }
  }
}
