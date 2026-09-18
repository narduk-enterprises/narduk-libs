/**
 * Legacy security headers middleware.
 *
 * Sets standard security headers on every response to protect against
 * common web vulnerabilities. These supplement Cloudflare's built-in
 * protections with application-level defense-in-depth.
 *
 * WHAT `security.headers` DOES TO THIS FILE
 * -----------------------------------------
 * This middleware predates the `security.headers` preset and, because
 * `addServerScanDir` registers it for every app on the module's default
 * `server: true`, its output is what every fleet app serves today. Turning the
 * preset on hands ownership of each header to nuxt-security in stages rather
 * than all at once (`runtime/shared/security-headers.ts` has the full
 * rationale):
 *
 *   'off'          everything below, byte-for-byte as before. The default.
 *   'report-only'  the enforcing CSP below stays, because the strict policy is
 *                  only being *reported* on and something has to still enforce.
 *                  Every other header comes from nuxt-security, so this file
 *                  stops emitting its duplicates.
 *   'enforce'      only the X-*-Version / X-Build-Time diagnostics, which
 *                  nuxt-security knows nothing about. Serving two enforcing
 *                  CSP headers would make the browser intersect them, which is
 *                  miserable to debug and buys nothing.
 */
import { defineEventHandler, setResponseHeaders } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'

import { readRuntimeBoolean, readRuntimeString } from '../utils/runtime-env'

import type { SecurityHeadersMode } from '../../shared/security-headers'

const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com'

const BASELINE_SCRIPT_SRC = [
  "'self'",
  "'unsafe-inline'",
  "'unsafe-eval'",
  'https://*.googletagmanager.com',
  DEFAULT_POSTHOG_HOST,
  'https://us-assets.i.posthog.com',
  'https://static.cloudflareinsights.com',
  'https://cdn.apple-mapkit.com',
  'https://pagead2.googlesyndication.com',
]

const BASELINE_CONNECT_SRC = [
  "'self'",
  'https://*.google-analytics.com',
  'https://*.analytics.google.com',
  'https://*.googletagmanager.com',
  // GA4's Google-signals feature sends a second page_view beacon straight to
  // https://www.google.com/g/collect (not a *.google-analytics.com host).
  // A property with Google signals off never sends this beacon and does not
  // need this host (issue #472; shared/security-headers.ts BASELINE_ALLOWLIST
  // carries the matching entry and the full doc citation).
  'https://www.google.com',
  DEFAULT_POSTHOG_HOST,
  'https://us-assets.i.posthog.com',
  'https://*.apple-mapkit.com',
  'https://*.apple.com',
]

const DEV_CONNECT_SRC = ['http:', 'https:', 'ws:', 'wss:']

/** Libraries that bundle workers (maps, PDF, wasm helpers) often use blob: URLs. */
const BASELINE_WORKER_SRC = ["'self'", 'blob:']

function parseCspSources(value: string | undefined): string[] {
  if (!value) return []

  return value
    .split(',')
    .map((source) => source.trim())
    .filter(Boolean)
}

function mergeCspSources(...groups: ReadonlyArray<readonly string[]>): string[] {
  return Array.from(new Set(groups.flatMap((group) => group)))
}

function buildDirective(name: string, sources: readonly string[]): string {
  return `${name} ${sources.join(' ')}`
}

function buildPermissionsPolicy(allowGeolocation: boolean): string {
  return [
    'camera=()',
    'microphone=()',
    allowGeolocation ? 'geolocation=(self)' : 'geolocation=()',
  ].join(', ')
}

function resolvePresetMode(config: object): SecurityHeadersMode {
  const preset = (config as { nardukSecurityHeaders?: { mode?: unknown } }).nardukSecurityHeaders
  const mode = preset?.mode
  // An unrecognised value reads as 'off' on purpose: the failure mode of
  // guessing wrong here is an app silently losing headers it serves today.
  return mode === 'report-only' || mode === 'enforce' ? mode : 'off'
}

export default defineEventHandler((event) => {
  const config = useRuntimeConfig(event)
  const isDev = import.meta.dev
  const presetMode = resolvePresetMode(config)
  const appVersion = config.public.appVersion
  const buildVersion = config.public.buildVersion || appVersion
  const buildTime = config.public.buildTime

  const diagnosticHeaders: Record<string, string> = {}
  if (appVersion) diagnosticHeaders['X-App-Version'] = appVersion
  if (buildVersion) diagnosticHeaders['X-Build-Version'] = buildVersion
  if (buildTime) diagnosticHeaders['X-Build-Time'] = buildTime

  if (presetMode === 'enforce') {
    setResponseHeaders(event, diagnosticHeaders)
    return
  }

  const posthogHost = readRuntimeString(event, 'POSTHOG_HOST', {
    fallback: config.public.posthogHost,
  })
  const allowGeolocation = readRuntimeBoolean(event, 'NUXT_PUBLIC_ALLOW_GEOLOCATION', {
    fallback: config.public.allowGeolocation,
  })

  const posthogSources = posthogHost && posthogHost !== DEFAULT_POSTHOG_HOST ? [posthogHost] : []

  const finalScriptSrc = buildDirective(
    'script-src',
    mergeCspSources(
      BASELINE_SCRIPT_SRC,
      posthogSources,
      parseCspSources(config.public.cspScriptSrc),
    ),
  )
  const finalConnectSrc = buildDirective(
    'connect-src',
    mergeCspSources(
      BASELINE_CONNECT_SRC,
      isDev ? DEV_CONNECT_SRC : [],
      posthogSources,
      parseCspSources(config.public.cspConnectSrc),
    ),
  )
  const finalFrameSrc = buildDirective(
    'frame-src',
    mergeCspSources(["'self'"], parseCspSources(config.public.cspFrameSrc)),
  )
  const finalWorkerSrc = buildDirective(
    'worker-src',
    mergeCspSources(BASELINE_WORKER_SRC, parseCspSources(config.public.cspWorkerSrc)),
  )

  const finalMediaSrc = buildDirective(
    'media-src',
    mergeCspSources(["'self'"], parseCspSources(config.public.cspMediaSrc)),
  )

  // In 'report-only' nuxt-security already emits each of these, so repeating
  // them here would mean two identical headers on every response.
  const ownedByPreset =
    presetMode === 'off'
      ? {
          'X-Content-Type-Options': 'nosniff',
          'X-Frame-Options': 'DENY',
          'X-XSS-Protection': '0',
          'Referrer-Policy': 'strict-origin-when-cross-origin',
          'Permissions-Policy': buildPermissionsPolicy(allowGeolocation),
        }
      : {}

  setResponseHeaders(event, {
    ...ownedByPreset,
    'Content-Security-Policy': [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      finalScriptSrc,
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      // The `https:` wildcard already covers GA4's Google-signals image
      // beacon at https://www.google.com (issue #472), so this directive
      // needs no explicit host addition to match BASELINE_CONNECT_SRC above.
      "img-src 'self' data: https:",
      "font-src 'self' https://fonts.gstatic.com",
      finalConnectSrc,
      finalFrameSrc,
      finalWorkerSrc,
      finalMediaSrc,
      "frame-ancestors 'none'",
    ].join('; '),
    ...diagnosticHeaders,
  })
})
