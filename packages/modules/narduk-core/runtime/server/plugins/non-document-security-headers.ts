import { defineNitroPlugin, useRuntimeConfig } from 'nitropack/runtime'

import { isWebResponseLike } from '../../shared/utils/shared-cache'
import { nonDocumentSecurityHeaders } from '../non-document-security-headers'

import type { H3Event } from 'h3'

/**
 * The `security.headers` preset's `Permissions-Policy` and CSP on responses
 * the Nuxt renderer never produces: API JSON, the sitemap, robots
 * (narduk-libs#1216).
 *
 * nuxt-security sets both only in `render:response`, and the legacy
 * `securityHeaders` middleware stops emitting them once the preset owns them,
 * so without this a Nitro handler serves neither.
 *
 * ## What it writes, and when it stays out of the way
 *
 * - `report-only`: `Permissions-Policy` only. The legacy middleware's CSP
 *   still enforces and nuxt-security's strict one only reports, so a second
 *   enforcing CSP would change what the soak measures.
 * - `enforce`: `Permissions-Policy` and the preset CSP minus its nonce source.
 * - Nothing on an HTML response. A rendered page gets its headers, or
 *   deliberately none, from nuxt-security and its route rules: a route with
 *   `security.enabled: false` or `contentSecurityPolicy: false` must not
 *   inherit a nonce-free `'strict-dynamic'` CSP that blocks its scripts, and a
 *   handler that returns HTML is treated the same way.
 * - Nothing over a header that is already set, so a `routeRules` header or a
 *   handler's own value wins.
 * - Nothing once headers are sent (a stream).
 *
 * ## Hook
 *
 * `beforeResponse`, like `default-private-cache`: it is the only hook an API
 * route reaches. h3 has not yet written the JSON content type at that point,
 * so HTML is recognised by an explicit `text/html` content type, by a returned
 * web `Response`'s own content type, or by a string body that starts with `<`.
 */

type SecurityHeadersMode = 'enforce' | 'off' | 'report-only'

interface NodeResponseLike {
  getHeader?: (name: string) => unknown
  headersSent?: boolean
  setHeader?: (name: string, value: string) => void
  writableEnded?: boolean
}

function readMode(config: object): SecurityHeadersMode {
  const mode = (config as { nardukSecurityHeaders?: { mode?: unknown } }).nardukSecurityHeaders
    ?.mode
  return mode === 'report-only' || mode === 'enforce' ? mode : 'off'
}

function isHtml(read: (name: string) => unknown, body: unknown): boolean {
  if (isWebResponseLike(body)) {
    return (body.headers.get('content-type') ?? '').includes('html')
  }
  const type = read('content-type')
  if (type !== undefined && type !== null && type !== '') return String(type).includes('html')
  return typeof body === 'string' && body.trimStart().startsWith('<')
}

function isSet(value: unknown): boolean {
  return value !== undefined && value !== null && value !== ''
}

/**
 * Write the preset's non-document headers onto `event` when they apply (see
 * the file header). Returns the header names it wrote.
 */
export function applyNonDocumentSecurityHeaders(
  event: H3Event,
  body: unknown,
  mode: SecurityHeadersMode,
  presetHeaders: unknown,
): string[] {
  if (mode === 'off') return []
  const res = event.node?.res as NodeResponseLike | undefined
  if (!res?.getHeader || !res.setHeader) return []
  if (res.headersSent === true || res.writableEnded === true) return []
  if (isHtml((name) => res.getHeader?.(name), body)) return []

  const headers = nonDocumentSecurityHeaders(presetHeaders)
  const written: string[] = []
  for (const [name, value] of Object.entries(headers)) {
    if (mode === 'report-only' && name === 'Content-Security-Policy') continue
    if (isSet(res.getHeader(name))) continue
    if (isWebResponseLike(body) && isSet(body.headers.get(name))) continue
    res.setHeader(name, value)
    written.push(name)
  }
  return written
}

export default defineNitroPlugin((nitro) => {
  let resolved: { headers: unknown; mode: SecurityHeadersMode } | undefined
  nitro.hooks.hook('beforeResponse', (event, response) => {
    // The preset is fixed at build time, so it is read once per isolate.
    if (!resolved) {
      const config = useRuntimeConfig() as { security?: { headers?: unknown } }
      resolved = { mode: readMode(config), headers: config.security?.headers }
    }
    applyNonDocumentSecurityHeaders(
      event,
      (response as { body?: unknown } | undefined)?.body,
      resolved.mode,
      resolved.headers,
    )
  })
})
