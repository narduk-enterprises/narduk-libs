/**
 * Security headers middleware.
 *
 * Sets standard security headers on every response to protect against
 * common web vulnerabilities. These supplement Cloudflare's built-in
 * protections with application-level defense-in-depth.
 */
import { defineEventHandler, setResponseHeaders } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'

import { readRuntimeBoolean, readRuntimeString } from '../utils/runtime-env'

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

export default defineEventHandler((event) => {
  const config = useRuntimeConfig(event)
  const isDev = import.meta.dev
  const appVersion = config.public.appVersion
  const buildVersion = config.public.buildVersion || appVersion
  const buildTime = config.public.buildTime
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

  const diagnosticHeaders: Record<string, string> = {}
  if (appVersion) diagnosticHeaders['X-App-Version'] = appVersion
  if (buildVersion) diagnosticHeaders['X-Build-Version'] = buildVersion
  if (buildTime) diagnosticHeaders['X-Build-Time'] = buildTime

  setResponseHeaders(event, {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '0',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': buildPermissionsPolicy(allowGeolocation),
    'Content-Security-Policy': [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      finalScriptSrc,
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "img-src 'self' data: https:",
      "font-src 'self' https://fonts.gstatic.com",
      finalConnectSrc,
      finalFrameSrc,
      finalWorkerSrc,
      "frame-ancestors 'none'",
    ].join('; '),
    ...diagnosticHeaders,
  })
})
