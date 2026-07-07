/* eslint-disable narduk/file-size-budget, no-console -- SSRF-safe URL validator keeps DNS resolution, validation, streaming fetch, redirect handling, and User-Agent fallback in a single module so the hardened fetch surface stays auditable end-to-end; debug logs are gated on unfurlDebug. */
import { resolve4, resolve6 } from 'node:dns/promises'
import { isIP } from 'node:net'

// Static import so Vite/Wrangler include undici in the server bundle. A prior
// dynamic `import(/* @vite-ignore */ 'undici')` was elided by both bundlers
// and the Workers/Node bundle shipped without undici, causing the pinning
// path in `createPinnedDispatcher` to fail closed with SSRF_BLOCKED even for
// valid public hosts. Runtime use is still gated on `isNodeRuntime()` below.
import { Agent as UndiciAgent } from 'undici'

import { sanitizeErrorForLog, sanitizeUrlForLog } from './logSanitizer'
import { isPrivateIPv4, isPrivateIPv6, stripIPv6Brackets } from './ssrfHostIpPolicy'
import {
  bestEffortCancelReader,
  drainUnusedResponse,
  isKnownNonHtmlContentType,
} from './unfurlResponseUtils'

/**
 * SSRF Protection and URL Validation
 * Prevents Server-Side Request Forgery attacks.
 *
 * Runtime requirements (per AGENTS.md non-negotiable Workers constraints):
 *
 * This module imports `node:dns/promises` and `node:net`. Apps that deploy to
 * Cloudflare Workers MUST enable the `nodejs_compat` compatibility flag in
 * `wrangler.jsonc` before importing `resolveAndAssertPublicHost` or
 * `fetchWithValidatedRedirects`. Without `nodejs_compat` these helpers will
 * fail to bundle. Workers-only apps that cannot enable the flag should skip
 * this module and validate URLs with IP-literal checks only.
 */

interface ValidationResult {
  error?: string
  normalizedUrl?: string
  valid: boolean
}

const MAX_URL_LENGTH = 2048
const MAX_REDIRECTS = 5
const FETCH_TIMEOUT = 30000 // 30 seconds
const MAX_RESPONSE_SIZE = 2 * 1024 * 1024 // 2MB

/** Passed from handlers via useRuntimeConfig — avoids process.env in Worker runtime. */
export interface UrlWorkerEnv {
  nodeEnv: string
  unfurlDebug: boolean
}

export const DEFAULT_URL_WORKER_ENV: UrlWorkerEnv = {
  nodeEnv: 'production',
  unfurlDebug: false,
}

/**
 * Crawler User-Agent string following Open Graph protocol best practices
 * Identifies the service honestly as a crawler/bot rather than masquerading as a browser
 * This follows the pattern used by major platforms:
 * - Facebook: facebookexternalhit/1.1
 * - Twitter: Twitterbot/1.0
 * - LinkedIn: LinkedInBot/1.0
 * - Discord: Discordbot/2.0
 */
const CRAWLER_USER_AGENT = 'OGPreviewBot/1.0 (+https://ogpreview.app/bot)'

/**
 * Alternative User-Agents for fallback when rate limited
 * These mimic popular platform crawlers that sites often allow
 */
const FALLBACK_USER_AGENTS = [
  'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
  'LinkedInBot/1.0 (compatible; Mozilla/5.0; +http://www.linkedin.com)',
  'Twitterbot/1.0',
  'Discordbot/2.0 (+https://discord.com)',
  'WhatsApp/2.0',
  'TelegramBot (like TwitterBot)',
  'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
]

/**
 * Returns the crawler User-Agent string
 * Uses a consistent, honest User-Agent that identifies the service as a crawler
 * This helps sites identify and allow/block the crawler appropriately via robots.txt
 */
function selectUserAgent(_url: string): string {
  return CRAWLER_USER_AGENT
}

/**
 * Returns a fallback User-Agent by index
 * Used when we get rate limited to try alternative User-Agents
 */
function selectFallbackUserAgent(index: number): string {
  return FALLBACK_USER_AGENTS[index % FALLBACK_USER_AGENTS.length]!
}

/**
 * Validate that the resolved IP is public. Reject if any resolved address is
 * private. Returns the validated public addresses so the caller can pin the
 * outbound fetch to one of them and prevent DNS-rebinding between the
 * validation check and the subsequent network dial (TOCTOU SSRF bypass).
 *
 * When `hostname` is already an IPv4 or IPv6 literal we skip DNS resolution
 * and apply the private-range checks directly. This avoids relying on DNS
 * resolver behavior for IP strings, which can vary across platforms and
 * surface as misleading `ENOTFOUND` errors.
 */
export async function resolveAndAssertPublicHost(hostname: string): Promise<ResolvedDnsRecord[]> {
  const unbracketed = stripIPv6Brackets(hostname)
  const hostnameIpType = isIP(unbracketed) as 0 | 4 | 6
  if (hostnameIpType === 4) {
    if (isPrivateIPv4(unbracketed)) {
      throw createDnsValidationError('Resolved to private IPv4 address', {
        context: { hostname, records: [] },
      })
    }
    return [{ address: unbracketed, family: 4 }]
  }

  if (hostnameIpType === 6) {
    if (isPrivateIPv6(unbracketed)) {
      throw createDnsValidationError('Resolved to private IPv6 address', {
        context: { hostname, records: [] },
      })
    }
    return [{ address: unbracketed, family: 6 }]
  }

  const results = await resolvePublicDnsRecords(hostname)
  if (results.length === 0) {
    throw createDnsValidationError('Domain not found', {
      code: 'ENOTFOUND',
      context: { hostname, records: [] },
    })
  }

  const inspectedRecords = results.map((record) => {
    const normalizedAddress = normalizeResolvedAddress(record.address)
    const ipType = isIP(normalizedAddress) as 0 | 4 | 6
    const isPrivate =
      ipType === 4
        ? isPrivateIPv4(normalizedAddress)
        : ipType === 6
          ? isPrivateIPv6(normalizedAddress)
          : false

    return {
      ...record,
      normalizedAddress,
      ipType,
      isPrivate,
    }
  })

  const publicAddresses: ResolvedDnsRecord[] = []
  let sawIpLiteral = false
  for (const record of inspectedRecords) {
    const addr = record.normalizedAddress

    if (record.ipType === 0) {
      continue
    }
    sawIpLiteral = true

    if (record.ipType === 4 && isPrivateIPv4(addr)) {
      throw createDnsValidationError('Resolved to private IPv4 address', {
        context: { hostname, records: inspectedRecords },
      })
    }

    if (record.ipType === 6 && isPrivateIPv6(addr)) {
      throw createDnsValidationError('Resolved to private IPv6 address', {
        context: { hostname, records: inspectedRecords },
      })
    }

    publicAddresses.push({ address: addr, family: record.ipType })
  }

  if (!sawIpLiteral) {
    throw createDnsValidationError('Resolved records did not contain IP literals', {
      context: { hostname, records: inspectedRecords },
    })
  }

  return publicAddresses
}

/**
 * Closable represents the undici Agent interface we actually rely on — just
 * enough to hand back to `fetch({ dispatcher })` and clean up afterwards.
 * Pinning loads undici only on Node (`isNodeRuntime`); Workers skip this path
 * and use the platform `fetch`.
 */
interface PinnedDispatcher {
  close: () => Promise<void>
}

type PinnedDispatcherResult = PinnedDispatcher | { reason: string; unavailable: true }

function isNodeRuntime(): boolean {
  // Node exposes process.versions.node; Cloudflare Workers / browsers do not.
  return (
    typeof process !== 'undefined' &&
    typeof (process as { versions?: { node?: unknown } }).versions?.node === 'string'
  )
}

/**
 * Build a fetch `dispatcher` whose DNS lookup always returns `pin.address`
 * for the validated hostname. This eliminates the DNS-rebinding window
 * between `resolveAndAssertPublicHost` and the subsequent `fetch(...)` dial:
 * even if an attacker-controlled authoritative resolver flips the record
 * to a private IP after we validated it, the actual socket still dials the
 * previously-vetted public address.
 *
 * Returns the dispatcher on success in Node.js, `{ unavailable, reason }` when
 * Node cannot load undici or build an Agent (caller must fail closed),
 * or `undefined` when no addresses were provided (validation intentionally
 * skipped) or when the runtime is not Node (e.g. Workers: platform-managed DNS).
 */
function createPinnedDispatcher(
  addresses: ResolvedDnsRecord[],
  debug: boolean,
): PinnedDispatcherResult | undefined {
  // No addresses: unpinned fetch is intentional (e.g. localhost in test mode skipped DNS).
  if (addresses.length === 0) return undefined

  if (!isNodeRuntime()) {
    if (debug) {
      console.log(
        '[fetchWithValidatedRedirects] Skipping IP pinning on non-Node runtime; platform fetch manages DNS without an app-observable rebinding window.',
      )
    }
    return undefined
  }

  const pin = addresses[0]!

  try {
    // Node-only: this block never runs on Workers (`isNodeRuntime` guard above).
    // `UndiciAgent` is imported statically at module top so bundlers include
    // it in the server graph; calling it here would fail on non-Node runtimes,
    // which is why the `isNodeRuntime()` gate above is mandatory.
    return new UndiciAgent({
      connect: {
        lookup: (
          _hostname: string,
          _options: unknown,
          callback: (err: Error | null, address: string, family: 4 | 6) => void,
        ) => {
          callback(null, pin.address, pin.family)
        },
      },
    }) as unknown as PinnedDispatcher
  } catch (err: unknown) {
    if (debug) {
      console.log(
        '[fetchWithValidatedRedirects] Failed to build pinned dispatcher:',
        err instanceof Error ? err.message : String(err),
      )
    }
    return {
      unavailable: true,
      reason: err instanceof Error ? err.message : String(err),
    }
  }
}

async function closePinnedDispatcher(
  dispatcher: PinnedDispatcher | { reason: string; unavailable: true } | undefined,
  debug: boolean,
): Promise<void> {
  if (!dispatcher) return
  if (!('close' in dispatcher)) return
  try {
    await (dispatcher as PinnedDispatcher).close()
  } catch (err: unknown) {
    if (debug) {
      console.log(
        '[fetchWithValidatedRedirects] Failed to close pinned dispatcher:',
        err instanceof Error ? err.message : String(err),
      )
    }
  }
}

interface ResolvedDnsRecord {
  address: string
  family: 4 | 6
}

interface DnsLookupAttempt {
  addresses?: string[]
  code?: string
  family: 4 | 6
  message?: string
  status: 'resolved' | 'no-data' | 'error'
}

interface DnsErrorContext {
  attempts?: DnsLookupAttempt[]
  hostname: string
  records?: Array<{
    address: string
    family: 4 | 6
    ipType: 0 | 4 | 6
    isPrivate: boolean
    normalizedAddress: string
  }>
}

interface DnsValidationError extends Error {
  code?: string
  context?: DnsErrorContext
}

function createDnsValidationError(
  message: string,
  options: {
    code?: string
    context?: DnsErrorContext
  } = {},
): DnsValidationError {
  const error = new Error(message) as DnsValidationError
  if (options.code) error.code = options.code
  if (options.context) error.context = options.context
  return error
}

function normalizeResolvedAddress(address: string): string {
  const trimmed = address.trim()
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function isNoDataDnsError(error: unknown): boolean {
  const code = (error as { code?: string }).code
  return code === 'ENOTFOUND' || code === 'ENODATA'
}

async function resolvePublicDnsRecords(hostname: string): Promise<ResolvedDnsRecord[]> {
  const [ipv4Result, ipv6Result] = await Promise.allSettled([
    resolve4(hostname),
    resolve6(hostname),
  ])
  const results: ResolvedDnsRecord[] = []
  const errors: unknown[] = []
  const attempts: DnsLookupAttempt[] = []

  if (ipv4Result.status === 'fulfilled') {
    attempts.push({
      family: 4,
      status: 'resolved',
      addresses: ipv4Result.value,
    })
    results.push(...ipv4Result.value.map((address) => ({ address, family: 4 as const })))
  } else if (isNoDataDnsError(ipv4Result.reason)) {
    attempts.push({
      family: 4,
      status: 'no-data',
      code: (ipv4Result.reason as { code?: string }).code,
      message:
        ipv4Result.reason instanceof Error ? ipv4Result.reason.message : String(ipv4Result.reason),
    })
  } else {
    attempts.push({
      family: 4,
      status: 'error',
      code: (ipv4Result.reason as { code?: string }).code,
      message:
        ipv4Result.reason instanceof Error ? ipv4Result.reason.message : String(ipv4Result.reason),
    })
    errors.push(ipv4Result.reason)
  }

  if (ipv6Result.status === 'fulfilled') {
    attempts.push({
      family: 6,
      status: 'resolved',
      addresses: ipv6Result.value,
    })
    results.push(...ipv6Result.value.map((address) => ({ address, family: 6 as const })))
  } else if (isNoDataDnsError(ipv6Result.reason)) {
    attempts.push({
      family: 6,
      status: 'no-data',
      code: (ipv6Result.reason as { code?: string }).code,
      message:
        ipv6Result.reason instanceof Error ? ipv6Result.reason.message : String(ipv6Result.reason),
    })
  } else {
    attempts.push({
      family: 6,
      status: 'error',
      code: (ipv6Result.reason as { code?: string }).code,
      message:
        ipv6Result.reason instanceof Error ? ipv6Result.reason.message : String(ipv6Result.reason),
    })
    errors.push(ipv6Result.reason)
  }

  if (results.length > 0) {
    return results
  }

  if (errors.length > 0) {
    const firstError = errors[0]
    throw createDnsValidationError(
      firstError instanceof Error ? firstError.message : String(firstError),
      {
        code: (firstError as { code?: string }).code,
        context: { hostname, attempts },
      },
    )
  }

  throw createDnsValidationError('Domain not found', {
    code: 'ENOTFOUND',
    context: { hostname, attempts },
  })
}

/**
 * Validates URL format, protocol, and checks for SSRF vulnerabilities
 */
/* eslint-disable sonarjs/cognitive-complexity -- many explicit SSRF/host rules converge here */
export function validateUrl(
  urlString: string,
  env: UrlWorkerEnv = DEFAULT_URL_WORKER_ENV,
): ValidationResult {
  // Check URL length
  if (!urlString || urlString.length === 0) {
    return { valid: false, error: 'URL is required' }
  }

  if (urlString.length > MAX_URL_LENGTH) {
    return { valid: false, error: `URL exceeds maximum length of ${MAX_URL_LENGTH} characters` }
  }

  // Parse URL
  let urlObj: URL
  try {
    urlObj = new URL(urlString)
  } catch {
    return { valid: false, error: 'Invalid URL format' }
  }

  // Check protocol
  if (!['http:', 'https:'].includes(urlObj.protocol)) {
    return { valid: false, error: 'URL must use HTTP or HTTPS protocol' }
  }

  // Check for credentials in URL (security risk)
  if (urlObj.username || urlObj.password) {
    return { valid: false, error: 'URLs with credentials are not allowed' }
  }

  // Check hostname
  const hostname = urlObj.hostname.toLowerCase()

  // Block localhost variations (except in test mode). The localhost bypass is
  // gated strictly by `env.nodeEnv === 'test'` so URL-path tricks cannot reach
  // internal services in production, staging, or preview runtimes.
  const isTestMode = env.nodeEnv === 'test'
  if (!isTestMode && (hostname === 'localhost' || hostname === '0.0.0.0')) {
    return { valid: false, error: 'Localhost URLs are not allowed' }
  }

  // Additional hostname validation
  if (hostname.length === 0) {
    return { valid: false, error: 'Invalid hostname' }
  }

  // Check for valid domain (must have a dot unless it's an IP literal or localhost)
  // Bounded IPv4 pattern — not susceptible to ReDoS
  const isIPv4 = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)
  const isIPv6 = hostname.includes(':') || hostname.startsWith('[')
  const isLocalhost = hostname === 'localhost'
  if (!hostname.includes('.') && !isIPv4 && !isIPv6 && !(isLocalhost && isTestMode)) {
    return { valid: false, error: 'Invalid domain name' }
  }

  const unbracketedHost = stripIPv6Brackets(hostname)
  const ipKind = isIP(unbracketedHost)
  const isTestLocalhostAllow =
    isTestMode &&
    (hostname === 'localhost' ||
      unbracketedHost === '127.0.0.1' ||
      unbracketedHost === '0.0.0.0' ||
      unbracketedHost === '::1')

  // Reject private IP literals up-front so callers that skip the DNS path (or hit this before resolveAndAssertPublicHost) still get SSRF protection.
  if (!isTestLocalhostAllow) {
    if (ipKind === 4 && isPrivateIPv4(unbracketedHost)) {
      return {
        valid: false,
        error: 'URL hostname is a private IP address',
      }
    }
    if (ipKind === 6 && isPrivateIPv6(unbracketedHost)) {
      return {
        valid: false,
        error: 'URL hostname is a private IP address',
      }
    }
  }

  // Normalize URL: remove trailing slash for root paths to avoid redirect issues
  let normalizedHref = urlObj.href
  if (urlObj.pathname === '/' && normalizedHref.endsWith('/')) {
    normalizedHref = normalizedHref.slice(0, -1)
  }

  return {
    valid: true,
    normalizedUrl: normalizedHref,
  }
}
/* eslint-enable sonarjs/cognitive-complexity -- end of validateUrl SSRF checks */

function isRedirect(status: number): boolean {
  return status >= 300 && status < 400
}

interface SafeFetchResult {
  error?: { code: string; details?: string; message: string }
  finalUrl?: string
  html?: string
  ok: boolean
}

/**
 * Fetches HTML from a URL with DNS-based SSRF protection, manual redirects, and streaming size limits.
 */
/* eslint-disable sonarjs/cognitive-complexity -- single orchestration loop: pinning, redirects, fallbacks, stream. Sequential await is required for redirects and streaming */
export async function fetchWithValidatedRedirects(
  url: string,
  env: UrlWorkerEnv = DEFAULT_URL_WORKER_ENV,
): Promise<SafeFetchResult> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT)
  const startTime = Date.now()
  const DEBUG = env.unfurlDebug

  let currentUrl = url
  let redirects = 0
  // Track the most recent pinned dispatcher so we can release its sockets
  // when we swap it for a new one (redirect to a different hostname) or
  // when the fetch loop exits via return/throw.
  let pinnedDispatcher: PinnedDispatcher | undefined

  if (DEBUG)
    console.log(`[fetchWithValidatedRedirects] Starting fetch for: ${sanitizeUrlForLog(url)}`)

  try {
    for (;;) {
      const validation = validateUrl(currentUrl, env)
      if (!validation.valid) {
        console.error(
          `[fetchWithValidatedRedirects] Invalid URL: ${sanitizeUrlForLog(currentUrl)}`,
          validation.error,
        )
        return {
          ok: false,
          error: {
            code: 'INVALID_URL',
            message: validation.error ?? 'Invalid URL',
          },
        }
      }

      const normalizedUrl = validation.normalizedUrl!
      const urlObj = new URL(normalizedUrl)

      if (DEBUG)
        console.log(
          `[fetchWithValidatedRedirects] Validated URL: ${sanitizeUrlForLog(normalizedUrl)}, redirects: ${redirects}`,
        )

      // Skip DNS validation for localhost only in test mode. Path-based
      // fixture detection is intentionally not honored here — an attacker who
      // controls the URL path must never be able to bypass private-host
      // checks in production or preview environments.
      const isTestMode = env.nodeEnv === 'test'
      // URL#hostname uses bracketed IPv6 literals (e.g. `[::1]`); normalize for `::1`.
      const fetchHostUnbracketed = stripIPv6Brackets(urlObj.hostname.toLowerCase())
      const isLocalhost =
        urlObj.hostname === 'localhost' ||
        urlObj.hostname === '127.0.0.1' ||
        urlObj.hostname === '0.0.0.0' ||
        fetchHostUnbracketed === '::1'

      let validatedAddresses: ResolvedDnsRecord[] = []
      if (!(isLocalhost && isTestMode)) {
        try {
          if (DEBUG)
            console.log(`[fetchWithValidatedRedirects] Resolving DNS for: ${urlObj.hostname}`)
          validatedAddresses = await resolveAndAssertPublicHost(urlObj.hostname)
          if (DEBUG)
            console.log(
              `[fetchWithValidatedRedirects] DNS resolution successful for: ${urlObj.hostname}`,
            )
        } catch (err: unknown) {
          const dnsError = err instanceof Error ? err : new Error(String(err))
          const dnsErrCode = (err as { code?: string }).code
          const dnsContext = (err as { context?: DnsErrorContext }).context
          console.error(
            `[fetchWithValidatedRedirects] DNS validation failed for ${urlObj.hostname}`,
            {
              url: sanitizeUrlForLog(normalizedUrl),
              redirectCount: redirects,
              error: sanitizeErrorForLog(dnsError),
              dnsContext,
            },
          )

          // Distinguish "domain not found" from actual SSRF blocks
          if (dnsErrCode === 'ENOTFOUND') {
            return {
              ok: false,
              error: {
                code: 'DNS_ERROR',
                message: 'Domain not found — check the URL for typos',
                details: dnsError.message,
              },
            }
          }

          return {
            ok: false,
            error: {
              code: 'SSRF_BLOCKED',
              message: 'URL resolves to a private or disallowed address',
              details: dnsError.message,
            },
          }
        }
      }

      if (DEBUG)
        console.log(`[fetchWithValidatedRedirects] Fetching: ${sanitizeUrlForLog(normalizedUrl)}`)
      const fetchStartTime = Date.now()

      // Use browser-like headers to avoid bot detection
      // NOTE: Do NOT set Accept-Encoding manually - let Node/Nitro handle decompression transparently
      // Manually setting it can result in receiving compressed bytes that aren't decompressed
      // Use honest crawler User-Agent that identifies the service
      const urlObjForHeaders = new URL(normalizedUrl)
      const selectedUserAgent = selectUserAgent(normalizedUrl)

      if (DEBUG)
        console.log(
          `[fetchWithValidatedRedirects] Selected User-Agent: ${selectedUserAgent.substring(0, 50)}...`,
        )

      const headers: HeadersInit = {
        'User-Agent': selectedUserAgent,
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'Accept-Language': 'en-US,en;q=0.9',
        DNT: '1',
        Connection: 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Cache-Control': 'max-age=0',
        Referer: `${urlObjForHeaders.protocol}//${urlObjForHeaders.hostname}/`,
        Origin: `${urlObjForHeaders.protocol}//${urlObjForHeaders.hostname}`,
      }

      // Pin the outbound dial to the validated public IP so a DNS-rebinding
      // attacker cannot return a private IP between validation and fetch.
      // Close the previous iteration's dispatcher first so we do not leak
      // sockets when a redirect takes us to a different hostname.
      await closePinnedDispatcher(pinnedDispatcher, DEBUG)
      const pinResult = createPinnedDispatcher(validatedAddresses, DEBUG)
      if (pinResult && 'unavailable' in pinResult) {
        console.error(
          `[fetchWithValidatedRedirects] Refusing to fetch without IP pinning: ${pinResult.reason}`,
        )
        return {
          ok: false,
          error: {
            code: 'SSRF_BLOCKED',
            message: 'Cannot enforce SSRF protection in this runtime',
            details: pinResult.reason,
          },
        }
      }
      pinnedDispatcher = pinResult

      const response = await fetch(normalizedUrl, {
        signal: controller.signal,
        headers,
        redirect: 'manual',
        // `dispatcher` is an undici-specific fetch option. Node's global
        // fetch accepts it; other runtimes ignore the unknown key.
        ...(pinnedDispatcher
          ? ({ dispatcher: pinnedDispatcher } as unknown as Record<string, unknown>)
          : {}),
      } as RequestInit)

      if (DEBUG)
        console.log(
          `[fetchWithValidatedRedirects] Fetch completed in ${Date.now() - fetchStartTime}ms, status: ${response.status} ${response.statusText}`,
        )

      // Handle redirects manually
      if (isRedirect(response.status)) {
        const location = response.headers.get('location')
        if (DEBUG)
          console.log(`[fetchWithValidatedRedirects] Redirect ${response.status} to: ${location}`)
        if (!location) {
          console.error(
            `[fetchWithValidatedRedirects] Redirect missing Location header for status ${response.status}`,
          )
          // Drain the malformed-redirect response body so we don't leak the
          // socket while iterating on flaky origins that emit 3xx with bodies.
          await drainUnusedResponse(response, DEBUG)
          return {
            ok: false,
            error: {
              code: 'REDIRECT_ERROR',
              message: 'Redirect response missing Location header',
              details: `HTTP ${response.status}`,
            },
          }
        }

        if (redirects >= MAX_REDIRECTS) {
          console.error(
            `[fetchWithValidatedRedirects] Too many redirects: ${redirects} >= ${MAX_REDIRECTS}`,
          )
          // Release the final redirect response before returning so its body
          // does not sit open while the caller handles the error.
          await drainUnusedResponse(response, DEBUG)
          return {
            ok: false,
            error: {
              code: 'TOO_MANY_REDIRECTS',
              message: `Exceeded maximum redirect limit of ${MAX_REDIRECTS}`,
            },
          }
        }

        const nextUrl = new URL(location, normalizedUrl).href
        redirects++
        currentUrl = nextUrl
        if (DEBUG)
          console.log(
            `[fetchWithValidatedRedirects] Following redirect ${redirects}/${MAX_REDIRECTS} to: ${sanitizeUrlForLog(nextUrl)}`,
          )
        // Drop the redirect response body before issuing the next request —
        // undici holds the socket open until the body is consumed or cancelled,
        // so long redirect chains would otherwise stack up open streams.
        await drainUnusedResponse(response, DEBUG)
        continue
      }

      // Check response status
      // Handle 429 (Too Many Requests) with fallback User-Agents
      if (response.status === 429) {
        if (DEBUG)
          console.log(`[fetchWithValidatedRedirects] Got 429, trying fallback User-Agents...`)

        // Release the original 429 response before issuing fallback requests.
        // Leaving its body unconsumed can hold the socket/stream open while
        // we fan out N additional fetches for each fallback UA.
        await drainUnusedResponse(response, DEBUG)

        // Try fallback User-Agents in order
        for (let fallbackIndex = 0; fallbackIndex < FALLBACK_USER_AGENTS.length; fallbackIndex++) {
          const fallbackUserAgent = selectFallbackUserAgent(fallbackIndex)
          if (DEBUG)
            console.log(
              `[fetchWithValidatedRedirects] Trying fallback ${fallbackIndex + 1}/${FALLBACK_USER_AGENTS.length}: ${fallbackUserAgent.substring(0, 50)}...`,
            )

          try {
            const fallbackHeaders: HeadersInit = {
              'User-Agent': fallbackUserAgent,
              Accept:
                'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
              'Accept-Language': 'en-US,en;q=0.9',
              DNT: '1',
              Connection: 'keep-alive',
              'Upgrade-Insecure-Requests': '1',
              'Sec-Fetch-Dest': 'document',
              'Sec-Fetch-Mode': 'navigate',
              'Sec-Fetch-Site': 'none',
              'Sec-Fetch-User': '?1',
              'Cache-Control': 'max-age=0',
              Referer: `${urlObjForHeaders.protocol}//${urlObjForHeaders.hostname}/`,
              Origin: `${urlObjForHeaders.protocol}//${urlObjForHeaders.hostname}`,
            }

            const fallbackResponse = await fetch(normalizedUrl, {
              signal: controller.signal,
              headers: fallbackHeaders,
              redirect: 'manual',
              // Reuse the current iteration's pinned dispatcher so the
              // fallback attempts hit the same validated public IP.
              ...(pinnedDispatcher
                ? ({ dispatcher: pinnedDispatcher } as unknown as Record<string, unknown>)
                : {}),
            } as RequestInit)

            if (DEBUG)
              console.log(
                `[fetchWithValidatedRedirects] Fallback ${fallbackIndex + 1} returned status: ${fallbackResponse.status}`,
              )

            // If fallback succeeded (2xx), use it
            if (fallbackResponse.ok) {
              if (DEBUG)
                console.log(
                  `[fetchWithValidatedRedirects] Fallback ${fallbackIndex + 1} succeeded!`,
                )
              // Continue with the fallback response — same policy as the main
              // 200 path: reject only known non-HTML; empty/unknown may still be HTML.
              const contentType = fallbackResponse.headers.get('content-type') ?? ''
              if (isKnownNonHtmlContentType(contentType)) {
                console.error(
                  `[fetchWithValidatedRedirects] Fallback invalid content type: ${contentType}`,
                )
                await drainUnusedResponse(fallbackResponse, DEBUG)
                return {
                  ok: false,
                  error: {
                    code: 'INVALID_CONTENT_TYPE',
                    message: 'URL does not return HTML content',
                    details: contentType,
                  },
                }
              }

              // Use the fallback response
              const reader = fallbackResponse.body?.getReader()
              if (!reader) {
                await drainUnusedResponse(fallbackResponse, DEBUG)
                continue // Try next fallback
              }

              // Reuse a single TextDecoder across chunks. Allocating a new one
              // per chunk breaks multi-byte UTF-8 sequences that straddle chunk
              // boundaries and also churns garbage on every iteration.
              const decoder = new TextDecoder()
              let html = ''
              let totalSize = 0
              let oversize = false
              try {
                for (;;) {
                  const { done, value } = await reader.read()
                  if (done) break

                  totalSize += value.length
                  if (totalSize > MAX_RESPONSE_SIZE) {
                    oversize = true
                    break
                  }

                  html += decoder.decode(value, { stream: true })
                }
              } finally {
                // Always release the underlying stream, even when we abort the
                // loop on oversize payloads. Without this, undici can hold the
                // socket open until GC and leak resources under load.
                try {
                  await reader.cancel()
                } catch (cancelError: unknown) {
                  if (DEBUG) {
                    console.log(
                      '[fetchWithValidatedRedirects] Failed to cancel fallback reader:',
                      cancelError instanceof Error ? cancelError.message : String(cancelError),
                    )
                  }
                }
              }
              if (oversize) {
                return {
                  ok: false,
                  error: {
                    code: 'RESPONSE_TOO_LARGE',
                    message: `Response too large: ${totalSize} bytes`,
                    details: `Exceeded limit of ${MAX_RESPONSE_SIZE} bytes`,
                  },
                }
              }
              html += decoder.decode()

              return {
                ok: true,
                html,
                finalUrl: normalizedUrl,
              }
            }

            // If fallback also got 429, try next one.
            if (fallbackResponse.status === 429) {
              await drainUnusedResponse(fallbackResponse, DEBUG)
              continue
            }

            // Remaining responses here are !ok (handled by `if (fallbackResponse.ok)` above).
            await drainUnusedResponse(fallbackResponse, DEBUG)
            continue
          } catch (fallbackError: unknown) {
            // If fallback fails, try next one
            if (DEBUG)
              console.log(
                `[fetchWithValidatedRedirects] Fallback ${fallbackIndex + 1} failed:`,
                fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
              )
            continue
          }
        }

        // All fallbacks failed
        console.error(`[fetchWithValidatedRedirects] All fallback User-Agents failed for 429`)
        return {
          ok: false,
          error: {
            code: 'RATE_LIMITED',
            message: 'Too many requests. All fallback methods failed.',
            details: `Tried ${FALLBACK_USER_AGENTS.length} fallback User-Agents`,
          },
        }
      }

      // For other non-ok responses, check content type
      // For 400/403 errors, some sites (like Facebook) may still return HTML with OG tags
      // Some sites return HTML even with wrong content-type headers, so we'll try to parse anyway
      // Only skip parsing for clearly non-HTML content types (JSON, images, etc.)
      if (!response.ok) {
        const contentType = response.headers.get('content-type') ?? ''
        const isHtmlContent =
          contentType.includes('text/html') || contentType.includes('application/xhtml')
        const isNonHtmlContent =
          contentType.includes('application/json') ||
          contentType.includes('image/') ||
          contentType.includes('application/octet-stream') ||
          (contentType.includes('text/plain') && !contentType.includes('html'))

        // For clearly non-HTML error responses, return error immediately
        if (isNonHtmlContent) {
          console.error(
            `[fetchWithValidatedRedirects] HTTP error with non-HTML content: ${response.status} ${response.statusText}`,
          )
          // Release the response body so undici doesn't hold the socket open
          // while the caller handles the HTTP-error result. Bot/WAF blocks
          // often return non-HTML error bodies and can be repeated aggressively.
          await drainUnusedResponse(response, DEBUG)
          return {
            ok: false,
            error: {
              code:
                response.status === 400
                  ? 'BAD_REQUEST'
                  : response.status === 403
                    ? 'FORBIDDEN'
                    : 'HTTP_ERROR',
              message: `Server returned ${response.status} ${response.statusText}`,
              details: `HTTP ${response.status}, Content-Type: ${contentType}`,
            },
          }
        }

        // For HTML or unknown content types, log but continue to try parsing
        // Many sites return HTML even with 403, and some have incorrect content-type headers
        console.warn(
          `[fetchWithValidatedRedirects] HTTP ${response.status} but continuing to parse content`,
          {
            url: normalizedUrl,
            contentType,
            isHtmlContent,
          },
        )
      }

      // Check content type.
      //
      // The non-OK branch above deliberately continues past known-HTML or
      // unknown content types so bot-protected sites (which often return
      // HTML error pages with missing or mislabelled Content-Type) can still
      // be parsed for OG metadata. To honor that same intent on successful
      // responses, treat missing / generic / explicitly non-HTML labels as a
      // signal to *try* parsing as HTML and only bail out for content types
      // we know cannot contain HTML (JSON, binary, images, plaintext).
      const contentType = response.headers.get('content-type') ?? ''
      if (DEBUG) console.log(`[fetchWithValidatedRedirects] Content-Type: ${contentType}`)
      const isHtmlContentType =
        contentType.includes('text/html') || contentType.includes('application/xhtml')
      if (isKnownNonHtmlContentType(contentType)) {
        console.error(`[fetchWithValidatedRedirects] Invalid content type: ${contentType}`)
        // Release the response body so undici doesn't hold the socket open for
        // non-HTML URLs we intentionally abandon (common under repeated unfurls).
        await drainUnusedResponse(response, DEBUG)
        return {
          ok: false,
          error: {
            code: 'INVALID_CONTENT_TYPE',
            message: 'URL does not return HTML content',
            details: contentType,
          },
        }
      }
      if (!isHtmlContentType && DEBUG) {
        console.log(
          `[fetchWithValidatedRedirects] Unknown/empty Content-Type (${contentType || '<none>'}); attempting HTML parse anyway`,
        )
      }

      // Check content length if available
      const contentLengthHeader = response.headers.get('content-length')
      if (contentLengthHeader && Number.parseInt(contentLengthHeader) > MAX_RESPONSE_SIZE) {
        // Release the response body so undici doesn't hold the socket open
        // after we bail on oversized content-length before touching the stream.
        await drainUnusedResponse(response, DEBUG)
        return {
          ok: false,
          error: {
            code: 'CONTENT_TOO_LARGE',
            message: 'Response size exceeds maximum limit',
            details: `${contentLengthHeader} bytes`,
          },
        }
      }

      // Stream response with size limit
      // Optimization: Stop streaming after </head> tag since OG tags are in <head>
      // This allows us to parse large pages without downloading the entire body
      const reader = response.body?.getReader()
      if (!reader) {
        console.error(`[fetchWithValidatedRedirects] No response body reader available`)
        return {
          ok: false,
          error: {
            code: 'EMPTY_RESPONSE',
            message: 'Server returned empty content',
          },
        }
      }

      if (DEBUG) console.log(`[fetchWithValidatedRedirects] Starting to stream response body`)
      const decoder = new TextDecoder()
      let html = ''
      let totalSize = 0
      const HEAD_END_MARKER = '</head>'
      const HEAD_END_MARKER_LOWER = '</head>'
      let foundHeadEnd = false
      // Keep a small rolling window of the recent response tail in lowercase so
      // we can do a case-insensitive </head> search in O(chunk_size) instead of
      // rescanning the full accumulated buffer every iteration.
      const TAIL_WINDOW = HEAD_END_MARKER.length + 64
      let lowerTail = ''

      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break

          totalSize += value.length

          // Check size limit
          if (totalSize > MAX_RESPONSE_SIZE) {
            console.error(
              `[fetchWithValidatedRedirects] Response too large: ${totalSize} bytes > ${MAX_RESPONSE_SIZE} bytes`,
            )
            return {
              ok: false,
              error: {
                code: 'CONTENT_TOO_LARGE',
                message: 'Response size exceeds maximum limit',
                details: `${totalSize} bytes`,
              },
            }
          }

          const chunk = decoder.decode(value, { stream: true })
          html += chunk

          // Check if we've found the closing </head> tag (case-insensitive)
          // Once we have the head section, we have all OG tags, so we can stop streaming
          lowerTail = (lowerTail + chunk.toLowerCase()).slice(-TAIL_WINDOW)
          const tailIndex = lowerTail.indexOf(HEAD_END_MARKER_LOWER)
          if (tailIndex !== -1) {
            // Translate tail-relative index back to a position in `html`.
            const headEndIndex = html.length - lowerTail.length + tailIndex
            // Found </head>, extract up to and including it, plus a bit more for safety
            // Some sites have meta tags right before </head>
            const extractEnd = Math.min(headEndIndex + HEAD_END_MARKER.length + 1000, html.length)
            html = html.substring(0, extractEnd)
            foundHeadEnd = true
            if (DEBUG)
              console.log(
                `[fetchWithValidatedRedirects] Found </head> tag, stopping stream early at ${html.length} bytes`,
              )
            break
          }
        }
      } finally {
        await bestEffortCancelReader(reader, DEBUG)
      }

      // Finalize decoder if we didn't cancel early
      if (!foundHeadEnd) {
        html += decoder.decode()
      }

      if (html.length === 0) {
        console.error(`[fetchWithValidatedRedirects] Empty HTML content after streaming`)
        return {
          ok: false,
          error: {
            code: 'EMPTY_RESPONSE',
            message: 'Server returned empty content',
          },
        }
      }

      clearTimeout(timeoutId)
      const totalTime = Date.now() - startTime
      if (DEBUG)
        console.log(
          `[fetchWithValidatedRedirects] Successfully fetched ${html.length} bytes in ${totalTime}ms from ${sanitizeUrlForLog(response.url || normalizedUrl)}`,
        )

      return {
        ok: true,
        html,
        finalUrl: response.url || normalizedUrl,
      }
    }
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error))
    const errWithCode = error as { code?: string }
    const totalTime = Date.now() - startTime
    console.error(`[fetchWithValidatedRedirects] Error after ${totalTime}ms:`, {
      name: err.name,
      message: err.message,
      code: errWithCode.code,
      stack: err.stack,
    })

    if (err.name === 'AbortError') {
      console.error(`[fetchWithValidatedRedirects] Request timeout after ${FETCH_TIMEOUT}ms`)
      return {
        ok: false,
        error: {
          code: 'TIMEOUT',
          message: `Request timed out after ${FETCH_TIMEOUT / 1000} seconds`,
          details: 'The server took too long to respond',
        },
      }
    }

    if (errWithCode.code === 'ENOTFOUND') {
      console.error(`[fetchWithValidatedRedirects] DNS error: Domain not found`)
      return {
        ok: false,
        error: {
          code: 'DNS_ERROR',
          message: 'Domain not found',
          details: 'Could not resolve hostname',
        },
      }
    }

    if (errWithCode.code === 'ECONNREFUSED') {
      console.error(`[fetchWithValidatedRedirects] Connection refused`)
      return {
        ok: false,
        error: {
          code: 'CONNECTION_REFUSED',
          message: 'Connection refused',
          details: 'Server refused the connection',
        },
      }
    }

    if (errWithCode.code === 'ECONNRESET') {
      console.error(`[fetchWithValidatedRedirects] Connection reset`)
      return {
        ok: false,
        error: {
          code: 'CONNECTION_RESET',
          message: 'Connection reset',
          details: 'Server closed the connection',
        },
      }
    }

    console.error(`[fetchWithValidatedRedirects] Unknown fetch error:`, err)
    return {
      ok: false,
      error: {
        code: 'FETCH_ERROR',
        message: err.message ? err.message : 'Failed to fetch URL',
        details: errWithCode.code != null ? String(errWithCode.code) : err.toString(),
      },
    }
  } finally {
    clearTimeout(timeoutId)
    // Release any sockets held by the pinned dispatcher regardless of how
    // the fetch loop exited (success, validation failure, thrown error,
    // early return for content-type / response-too-large, etc.).
    await closePinnedDispatcher(pinnedDispatcher, DEBUG)
  }
}
/* eslint-enable sonarjs/cognitive-complexity -- end of fetchWithValidatedRedirects */

/** @alias Backwards compatibility export for existing call sites. */
export const fetchUrlSafely = fetchWithValidatedRedirects

export const VALIDATION_CONSTANTS = {
  MAX_URL_LENGTH,
  MAX_REDIRECTS,
  FETCH_TIMEOUT,
  MAX_RESPONSE_SIZE,
}
