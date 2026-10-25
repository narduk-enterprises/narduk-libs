import { defineNitroPlugin, useRuntimeConfig } from 'nitropack/runtime'

import {
  createHtmlCacheMatcher,
  createHtmlCacheTtlResolver,
  htmlCacheKey,
  isCanonicalHtmlCachePath,
  isHtmlCacheSkipped,
  isStorableHtml,
  type ResolvedHtmlCache,
  resolveHtmlCacheOptions,
  restampNonce,
} from '../../shared/html-cache'
import { isNuxtPayloadPath } from '../../shared/utils/nonce-csp'
import { isPreferencesInfluenced } from '../../shared/utils/preferences'

import type { H3Event } from 'h3'

/**
 * Edge cache for anonymous public HTML (`nardukCore.htmlCache`, opt-in).
 *
 * A hit is served from the colo cache (`caches.default`) in `render:before`,
 * before Nuxt renders; a 200 render with no `Set-Cookie` is stored for
 * `ttlSeconds`. Only GETs with no query string, no `Cookie` and no
 * `Authorization` are served or stored, so a signed-in render never reaches the
 * cache and random query strings never add keys. The key carries the build id
 * and the host, so a deploy never serves HTML that points at the previous
 * build's chunks. Responses carry `x-html-cache: hit | miss`.
 *
 * Nonce-CSP apps (D-HTML-CACHE-PUBLIC-1, amending narduk-libs#435): nuxt-security
 * mints a nonce per request in the `request` hook, stamps it into the HTML, and builds
 * the CSP header from `event.context.security.nonce` in `render:response`. The page is
 * stored with the nonce it was rendered with; a hit swaps that nonce for the one minted
 * for the requesting visitor, so no two responses share a nonce and the CSP header
 * still matches the HTML (the riverstatus#663 scheme). A request with a Cookie or
 * Authorization header never reads the cache and gets a fresh render; `nonce-csp-cache`
 * still forces `no-store` on every response. A no-op in
 * Node (dev, tests) and anywhere `caches.default` does not exist.
 *
 * Never read or written: a request with `runtimeConfig.public.previewSafeMode`, a path
 * over `HTML_CACHE_MAX_PATH_LENGTH`. Never stored: a render that read preferences
 * (`event.context.nardukPreferencesInfluenced`) or that a page marked with
 * `skipHtmlCache(event)` / `useSkipHtmlCache()` (`x-html-cache: skip`).
 */

export interface HtmlCacheStore {
  match: (key: string) => Promise<Response | undefined>
  put: (key: string, response: Response) => Promise<void>
}

interface HtmlCacheState {
  hit?: boolean
  key?: string
  ttlSeconds?: number
}

const STATE_KEY = '~nardukHtmlCache'
const HTML = 'text/html;charset=utf-8'

function defaultStore(): HtmlCacheStore | undefined {
  return (globalThis as { caches?: { default?: HtmlCacheStore } }).caches?.default
}

function stateOf(event: H3Event): HtmlCacheState {
  const context = event.context as Record<string, unknown>
  return (context[STATE_KEY] ??= {}) as HtmlCacheState
}

export interface CachedHtml {
  body: string
  /** The CSP nonce the page was rendered with; null on an app without one. */
  nonce: string | null
}

const NONCE_HEADER = 'x-narduk-html-nonce'

export async function readCachedHtml(
  key: string,
  store: HtmlCacheStore | undefined = defaultStore(),
): Promise<CachedHtml | null> {
  try {
    const hit = await store?.match(key)
    if (!hit?.ok) return null
    return { body: await hit.text(), nonce: hit.headers.get(NONCE_HEADER) }
  } catch {
    return null
  }
}

export function storeCachedHtml(
  key: string,
  html: string,
  ttlSeconds: number,
  event: { waitUntil?: (promise: Promise<unknown>) => void },
  nonce: string | null = null,
  store: HtmlCacheStore | undefined = defaultStore(),
): Promise<void> {
  if (!store) return Promise.resolve()
  const write = store
    .put(
      key,
      new Response(html, {
        headers: {
          'content-type': HTML,
          'cache-control': `public, max-age=${ttlSeconds}`,
          ...(nonce ? { [NONCE_HEADER]: nonce } : {}),
        },
      }),
    )
    .catch(() => {})
  if (event.waitUntil) {
    event.waitUntil(write)
    return Promise.resolve()
  }
  return write
}

function resolveOrNull(source: unknown): ResolvedHtmlCache | null {
  try {
    return resolveHtmlCacheOptions(source)
  } catch {
    return null
  }
}

let configured:
  | {
      matches: (path: string) => boolean
      options: ResolvedHtmlCache | null
      source: unknown
      ttlFor: (path: string) => number | undefined
    }
  | undefined

/** Built once per isolate: `useRuntimeConfig()` without an event is the shared object. */
function settings() {
  const config = useRuntimeConfig() as { nardukHtmlCache?: unknown }
  const source = config.nardukHtmlCache
  if (configured && configured.source === source) return configured
  const options = resolveOrNull(source)
  configured = {
    matches: options ? createHtmlCacheMatcher(options.routes) : () => false,
    options,
    source,
    ttlFor: options ? createHtmlCacheTtlResolver(options) : () => undefined,
  }
  return configured
}

function eventHost(event: H3Event): string {
  return event.node?.req?.headers?.host ?? ''
}

export default defineNitroPlugin((nitro) => {
  nitro.hooks.hook('render:before', async (ctx) => {
    const event = ctx?.event as H3Event | undefined
    if (!event) return
    const { matches, options, ttlFor } = settings()
    if (!options || isNuxtPayloadPath(event.path)) return
    const config = useRuntimeConfig() as {
      app?: { buildId?: string }
      public?: { previewSafeMode?: unknown }
    }
    // A preview-safe-mode deployment neither reads nor writes the shared cache.
    if (config.public?.previewSafeMode === true) return
    if (!isCanonicalHtmlCachePath(event.path, options.queryKeys)) return
    const key = htmlCacheKey(
      {
        headers: new Headers(event.node.req.headers as Record<string, string>),
        host: eventHost(event),
        method: event.method,
        path: event.path,
      },
      config.app?.buildId ?? '',
      matches,
      options.queryKeys,
    )
    if (!key) return
    // The robots module marks a request it will not index (blockNonSeoBots): its
    // noindex render is never served from, or stored in, the shared cache.
    const robots = (event.context as { robots?: { indexable?: boolean } }).robots
    if (options.requireIndexable ? robots?.indexable !== true : robots?.indexable === false) return
    const state = stateOf(event)
    state.key = key
    state.ttlSeconds = ttlFor(event.path.split('?')[0] ?? event.path) ?? options.ttlSeconds
    const cached = await readCachedHtml(key)
    if (cached === null) return
    // A hit gets this request's own nonce, so no two responses share one. nuxt-security
    // builds the CSP header from the same nonce in render:response, so header and HTML match.
    const security = (event.context as { security?: { nonce?: unknown } }).security
    const requestNonce =
      typeof security?.nonce === 'string' && security.nonce.length > 0 ? security.nonce : undefined
    // An entry stored without a nonce has no attribute to re-stamp, so it cannot answer
    // a request that minted one.
    if (requestNonce && !cached.nonce) return
    const html = restampNonce(cached, requestNonce)
    if (html === null) return
    stateOf(event).hit = true
    ctx.response = {
      body: html,
      statusCode: 200,
      statusMessage: 'OK',
      headers: { 'content-type': HTML, 'x-html-cache': 'hit' },
    }
  })

  nitro.hooks.hook('render:response', (response, ctx) => {
    const event = ctx?.event as H3Event | undefined
    if (!event) return
    const state = stateOf(event)
    const { options } = settings()
    if (!options || !state.key || state.hit) return
    const status = response.statusCode ?? 200
    const setCookie =
      event.node.res.getHeader('set-cookie') ?? headerOf(response.headers, 'set-cookie')
    if (status !== 200 || setCookie || typeof response.body !== 'string') return
    if (!isStorableHtml(response.body)) return
    // A render that read preferences is not shareable; a page can also opt its render out.
    if (isPreferencesInfluenced(event)) return
    if (isHtmlCacheSkipped(event)) {
      response.headers = { ...response.headers, 'x-html-cache': 'skip' }
      return
    }
    response.headers = { ...response.headers, 'x-html-cache': 'miss' }
    const security = (event.context as { security?: { nonce?: unknown } }).security
    const nonce = typeof security?.nonce === 'string' && security.nonce ? security.nonce : null
    return storeCachedHtml(
      state.key,
      response.body,
      state.ttlSeconds ?? options.ttlSeconds,
      event,
      nonce,
    )
  })
})

function headerOf(headers: Record<string, unknown> | undefined, name: string): unknown {
  if (!headers) return undefined
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name) return value
  }
  return undefined
}
