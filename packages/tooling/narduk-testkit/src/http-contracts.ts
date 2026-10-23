/**
 * HTTP contracts a deployed Narduk app must keep: security headers and the
 * status codes of protected and unknown paths. Plain `fetch` and `Headers`
 * only, so a deploy smoke script runs it under bare Node with no Playwright,
 * no Vitest and no browser.
 *
 * Every check returns findings instead of throwing, so one run names every
 * broken contract; the `assert*` wrappers throw once with all of them.
 */

export interface ContractFinding {
  id: string
  message: string
}

/** A `Headers`, a plain record (any key case), or anything with `get`. */
export type HeadersLike = Headers | Record<string, string> | { get(name: string): string | null }

export interface SecurityHeaderOptions {
  /**
   * Whether this host serves real users. Required and never inferred from the
   * hostname: a staging host mistaken for production is exactly the case this
   * flag decides. A non-production host must send `X-Robots-Tag: noindex`.
   */
  production: boolean
  /**
   * The URL the headers came from. Decides whether HSTS applies: browsers
   * ignore it over plain `http:`, so it is skipped there (localhost). Left out,
   * the response is assumed to be https and HSTS is required.
   */
  url?: string | URL
  /** Minimum `Strict-Transport-Security` max-age, in seconds. Defaults to 180 days. */
  minHstsMaxAge?: number
  /**
   * Accept `Content-Security-Policy-Report-Only` as "a CSP exists" (default
   * true), the usual state while a policy is being rolled out. It never counts
   * towards `frame-ancestors`, which browsers ignore in a report-only policy.
   */
  allowReportOnlyCsp?: boolean
}

export const DEFAULT_MIN_HSTS_MAX_AGE = 15_552_000

const UNSAFE_REFERRER_POLICIES = new Set(['unsafe-url', 'no-referrer-when-downgrade'])

function headerValue(headers: HeadersLike, name: string): string | null {
  if (typeof (headers as { get?: unknown }).get === 'function') {
    return (headers as { get(name: string): string | null }).get(name)
  }
  const wanted = name.toLowerCase()
  for (const [key, value] of Object.entries(headers as Record<string, string>)) {
    if (key.toLowerCase() === wanted) return value
  }
  return null
}

/** `Headers.get` joins repeated headers with ", ", so a CSP value may hold several policies. */
function cspDirectives(policyHeader: string | null): Array<Map<string, string[]>> {
  if (!policyHeader) return []
  return policyHeader
    .split(',')
    .map((policy) => {
      const directives = new Map<string, string[]>()
      for (const part of policy.split(';')) {
        const [name, ...sources] = part.trim().split(/\s+/u)
        if (name) directives.set(name.toLowerCase(), sources)
      }
      return directives
    })
    .filter((policy) => policy.size > 0)
}

function hasEffectiveFrameAncestors(policies: Array<Map<string, string[]>>): boolean {
  return policies.some((policy) => {
    const sources = policy.get('frame-ancestors')
    // `frame-ancestors *` (or an empty list) restricts nothing.
    return sources !== undefined && sources.length > 0 && !sources.includes('*')
  })
}

function isHttpUrl(url: string | URL | undefined): boolean {
  if (url === undefined) return false
  try {
    return new URL(url).protocol === 'http:'
  } catch {
    return false
  }
}

/**
 * Judge a response's headers against the estate's security-header contract.
 * Pure: it never fetches, so it covers a recorded response as readily as a
 * live one.
 */
export function securityHeaderFindings(
  headers: HeadersLike,
  options: SecurityHeaderOptions,
): ContractFinding[] {
  const findings: ContractFinding[] = []
  const minMaxAge = options.minHstsMaxAge ?? DEFAULT_MIN_HSTS_MAX_AGE
  const allowReportOnly = options.allowReportOnlyCsp ?? true

  if (!isHttpUrl(options.url)) {
    const hsts = headerValue(headers, 'strict-transport-security')
    if (!hsts) {
      findings.push({ id: 'hsts', message: 'Strict-Transport-Security is missing.' })
    } else {
      const maxAge = /max-age\s*=\s*"?(\d+)"?/iu.exec(hsts)?.[1]
      if (maxAge === undefined) {
        findings.push({
          id: 'hsts',
          message: `Strict-Transport-Security has no max-age: "${hsts}".`,
        })
      } else if (Number(maxAge) < minMaxAge) {
        findings.push({
          id: 'hsts',
          message: `Strict-Transport-Security max-age ${maxAge} is below ${minMaxAge}.`,
        })
      }
    }
  }

  const enforcedCsp = headerValue(headers, 'content-security-policy')
  const reportOnlyCsp = headerValue(headers, 'content-security-policy-report-only')
  if (!enforcedCsp) {
    if (!reportOnlyCsp) {
      findings.push({ id: 'csp', message: 'Content-Security-Policy is missing.' })
    } else if (!allowReportOnly) {
      findings.push({
        id: 'csp',
        message: 'Only Content-Security-Policy-Report-Only is set; it does not enforce anything.',
      })
    }
  }

  const frameOptions = (headerValue(headers, 'x-frame-options') ?? '')
    .split(',')
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean)
  const framingBlocked =
    hasEffectiveFrameAncestors(cspDirectives(enforcedCsp)) ||
    (frameOptions.length > 0 &&
      frameOptions.every((value) => value === 'DENY' || value === 'SAMEORIGIN'))
  if (!framingBlocked) {
    findings.push({
      id: 'clickjacking',
      message:
        'Nothing blocks framing: send frame-ancestors in an enforced Content-Security-Policy ' +
        '(a Report-Only policy is ignored for it) or X-Frame-Options DENY/SAMEORIGIN.',
    })
  }

  const nosniff = headerValue(headers, 'x-content-type-options')
  if (nosniff?.trim().toLowerCase() !== 'nosniff') {
    findings.push({ id: 'nosniff', message: 'X-Content-Type-Options: nosniff is missing.' })
  }

  const referrer = headerValue(headers, 'referrer-policy')
  // A comma list is a fallback chain; the browser applies the last value it knows.
  const effectiveReferrer = referrer?.split(',').at(-1)?.trim().toLowerCase()
  if (!effectiveReferrer) {
    findings.push({ id: 'referrer-policy', message: 'Referrer-Policy is missing.' })
  } else if (UNSAFE_REFERRER_POLICIES.has(effectiveReferrer)) {
    findings.push({
      id: 'referrer-policy',
      message: `Referrer-Policy "${effectiveReferrer}" sends full URLs to other origins.`,
    })
  }

  if (!options.production) {
    const robots = (headerValue(headers, 'x-robots-tag') ?? '').toLowerCase()
    if (!/\b(?:noindex|none)\b/u.test(robots)) {
      findings.push({
        id: 'robots-noindex',
        message: 'A non-production host must send X-Robots-Tag: noindex.',
      })
    }
  }

  return findings
}

export function formatContractFindings(subject: string, findings: readonly ContractFinding[]) {
  return `${subject}: ${findings.length} contract finding(s)\n${findings
    .map((finding) => `  [${finding.id}] ${finding.message}`)
    .join('\n')}`
}

/** Throw one error listing every security-header finding. */
export function assertSecurityHeaders(headers: HeadersLike, options: SecurityHeaderOptions): void {
  const findings = securityHeaderFindings(headers, options)
  if (findings.length > 0) {
    throw new Error(formatContractFindings('Security headers', findings))
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface CheckSecurityHeadersOptions extends Omit<SecurityHeaderOptions, 'url'> {
  /** Injectable for tests and for callers that need a custom dispatcher. */
  fetch?: FetchLike
}

/** Release the connection; a deploy smoke should not hold sockets open on bodies it never reads. */
async function discardBody(response: Response) {
  await response.body?.cancel().catch(() => {})
}

/**
 * Fetch `url` without following redirects and judge its headers. A redirect is
 * judged as the redirect it is, so point this at a URL that answers directly.
 */
export async function checkSecurityHeaders(
  url: string,
  options: CheckSecurityHeadersOptions,
): Promise<ContractFinding[]> {
  const doFetch = options.fetch ?? fetch
  const response = await doFetch(url, { redirect: 'manual' })
  await discardBody(response)
  return securityHeaderFindings(response.headers, { ...options, url })
}

export interface StatusContractOptions {
  /** An API path that needs a session, e.g. `/api/orders`. Must start with `/api/`. */
  protectedApiPath: string
  /** A path that exists nowhere. Defaults to a random `/__narduk-status-contract-<id>`. */
  unknownPath?: string
  /** Injectable for tests. */
  fetch?: FetchLike
}

function isRedirect(response: Response): boolean {
  return response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)
}

function isJsonContentType(contentType: string | null): boolean {
  const mediaType = contentType?.split(';')[0]?.trim().toLowerCase() ?? ''
  return mediaType === 'application/json' || /^application\/[^/]+\+json$/u.test(mediaType)
}

function describeResponse(response: Response): string {
  const location = response.headers.get('location')
  return location ? `${response.status} to ${location}` : `${response.status}`
}

/**
 * Check that unauthenticated callers get status codes a client can act on: 401
 * with JSON for a protected API path, 404 for an unknown one. Requests use
 * `redirect: 'manual'`; a followed redirect would surface as the sign-in page's
 * 200 and hide the defect this exists to catch.
 */
export async function checkStatusContract(
  baseUrl: string,
  options: StatusContractOptions,
): Promise<ContractFinding[]> {
  if (!options.protectedApiPath.startsWith('/api/')) {
    throw new Error(`protectedApiPath must start with /api/, got "${options.protectedApiPath}".`)
  }
  const unknownPath =
    options.unknownPath ?? `/__narduk-status-contract-${crypto.randomUUID().replaceAll('-', '')}`
  if (!unknownPath.startsWith('/')) {
    throw new Error(`unknownPath must start with /, got "${unknownPath}".`)
  }
  const doFetch = options.fetch ?? fetch
  const findings: ContractFinding[] = []

  // Accept headers match what each caller is: an API client and a browser navigation.
  const api = await doFetch(new URL(options.protectedApiPath, baseUrl).href, {
    headers: { accept: 'application/json' },
    redirect: 'manual',
  })
  await discardBody(api)
  if (isRedirect(api)) {
    findings.push({
      id: 'protected-api-redirect',
      message: `${options.protectedApiPath} answered ${describeResponse(api)} instead of 401; an API client cannot act on a redirect to a sign-in page.`,
    })
  } else if (api.status !== 401) {
    findings.push({
      id: 'protected-api-status',
      message: `${options.protectedApiPath} answered ${api.status} without a session; expected 401.`,
    })
  } else if (!isJsonContentType(api.headers.get('content-type'))) {
    findings.push({
      id: 'protected-api-content-type',
      message: `${options.protectedApiPath} answered 401 with content-type "${api.headers.get('content-type') ?? ''}"; expected JSON.`,
    })
  }

  const unknown = await doFetch(new URL(unknownPath, baseUrl).href, {
    headers: { accept: 'text/html' },
    redirect: 'manual',
  })
  await discardBody(unknown)
  if (isRedirect(unknown)) {
    findings.push({
      id: 'unknown-path-redirect',
      message: `${unknownPath} answered ${describeResponse(unknown)} instead of 404; unknown paths must not bounce to sign-in.`,
    })
  } else if (unknown.status !== 404) {
    findings.push({
      id: 'unknown-path-status',
      message: `${unknownPath} answered ${unknown.status}; expected 404.`,
    })
  }

  return findings
}

/** Throw one error listing every status-contract finding. */
export async function assertStatusContract(
  baseUrl: string,
  options: StatusContractOptions,
): Promise<void> {
  const findings = await checkStatusContract(baseUrl, options)
  if (findings.length > 0) {
    throw new Error(formatContractFindings(`Status contract for ${baseUrl}`, findings))
  }
}
