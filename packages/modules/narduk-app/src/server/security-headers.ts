import { getRequestProtocol, setResponseHeaders } from 'h3'

import type { H3Event } from 'h3'

/** A Content-Security-Policy as `directive -> sources`; an empty list emits the bare directive. */
export type CspDirectives = Readonly<Record<string, readonly string[]>>

/** A Permissions-Policy as `feature -> allowlist`; `[]` is `feature=()`, `['self']` is `feature=(self)`. */
export type PermissionsPolicy = Readonly<Record<string, readonly string[]>>

export interface SecurityHeadersConfig {
  /**
   * Served as `Content-Security-Policy-Report-Only`, never enforced. The app
   * supplies every allowlist; nothing is granted by default.
   */
  reportOnlyCsp?: CspDirectives
  /** `X-Frame-Options`. Defaults to `DENY`. */
  frameOptions?: 'DENY' | 'SAMEORIGIN'
  /** `Referrer-Policy`. Defaults to `strict-origin-when-cross-origin`. */
  referrerPolicy?: string
  /** `Permissions-Policy`. Omitted when absent. */
  permissionsPolicy?: PermissionsPolicy
  /** `Strict-Transport-Security`, sent on https only. `false` turns it off. Defaults to one year with subdomains. */
  hsts?: false | { maxAgeSeconds?: number; includeSubDomains?: boolean }
  /** `X-Robots-Tag` value, e.g. `noindex, nofollow`. Omitted when absent. */
  robots?: string
}

export function serializeCsp(directives: CspDirectives): string {
  return Object.entries(directives)
    .map(([name, sources]) => [name, ...sources].join(' '))
    .join('; ')
}

export function serializePermissionsPolicy(policy: PermissionsPolicy): string {
  return Object.entries(policy)
    .map(([feature, allowlist]) => `${feature}=(${allowlist.join(' ')})`)
    .join(', ')
}

const ONE_YEAR_SECONDS = 31_536_000

/**
 * The baseline response headers for one request, lower-cased. Pure: the app
 * resolves per-request differences (a framed route, a dev-only source) into
 * the config it passes.
 *
 * Set them early in the request (a Nitro `request` hook), so a route that sets
 * one of these headers deliberately replaces the baseline value.
 */
export function buildSecurityHeaders(
  config: SecurityHeadersConfig,
  request: { https: boolean },
): Record<string, string> {
  const headers: Record<string, string> = {
    'x-content-type-options': 'nosniff',
    'x-frame-options': config.frameOptions ?? 'DENY',
    'referrer-policy': config.referrerPolicy ?? 'strict-origin-when-cross-origin',
  }
  if (config.permissionsPolicy) {
    headers['permissions-policy'] = serializePermissionsPolicy(config.permissionsPolicy)
  }
  if (config.reportOnlyCsp) {
    headers['content-security-policy-report-only'] = serializeCsp(config.reportOnlyCsp)
  }
  if (request.https && config.hsts !== false) {
    const maxAge = config.hsts?.maxAgeSeconds ?? ONE_YEAR_SECONDS
    const includeSubDomains = config.hsts?.includeSubDomains ?? true
    headers['strict-transport-security'] =
      `max-age=${maxAge}${includeSubDomains ? '; includeSubDomains' : ''}`
  }
  if (config.robots) headers['x-robots-tag'] = config.robots
  return headers
}

/** {@link buildSecurityHeaders} applied to an h3 event, https read from the request. */
export function applySecurityHeaders(event: H3Event, config: SecurityHeadersConfig): void {
  setResponseHeaders(
    event,
    buildSecurityHeaders(config, { https: getRequestProtocol(event) === 'https' }),
  )
}
