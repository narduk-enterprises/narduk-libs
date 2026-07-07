/**
 * CORS middleware — configurable cross-origin request handling.
 *
 * Reads allowed origins from `runtimeConfig.corsAllowedOrigins` (comma-separated string).
 * Defaults to same-origin only (no CORS headers added) when unconfigured.
 *
 * Handles:
 * - Preflight OPTIONS requests with 204 No Content
 * - Access-Control-Allow-Origin (exact origin matching, no wildcards)
 * - Access-Control-Allow-Methods (GET, POST, PUT, PATCH, DELETE, OPTIONS)
 * - Access-Control-Allow-Headers (Content-Type, Authorization, X-Requested-With)
 * - Access-Control-Max-Age (86400s / 24h cache for preflight responses)
 *
 * Skipped for:
 * - Non-API routes (only applies to /api/* paths)
 * - Same-origin requests (no Origin header)
 */
import { defineEventHandler, getHeader, setResponseHeaders, setResponseStatus } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'

export default defineEventHandler((event) => {
  const path = event.path

  // Only apply CORS to API routes
  if (!path.startsWith('/api/')) return

  const origin = getHeader(event, 'origin')
  if (!origin) return // Same-origin request — no CORS needed

  const isBrowserExtensionOrigin =
    origin.startsWith('chrome-extension://') || origin.startsWith('moz-extension://')
  const isScraperExtensionRoute = path.startsWith('/api/admin/scraper-extension/')
  const allowScraperExtensionOrigin = isScraperExtensionRoute && isBrowserExtensionOrigin

  // Read allowed origins from runtime config
  const config = useRuntimeConfig(event)
  const allowedOriginsRaw = (config as Record<string, unknown>).corsAllowedOrigins as
    string | undefined

  const allowedOrigins = allowedOriginsRaw
    ? allowedOriginsRaw
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean)
    : []

  // Exact origin matching — no wildcard. Scraper extension routes allow browser
  // extension origins so machine auth can survive ambient cookies and preflights.
  if (!allowScraperExtensionOrigin && !allowedOrigins.includes(origin)) return

  // Set CORS headers
  setResponseHeaders(event, {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  })

  // Handle preflight
  if (event.method === 'OPTIONS') {
    setResponseStatus(event, 204)
    return ''
  }
})
