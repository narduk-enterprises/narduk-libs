/**
 * Item 9 -- security-headers (narduk-core `security.headers`, company-hq#745).
 *
 * Not one of the seven ratified D-WEBFOUND-2 Q9 (a) items, for the same reason
 * item 8 is not: `foundation-check.json` is the exact contract company-hq's
 * `check-web-foundation.py` validates, `FOUNDATION_ITEM_COUNT` is 7, and an
 * `id` outside `1..7` is a rollup-red F3 ARTEFACT finding. It is invoked by
 * `foundation:check:security-headers` and writes its own one-item artefact.
 *
 * WHAT MAKES THIS ITEM DIFFERENT FROM 1-8
 * ---------------------------------------
 * Every other item decides from the app's own files. This one cannot: a
 * response header is produced by a running server, and a repository can
 * describe a policy it does not actually serve. Cloudflare's Transform Rules
 * can add or strip a header the Worker never wrote, and a CDN in front can do
 * the same. So this item is a LIVE probe against a base URL and has no
 * filesystem verdict at all. No base URL means `unknown`, never `pass` --
 * "we did not look" is not evidence of absence, and it is not evidence of
 * presence either.
 *
 * VERDICTS
 * --------
 *   pass            proven: the header is present and says the right thing.
 *   fail            gap: the response was read and the header is absent or weak.
 *   unknown         the response could not be read, so nothing is decided.
 *   not-applicable  never used here; every probed route owes every header.
 */

import { check } from '../schema.js'
import {
  STATUS_FAIL,
  STATUS_PASS,
  STATUS_UNKNOWN,
  type FoundationSubCheck,
} from '../types.js'

/** What the probe managed to read back from one route. */
export interface ProbedRoute {
  url: string
  /** Lowercased header names to values. Absent when the request failed. */
  headers?: Record<string, string>
  status?: number
  error?: string
}

export type CspMode = 'enforce' | 'report-only' | 'absent'

export interface CspAssessment {
  mode: CspMode
  /** The policy actually assessed -- the enforcing one when there is one. */
  policy: string
  directives: Record<string, string[]>
}

const CSP_HEADER = 'content-security-policy'
const CSP_REPORT_ONLY_HEADER = 'content-security-policy-report-only'

export function parseCspDirectives(policy: string): Record<string, string[]> {
  const directives: Record<string, string[]> = {}
  for (const part of policy.split(';')) {
    const tokens = part.trim().split(/\s+/).filter(Boolean)
    const name = tokens.shift()?.toLowerCase()
    if (name) directives[name] = tokens
  }
  return directives
}

/**
 * Which CSP a browser would actually enforce. An enforcing header always wins
 * the assessment: during the `security.headers` soak a route serves BOTH, and
 * reading the report-only one as though it were in force would report a
 * strictness the browser is not applying.
 */
export function assessCsp(headers: Record<string, string>): CspAssessment {
  const enforcing = headers[CSP_HEADER]
  const reportOnly = headers[CSP_REPORT_ONLY_HEADER]
  if (enforcing) {
    return { mode: 'enforce', policy: enforcing, directives: parseCspDirectives(enforcing) }
  }
  if (reportOnly) {
    return { mode: 'report-only', policy: reportOnly, directives: parseCspDirectives(reportOnly) }
  }
  return { mode: 'absent', policy: '', directives: {} }
}

function scriptSources(assessment: CspAssessment): string[] {
  // A missing script-src falls back to default-src, exactly as a browser does.
  return assessment.directives['script-src'] ?? assessment.directives['default-src'] ?? []
}

function hasNonce(sources: readonly string[]): boolean {
  return sources.some((source) => source.startsWith("'nonce-"))
}

function maxAgeSeconds(value: string): number | null {
  const match = /max-age\s*=\s*"?(\d+)"?/i.exec(value)
  return match ? Number(match[1]) : null
}

/** Six months. Shorter than this and a stripped-TLS window reopens quickly. */
const MIN_HSTS_MAX_AGE = 15_552_000

function unreadable(route: ProbedRoute): FoundationSubCheck[] {
  const reason = route.error ?? `HTTP ${route.status ?? 'unknown'}`
  return [
    check(
      '9.0',
      'base URL responds',
      STATUS_UNKNOWN,
      `${route.url} could not be read (${reason}) -- no header verdict is possible`,
      route.url,
    ),
  ]
}

/**
 * Evaluate ONE probed route. `evaluateItem9` folds several of these together;
 * keeping the per-route logic separate is what lets the tests state a header
 * set literally instead of standing up a server.
 */
export function evaluateProbedRoute(route: ProbedRoute, prefix: string): FoundationSubCheck[] {
  if (!route.headers) return unreadable(route)
  const headers = route.headers
  const csp = assessCsp(headers)
  const checks: FoundationSubCheck[] = []

  checks.push(
    check(
      `${prefix}.0`,
      'base URL responds',
      STATUS_PASS,
      `${route.url} answered HTTP ${route.status}`,
      route.url,
    ),
  )

  checks.push(
    csp.mode === 'enforce'
      ? check(
          `${prefix}.1`,
          'Content-Security-Policy is enforcing',
          STATUS_PASS,
          headers[CSP_REPORT_ONLY_HEADER]
            ? 'an enforcing policy is served, and a second policy is in report-only alongside it ' +
                '-- a `security.headers` soak is in progress'
            : 'an enforcing policy is served',
          csp.policy,
        )
      : csp.mode === 'report-only'
        ? check(
            `${prefix}.1`,
            'Content-Security-Policy is enforcing',
            STATUS_FAIL,
            'only Content-Security-Policy-Report-Only is served, so nothing is enforced -- ' +
              'set `security.headers.enforce` once the soak is clean',
            csp.policy,
          )
        : check(
            `${prefix}.1`,
            'Content-Security-Policy is enforcing',
            STATUS_FAIL,
            'no Content-Security-Policy header of either kind',
          ),
  )

  if (csp.mode === 'absent') {
    checks.push(
      check(
        `${prefix}.2`,
        'enforced script-src uses a nonce',
        STATUS_FAIL,
        'there is no policy to assess',
      ),
    )
  } else {
    const sources = scriptSources(csp)
    const weaknesses = sources.filter(
      (source) => source === "'unsafe-inline'" || source === "'unsafe-eval'",
    )
    // `'strict-dynamic'` makes a conforming browser ignore `'unsafe-inline'`,
    // so a policy carrying all three is stricter than it reads. Say so rather
    // than failing it on a token that has no effect.
    const neutralized = sources.includes("'strict-dynamic'")
    checks.push(
      hasNonce(sources) && (weaknesses.length === 0 || neutralized)
        ? check(
            `${prefix}.2`,
            'enforced script-src uses a nonce',
            STATUS_PASS,
            weaknesses.length === 0
              ? `${csp.mode} script-src is nonce-based with no unsafe-* source`
              : `${csp.mode} script-src is nonce-based; ${weaknesses.join(' and ')} is ` +
                'present but ignored by a browser honouring strict-dynamic',
            sources.join(' '),
          )
        : check(
            `${prefix}.2`,
            'enforced script-src uses a nonce',
            STATUS_FAIL,
            hasNonce(sources)
              ? `${csp.mode} script-src carries ${weaknesses.join(' and ')} beside its nonce, ` +
                'which defeats it'
              : `${csp.mode} script-src has no nonce source` +
                (weaknesses.length > 0 ? ` and allows ${weaknesses.join(' and ')}` : ''),
            sources.join(' ') || '(no script-src or default-src)',
          ),
    )
  }

  const hsts = headers['strict-transport-security']
  const hstsAge = hsts ? maxAgeSeconds(hsts) : null
  checks.push(
    !hsts
      ? check(
          `${prefix}.3`,
          'Strict-Transport-Security',
          STATUS_FAIL,
          'absent -- a first plain-HTTP request stays interceptable',
        )
      : hstsAge !== null && hstsAge >= MIN_HSTS_MAX_AGE
        ? check(`${prefix}.3`, 'Strict-Transport-Security', STATUS_PASS, hsts, hsts)
        : check(
            `${prefix}.3`,
            'Strict-Transport-Security',
            STATUS_FAIL,
            `max-age is ${hstsAge ?? 'unparseable'}; at least ${MIN_HSTS_MAX_AGE} is expected`,
            hsts,
          ),
  )

  const frameAncestors = csp.directives['frame-ancestors']
  const xFrameOptions = headers['x-frame-options']
  checks.push(
    frameAncestors || xFrameOptions
      ? check(
          `${prefix}.4`,
          'framing is restricted',
          STATUS_PASS,
          frameAncestors
            ? `frame-ancestors ${frameAncestors.join(' ')}`
            : `X-Frame-Options: ${xFrameOptions}`,
          frameAncestors?.join(' ') ?? xFrameOptions,
        )
      : check(
          `${prefix}.4`,
          'framing is restricted',
          STATUS_FAIL,
          'neither a frame-ancestors directive nor an X-Frame-Options header',
        ),
  )

  for (const [id, header, name] of [
    [`${prefix}.5`, 'referrer-policy', 'Referrer-Policy'],
    [`${prefix}.6`, 'permissions-policy', 'Permissions-Policy'],
  ] as const) {
    const value = headers[header]
    checks.push(
      value
        ? check(id, name, STATUS_PASS, value, value)
        : check(id, name, STATUS_FAIL, 'absent'),
    )
  }

  const nosniff = headers['x-content-type-options']
  checks.push(
    nosniff?.toLowerCase() === 'nosniff'
      ? check(`${prefix}.7`, 'X-Content-Type-Options', STATUS_PASS, 'nosniff', nosniff)
      : check(
          `${prefix}.7`,
          'X-Content-Type-Options',
          STATUS_FAIL,
          nosniff ? `is ${JSON.stringify(nosniff)}, not "nosniff"` : 'absent',
        ),
  )

  return checks
}

/**
 * Fold every probed route into one sub-check list. Sub-check ids are `9.N.M`
 * beyond the first route so a multi-route probe stays readable; the single
 * route case keeps the plain `9.M` ids items 1-8 use.
 */
export function evaluateItem9(routes: readonly ProbedRoute[]): FoundationSubCheck[] {
  if (routes.length === 0) {
    return [
      check(
        '9.0',
        'base URL responds',
        STATUS_UNKNOWN,
        'no base URL was given -- pass --base-url https://app.example to probe a deployment',
      ),
    ]
  }
  if (routes.length === 1) return evaluateProbedRoute(routes[0]!, '9')
  return routes.flatMap((route, index) => evaluateProbedRoute(route, `9.${index + 1}`))
}
