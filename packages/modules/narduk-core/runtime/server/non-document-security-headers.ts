/**
 * The document-only security headers, restated for every response the Nuxt
 * renderer does not produce: API JSON, the sitemap, robots, 404s.
 *
 * WHY THIS EXISTS
 * ---------------
 * With narduk-core's `security.headers` preset on `enforce`, nuxt-security
 * owns the header set. It classifies `Permissions-Policy` and
 * `Content-Security-Policy` as document headers and sets them only in the
 * `render:response` hook (`70-securityHeaders`), which fires for Nuxt-rendered
 * pages and never for a Nitro handler. narduk-core's legacy middleware, which
 * used to put both on every response, stops emitting them in `enforce` mode.
 * Left alone, `/api/*`, `/robots.txt` and `/sitemap.xml` lose both headers.
 *
 * The values come from `runtimeConfig.security.headers`, the same resolved
 * policy nuxt-security serves on pages, so nothing here restates a host list.
 * The CSP drops the `'nonce-{{nonce}}'` source because only the renderer mints
 * a nonce; with `'strict-dynamic'` and no nonce a non-document response
 * authorises no script at all, which is what JSON wants.
 *
 * On a page the renderer runs later and overwrites both headers with the
 * nonced policy, so a document never carries this copy.
 *
 * SHAPE GUARD
 * -----------
 * The runtime config shape belongs to nuxt-security and narduk-core, and a
 * dependency bump may change it. Anything this file does not recognise (a CSP
 * that is not a plain object of string, string-array or boolean values, or a
 * Permissions-Policy value that is not a string, string array or `false`)
 * falls back to a fixed restrictive header rather than serialising garbage or
 * dropping the header. `false` or an absent policy still means "the preset
 * serves none", and then nothing is set.
 *
 * First shipped app-side in riverstatus#243 and copied into borderwaitstat-us,
 * lakestat-us and gonogo; it moved here for narduk-libs#1216. Those copies can
 * be deleted once the app is on a narduk-core that has this file.
 */

type CspValue = readonly string[] | string | boolean
type PermissionsValue = readonly string[] | string | false

export interface DocumentHeaderPolicy {
  contentSecurityPolicy?: Record<string, CspValue> | false
  permissionsPolicy?: Record<string, PermissionsValue> | false
}

/** Served when the preset's CSP has a shape this file does not recognise. */
export const FALLBACK_CSP =
  "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none';"

/** Served when the preset's Permissions-Policy has an unrecognised shape. */
export const FALLBACK_PERMISSIONS_POLICY =
  'camera=(), microphone=(), geolocation=(), payment=(), usb=()'

const NONCE_SOURCE = /^'nonce-/u

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

function isCspPolicy(value: unknown): value is Record<string, CspValue> {
  return (
    isPlainObject(value) &&
    Object.values(value).every(
      (entry) => typeof entry === 'string' || typeof entry === 'boolean' || isStringArray(entry),
    )
  )
}

function isPermissionsPolicy(value: unknown): value is Record<string, PermissionsValue> {
  return (
    isPlainObject(value) &&
    Object.values(value).every(
      (entry) => entry === false || typeof entry === 'string' || isStringArray(entry),
    )
  )
}

/** Serialise a CSP object the way nuxt-security does, minus nonce sources. */
export function serializeNonDocumentCsp(policy: Record<string, CspValue>): string {
  return Object.entries(policy)
    .flatMap(([directive, value]) => {
      if (value === false) return []
      if (value === true) return [`${directive};`]
      const sources = (typeof value === 'string' ? value.split(/\s+/u) : [...value])
        .map((source) => source.trim())
        .filter((source) => source && !NONCE_SOURCE.test(source))
      return [`${directive} ${sources.join(' ')};`]
    })
    .join(' ')
}

/** Serialise a Permissions-Policy object the way nuxt-security does. */
export function serializePermissionsPolicy(policy: Record<string, PermissionsValue>): string {
  return Object.entries(policy)
    .flatMap(([feature, value]) => {
      if (value === false) return []
      return [typeof value === 'string' ? `${feature}=${value}` : `${feature}=(${value.join(' ')})`]
    })
    .join(', ')
}

/** The two headers to set, or none when the preset serves neither. */
export function nonDocumentSecurityHeaders(headers: unknown): Record<string, string> {
  const result: Record<string, string> = {}
  if (headers === undefined || headers === null || headers === false) return result
  if (!isPlainObject(headers)) {
    return {
      'Content-Security-Policy': FALLBACK_CSP,
      'Permissions-Policy': FALLBACK_PERMISSIONS_POLICY,
    }
  }

  const csp = headers.contentSecurityPolicy
  if (csp !== undefined && csp !== false) {
    const serialized = isCspPolicy(csp) ? serializeNonDocumentCsp(csp) : ''
    result['Content-Security-Policy'] = serialized || FALLBACK_CSP
  }

  const permissions = headers.permissionsPolicy
  if (permissions !== undefined && permissions !== false) {
    const serialized = isPermissionsPolicy(permissions)
      ? serializePermissionsPolicy(permissions)
      : ''
    result['Permissions-Policy'] = serialized || FALLBACK_PERMISSIONS_POLICY
  }
  return result
}
