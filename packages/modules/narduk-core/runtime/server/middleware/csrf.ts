/**
 * CSRF protection middleware.
 *
 * Blocks state-changing requests (POST, PUT, PATCH, DELETE) that don't
 * include an `X-Requested-With` header. Since browsers prevent cross-origin
 * sites from setting custom headers, this blocks form-based CSRF attacks
 * while allowing XHR/fetch calls from our own frontend (which always send
 * custom headers).
 *
 * **SSR constraint:** This middleware runs on every request including
 * server-side `$fetch` calls during SSR. Mutations (POST/PUT/PATCH/DELETE)
 * should only happen in response to client-side user actions, never inside
 * `useAsyncData`/`useFetch` server passes. The layer's `fetch.client.ts`
 * plugin automatically injects the required header for all client-side
 * requests, and `useAppFetch()`/`useCsrfFetch()` also inject it
 * automatically. If you still see 403s, ensure you're using one of these
 * wrappers instead of raw `$fetch` for mutations.
 *
 * Skipped for:
 * - Non-mutating methods (GET, HEAD, OPTIONS)
 * - Webhook/external callback routes (`/api/webhooks/`, `/api/cron/`)
 * - Auth provider routes (`/api/_auth/`)
 * - Opt-in Nuxt Content internal queries (`/__nuxt_content/`)
 * - The configured CSP report sink (`nardukSecurityHeaders.reportRoute`)
 * - API key bearer auth (`Authorization: Bearer nk_...`)
 */
import { createError, defineEventHandler, getHeader } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'

import { DEFAULT_REPORT_ROUTE } from '../../shared/security-headers'
import { useLogger } from '../utils/logger'

function requestPathname(path: string): string {
  const query = path.indexOf('?')
  return query === -1 ? path : path.slice(0, query)
}

/**
 * Browser CSP reports are unauthenticated POSTs with no `X-Requested-With`.
 * The path is whatever `security.headers.reportRoute` resolved to — the
 * module writes that onto `runtimeConfig.nardukSecurityHeaders.reportRoute`
 * so this skip tracks a consumer override instead of a hardcoded literal.
 */
function configuredCspReportRoute(config: object): string | null {
  const headers = (config as { nardukSecurityHeaders?: { mode?: unknown; reportRoute?: unknown } })
    .nardukSecurityHeaders
  // No handler is registered when mode is `off` (the default). Skipping CSRF
  // for the fallback report path would exempt a 404.
  if (headers?.mode !== 'report-only' && headers?.mode !== 'enforce') return null
  const reportRoute = headers.reportRoute
  if (reportRoute === false) return null
  if (typeof reportRoute === 'string' && reportRoute.length > 0) return reportRoute
  return DEFAULT_REPORT_ROUTE
}

export default defineEventHandler((event) => {
  const method = event.method.toUpperCase()

  // Only protect state-changing methods
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return

  // Skip CSRF for routes that receive external POSTs (webhooks, cron, callbacks)
  // and for opt-in Nuxt Content query APIs (SSR has no browser header).
  const path = event.path
  if (
    path.startsWith('/api/webhooks/') ||
    path.startsWith('/api/cron/') ||
    path.startsWith('/api/callbacks/') ||
    path.startsWith('/api/_auth/') ||
    path.startsWith('/__nuxt_content/') ||
    path === '/api/owner-tag'
  ) {
    return
  }

  const reportRoute = configuredCspReportRoute(useRuntimeConfig(event))
  if (reportRoute && requestPathname(path) === reportRoute) return

  // Skip CSRF for API key bearer auth — not browser-based, not CSRF-vulnerable
  const authHeader = getHeader(event, 'authorization')
  if (authHeader?.startsWith('Bearer nk_')) return

  const xRequestedWith = getHeader(event, 'x-requested-with')

  if (!xRequestedWith) {
    const log = useLogger(event).child('Security')
    log.warn('CSRF blocked', { method, path })
    throw createError({
      statusCode: 403,
      message:
        'Forbidden: missing X-Requested-With header (CSRF protection). ' +
        "Use useCsrfFetch(), useAppFetch(), or add { headers: { 'X-Requested-With': 'XMLHttpRequest' } } manually.",
    })
  }
})
