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
 *   - redirect: follow. `verify --live` reports `redirected` and the final URL,
 *     and refuses the proof when the final origin is not the one it was asked
 *     about. With caller-supplied headers, follow only same-origin redirects:
 *     native fetch can forward custom credentials such as Access tokens.
 *   - A transport failure is returned as `{ error }`, not thrown: "we could not
 *     read it" is a verdict the callers render, not an exception they catch.
 *
 * WHY EVERY REQUEST IS NO-CACHE
 * -----------------------------
 * Both callers are asserting something about the process that is running right
 * now: which build is serving, what headers it sets. Design §6.5 tells apps to
 * turn Cloudflare's cache on, so an uncontrolled GET of `/` can be answered
 * from cache by the *previous* release for the whole proof window -- the live
 * proof then fails on a good release and, under the standard, auto-rolls it
 * back. `cache: 'no-store'` plus the two request headers is the client half of
 * that; `verify --live` adds a per-run query parameter as the server half,
 * because a cache key is built from the URL and an intermediary is free to
 * ignore a request header.
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
  /**
   * The transport's error code when there was one, e.g. `ENOTFOUND`. Native
   * fetch reports every transport failure as `fetch failed` and puts the
   * system error on `cause`; this is that code, so a caller can tell a name
   * that did not resolve from a refused connection (narduk-libs#783).
   */
  errorCode?: string
}

export interface LiveProbeOptions {
  /** Read and return the response body. Off by default: a header probe should not pay for it. */
  readBody?: boolean
  /** Hard ceiling on a returned body, so a large page cannot exhaust the process. */
  maxBodyBytes?: number
  timeoutMs?: number
  userAgent?: string
  /**
   * Ask every hop not to answer from cache. On by default: both callers assert
   * something about the running deployment, and a cached answer is a different
   * deployment's answer.
   */
  noCache?: boolean
  /**
   * Extra request headers, e.g. a Cloudflare Access service token. Sent as
   * given and never echoed into a LiveResponse or a report. Redirects cannot
   * carry these headers beyond the originally requested origin.
   */
  headers?: Record<string, string>
  /**
   * Native fetch redirect mode. Default `follow` (or same-origin manual hops
   * when caller headers are present). `manual` returns the first 3xx so a
   * caller can assert hop status and Location.
   */
  redirect?: 'follow' | 'manual'
}

export type LiveProbe = (url: string, options?: LiveProbeOptions) => Promise<LiveResponse>

/** The slice of `fetch` the probe calls; injectable so a caller can choose how it connects. */
export type FetchTransport = (url: string, init?: RequestInit) => Promise<Response>

/** The first string `code` on an error or its `cause` chain (native fetch nests it). */
export function transportErrorCode(error: unknown): string | undefined {
  let current: unknown = error
  for (let depth = 0; depth < 4 && current !== null && typeof current === 'object'; depth += 1) {
    const { code, cause } = current as { code?: unknown; cause?: unknown }
    if (typeof code === 'string') return code
    current = cause
  }
  return undefined
}

export const DEFAULT_LIVE_TIMEOUT_MS = 15_000
export const DEFAULT_MAX_BODY_BYTES = 1_048_576
export const DEFAULT_LIVE_USER_AGENT = 'narduk-app-tools/live-probe'

/**
 * Build a probe bound to these defaults; per-call options still win. `transport`
 * defaults to the global fetch, read at call time.
 */
export function createLiveProbe(
  defaults: LiveProbeOptions = {},
  transport?: FetchTransport,
): LiveProbe {
  const send: FetchTransport = (target, init) =>
    transport ? transport(target, init) : fetch(target, init)
  return async (url, options = {}) => {
    const timeoutMs = options.timeoutMs ?? defaults.timeoutMs ?? DEFAULT_LIVE_TIMEOUT_MS
    const maxBodyBytes = options.maxBodyBytes ?? defaults.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES
    const readBody = options.readBody ?? defaults.readBody ?? false
    const userAgent = options.userAgent ?? defaults.userAgent ?? DEFAULT_LIVE_USER_AGENT
    const noCache = options.noCache ?? defaults.noCache ?? true
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const headersSent: Record<string, string> = { 'user-agent': userAgent }
    if (noCache) {
      headersSent['cache-control'] = 'no-cache, no-store, max-age=0'
      headersSent.pragma = 'no-cache'
    }
    Object.assign(headersSent, defaults.headers, options.headers)
    try {
      const originBound = Object.keys({ ...defaults.headers, ...options.headers }).length > 0
      const redirectMode = options.redirect ?? defaults.redirect ?? 'follow'
      const stayOnFirstHop = redirectMode === 'manual'
      const request: RequestInit = {
        method: 'GET',
        redirect: stayOnFirstHop || originBound ? 'manual' : 'follow',
        cache: noCache ? 'no-store' : 'default',
        headers: headersSent,
        signal: controller.signal,
      }
      let response = await send(url, request)
      let requestUrl = url
      let redirects = 0
      while (
        !stayOnFirstHop &&
        originBound &&
        [301, 302, 303, 307, 308].includes(response.status) &&
        response.headers.has('location')
      ) {
        await response.body?.cancel()
        if (redirects >= 20) throw new Error('Live probe exceeded the redirect limit')
        const next = new URL(response.headers.get('location')!, requestUrl)
        if (next.origin !== new URL(url).origin)
          throw new Error('Live probe refused a cross-origin redirect with request headers')
        requestUrl = next.href
        redirects += 1
        response = await send(requestUrl, request)
      }
      const headers: Record<string, string> = {}
      response.headers.forEach((value, name) => {
        headers[name.toLowerCase()] = value
      })
      const buffer = await response.arrayBuffer().catch(() => new ArrayBuffer(0))
      const result: LiveResponse = { url, status: response.status, headers }
      if (stayOnFirstHop && [301, 302, 303, 307, 308].includes(response.status)) {
        result.redirected = true
        if (headers.location) result.finalUrl = new URL(headers.location, url).href
      } else {
        // Manual hops count too; URL normalisation alone is not a redirect.
        if (response.url) result.finalUrl = response.url
        if (response.redirected || redirects > 0) result.redirected = true
      }
      if (readBody) {
        const bytes = new Uint8Array(buffer)
        const truncated = bytes.byteLength > maxBodyBytes
        result.body = new TextDecoder().decode(truncated ? bytes.slice(0, maxBodyBytes) : bytes)
        if (truncated) result.bodyTruncated = true
      }
      return result
    } catch (error) {
      const result: LiveResponse = {
        url,
        error: error instanceof Error ? error.message : String(error),
      }
      const code = transportErrorCode(error)
      if (code) result.errorCode = code
      return result
    } finally {
      clearTimeout(timer)
    }
  }
}
