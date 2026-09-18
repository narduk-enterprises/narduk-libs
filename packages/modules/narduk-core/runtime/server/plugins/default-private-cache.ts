import { defineNitroPlugin, useRuntimeConfig } from 'nitropack/runtime'

import { isWebResponseLike } from '../../shared/utils/shared-cache'

import type { H3Event } from 'h3'

/**
 * A response that leaves the app with no cache posture is `Cache-Control:
 * private` (narduk-libs#435, step 1).
 *
 * Logan chose (askme 2026-09-18 14:18 CT): "Core makes no-Cache-Control
 * private first (Recommended)". Without a `Cache-Control` header a shared
 * cache is free to apply its own default — Cloudflare's Workers Cache stores
 * by status and extension, a proxy may store heuristically — so every route
 * that simply forgot to pick a profile was one config switch away from being
 * served to the next visitor. `private` closes that class at the source,
 * where #505's per-request header stripping only mitigated it. The browser
 * may still cache such a response for its own user; a shared cache may not.
 *
 * ## What counts as an explicit posture, which always wins
 *
 * Any of `Cache-Control`, `CDN-Cache-Control`, `Cloudflare-CDN-Cache-Control`,
 * `Surrogate-Control` or `Expires`, on the event or on a returned web
 * `Response`. That covers `setCacheProfile` (including #505's shared-cacheable
 * profiles), `setResponseHeader`, Nitro `routeRules` headers and cached
 * handlers (both write onto the event before the handler returns), and a
 * route that only speaks to the edge through `CDN-Cache-Control` — adding
 * `private` there would change what `shared-cache-headers` judges shareable.
 *
 * ## What is left alone
 *
 * - Build assets under `app.buildAssetsDir` (`/_nuxt/` by default). On
 *   Cloudflare the static-assets layer serves them before the Worker runs, so
 *   this is a backstop for the Node dev server and presets that serve them
 *   through Nitro, where Nitro already writes an immutable posture.
 * - A response whose headers are already sent (a stream, `sendRedirect`).
 * - Errors are not special-cased: `error-cache` rewrites them to
 *   `private, no-store`, which is an explicit posture, in whichever order the
 *   two plugins run.
 *
 * ## Hook
 *
 * `beforeResponse` only. Nitro's render handler copies the SSR response's
 * header map onto the event *before* h3 calls it, so an SSR page is judged by
 * its final headers, and it is the only hook an API route reaches. h3 copies a
 * returned web `Response`'s own headers onto the event *after* this hook, so
 * that body is inspected directly: if it carries a posture it wins by being
 * written last; if it carries none, the `private` written here survives.
 */

const EXPLICIT_CACHE_HEADERS = [
  'cache-control',
  'cdn-cache-control',
  'cloudflare-cdn-cache-control',
  'surrogate-control',
  'expires',
] as const

export const DEFAULT_CACHE_CONTROL = 'private'

const DEFAULT_BUILD_ASSETS_PREFIX = '/_nuxt/'

interface NodeResponseLike {
  getHeader?: (name: string) => unknown
  headersSent?: boolean
  setHeader?: (name: string, value: string) => void
  writableEnded?: boolean
}

function joinPrefix(baseURL: string, dir: string): string {
  const base = baseURL.endsWith('/') ? baseURL : `${baseURL}/`
  const rest = dir.replace(/^\/+/, '')
  const joined = `${base}${rest}`
  return joined.endsWith('/') ? joined : `${joined}/`
}

function buildAssetsPrefix(event: H3Event): string {
  try {
    const app = (
      useRuntimeConfig(event) as { app?: { baseURL?: unknown; buildAssetsDir?: unknown } }
    ).app
    const baseURL = typeof app?.baseURL === 'string' ? app.baseURL : '/'
    const dir = typeof app?.buildAssetsDir === 'string' ? app.buildAssetsDir : '/_nuxt/'
    return joinPrefix(baseURL, dir)
  } catch {
    // Runtime config is unavailable in isolated fixtures.
    return DEFAULT_BUILD_ASSETS_PREFIX
  }
}

function isBuildAsset(event: H3Event): boolean {
  const path = typeof event.path === 'string' ? event.path : ''
  return path.startsWith(buildAssetsPrefix(event))
}

function hasExplicitPosture(read: (name: string) => unknown): boolean {
  return EXPLICIT_CACHE_HEADERS.some((name) => {
    const value = read(name)
    return value !== undefined && value !== null && value !== ''
  })
}

/**
 * Write `Cache-Control: private` onto `event` when neither it nor the
 * returned `body` (a web `Response`) states a cache posture. Returns whether
 * it wrote.
 */
export function applyDefaultPrivateCache(event: H3Event, body?: unknown): boolean {
  const res = event.node?.res as NodeResponseLike | undefined
  if (!res?.getHeader || !res.setHeader) return false
  if (res.headersSent === true || res.writableEnded === true) return false
  if (hasExplicitPosture((name) => res.getHeader?.(name))) return false
  if (isWebResponseLike(body) && hasExplicitPosture((name) => body.headers.get(name))) return false
  if (isBuildAsset(event)) return false
  res.setHeader('Cache-Control', DEFAULT_CACHE_CONTROL)
  return true
}

export default defineNitroPlugin((nitro) => {
  nitro.hooks.hook('beforeResponse', (event, response) => {
    applyDefaultPrivateCache(event, (response as { body?: unknown } | undefined)?.body)
  })
})
