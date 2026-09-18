import { getResponseHeader } from 'h3'
import { defineNitroPlugin, useRuntimeConfig } from 'nitropack/runtime'

import {
  hasMintedNonce,
  isHtmlContentType,
  isNonceCspHtml,
  isNonceCspMode,
  isNuxtPayloadPath,
  markNonceCspHtml,
  wasNonceCspCacheRequested,
} from '../../shared/utils/nonce-csp'
import {
  applyNoStoreHeaders,
  applyNoStoreToEvent,
  SHARED_CACHE_HEADER_NAMES,
} from '../../shared/utils/shared-cache'

import type { H3Event } from 'h3'

const warnedPaths = new Set<string>()

/**
 * SSR HTML under a nonce CSP is `private, no-store`, always (narduk-libs#435).
 *
 * nuxt-security mints a nonce per request and writes it into the HTML body and
 * the CSP header. A shared cache that stores the response replays that one
 * nonce to every visitor in the TTL, which defeats the nonce. Logan chose
 * (askme 2026-09-18 12:20 CT): "1: Refuse HTML caching on nonce apps
 * (Recommended)". JSON API routes carry no nonce and stay edge-cacheable.
 *
 * ## Which requests count as nonce-CSP HTML
 *
 * Two conditions, and both are needed:
 *
 * 1. **An SSR render.** `render:before` and `render:response` are fired only
 *    by Nitro's `defineRenderHandler`, which is Nuxt's page renderer. API
 *    routes never reach them, so marking the event in `render:before` gives
 *    `setCacheProfile` a call-time answer ("this is a page render") before the
 *    page's setup code runs. Nuxt's `_payload.json` extraction requests use the
 *    same handler but return JSON with no nonce, so they are not marked.
 * 2. **An HTML body.** In `render:response` the final `content-type` is known
 *    (`response.headers` for a string render, the event for Nuxt's streamed
 *    renderer, which returns no header map). Only `text/html` carries the
 *    nonce-stamped `<script>` tags, so only `text/html` is forced `no-store`.
 *    A content-type check alone would not work at call time — the renderer
 *    sets it after the page renders — and a render-hook check alone would also
 *    catch a page render that returned non-HTML via `~renderResponse`.
 *
 * ## Which apps
 *
 * The event is marked when `runtimeConfig.nardukSecurityHeaders.mode` is
 * `enforce` or `report-only`, or when nuxt-security already put a nonce on
 * `event.context.security.nonce` (an app that installed it directly).
 * Report-only is covered because nuxt-security 2.6 mints and stamps the nonce
 * identically in that mode — `40-cspSsrNonce` and `50-updateCsp` have no
 * report-only branch, and `70-securityHeaders` only renames the header to
 * `Content-Security-Policy-Report-Only`.
 *
 * ## Hooks
 *
 * Modelled on `error-cache.ts` / `preferences-cache.ts`: `render:response`
 * rewrites the header map Nitro is about to copy onto the event and strips the
 * event itself (where `setCacheProfile` and route rules write), and
 * `beforeResponse` is the last-moment backstop for anything a later
 * `render:response` hook wrote.
 */
export function warnIfNonceCspHtmlCacheRefused(
  event: { context?: Record<string, unknown>; path?: string },
  isDev = Boolean(import.meta.dev),
  hadCacheableHeaders = false,
): void {
  if (!isDev) return
  if (!isNonceCspHtml(event)) return
  if (!wasNonceCspCacheRequested(event) && !hadCacheableHeaders) return
  const path = typeof event.path === 'string' && event.path.length > 0 ? event.path : '/'
  if (warnedPaths.has(path)) return
  warnedPaths.add(path)
  console.warn(
    `[narduk-core] ${path} is SSR HTML under a nonce CSP (nardukCore.security.headers), so its cacheable profile was refused and it ships Cache-Control: private, no-store. The nonce is minted per request; an edge cache would replay one visitor's nonce to everyone. Edge-cache the JSON endpoints this page fetches instead (narduk-libs#435).`,
  )
}

export function resetNonceCspCacheWarningsForTests(): void {
  warnedPaths.clear()
}

function headerFromMap(
  headers: Record<string, unknown> | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name) return value === undefined ? undefined : String(value)
  }
  return undefined
}

function eventHeader(event: H3Event, name: string): string | undefined {
  const value = getResponseHeader(event, name)
  if (value === undefined || value === null) return undefined
  return Array.isArray(value) ? value.join(', ') : String(value)
}

/** Whether a shared cache could store this response as it stands. */
function carriesCacheableHeaders(read: (name: string) => string | undefined): boolean {
  for (const name of SHARED_CACHE_HEADER_NAMES) {
    if (name === 'expires' || name === 'age') continue
    const value = read(name)
    if (!value) continue
    if (name !== 'cache-control') return true
    if (!/\b(?:no-store|private)\b/i.test(value)) return true
  }
  return false
}

export default defineNitroPlugin((nitro) => {
  nitro.hooks.hook('render:before', (context) => {
    const event = context?.event as H3Event | undefined
    if (!event) return
    if (isNuxtPayloadPath(event.path)) return
    const config = useRuntimeConfig(event) as { nardukSecurityHeaders?: { mode?: unknown } }
    if (!hasMintedNonce(event) && !isNonceCspMode(config.nardukSecurityHeaders?.mode)) return
    markNonceCspHtml(event)
  })
  nitro.hooks.hook('render:response', (response, context) => {
    const event = context?.event as H3Event | undefined
    if (!event || !isNonceCspHtml(event)) return
    const contentType =
      headerFromMap(response?.headers, 'content-type') ?? eventHeader(event, 'content-type')
    if (!isHtmlContentType(contentType)) return

    const hadCacheableHeaders = carriesCacheableHeaders(
      (name) => headerFromMap(response.headers, name) ?? eventHeader(event, name),
    )
    warnIfNonceCspHtmlCacheRefused(event, undefined, hadCacheableHeaders)
    response.headers = applyNoStoreHeaders(response.headers ?? {})
    applyNoStoreToEvent(event)
  })
  nitro.hooks.hook('beforeResponse', (event) => {
    if (!isNonceCspHtml(event)) return
    if (!isHtmlContentType(eventHeader(event, 'content-type'))) return
    applyNoStoreToEvent(event)
  })
})
