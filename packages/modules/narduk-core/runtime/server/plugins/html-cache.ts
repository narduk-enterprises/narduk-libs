import { defineNitroPlugin, useRuntimeConfig } from 'nitropack/runtime'

import {
  createHtmlCacheMatcher,
  htmlCacheKey,
  isStorableHtml,
  type ResolvedHtmlCache,
  resolveHtmlCacheOptions,
} from '../../shared/html-cache'
import { isNuxtPayloadPath } from '../../shared/utils/nonce-csp'

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
 * mints the nonce in the `request` hook and stamps it into the HTML, then builds the
 * CSP header from `event.context.security.nonce` in `render:response`. The page is
 * stored with the nonce it was rendered with, and a hit puts that nonce back on the
 * event, so the cached HTML and the CSP header still match. The nonce is never
 * rewritten per hit (that would stamp it onto an injected script). A request with a
 * Cookie or Authorization header never reads the cache and keeps its own fresh
 * nonce; `nonce-csp-cache` still forces `no-store` on every response. A no-op in
 * Node (dev, tests) and anywhere `caches.default` does not exist.
 */

export interface HtmlCacheStore {
  match: (key: string) => Promise<Response | undefined>
  put: (key: string, response: Response) => Promise<void>
}

interface HtmlCacheState {
  hit?: boolean
  key?: string
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
  html: string
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
    return { html: await hit.text(), nonce: hit.headers.get(NONCE_HEADER) }
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
  | { matches: (path: string) => boolean; options: ResolvedHtmlCache | null; source: unknown }
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
    const { matches, options } = settings()
    if (!options || isNuxtPayloadPath(event.path)) return
    const config = useRuntimeConfig() as { app?: { buildId?: string } }
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
    stateOf(event).key = key
    const cached = await readCachedHtml(key)
    if (cached === null) return
    const security = (event.context as { security?: { nonce?: unknown } }).security
    const minted = typeof security?.nonce === 'string' && security.nonce.length > 0
    // An entry stored without a nonce cannot answer a request that minted one.
    if (minted && !cached.nonce) return
    // The page and its CSP header are stored together: the header is built from this
    // nonce in render:response, so it matches the nonce stamped into the HTML.
    if (minted && security && cached.nonce) security.nonce = cached.nonce
    stateOf(event).hit = true
    ctx.response = {
      body: cached.html,
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
    response.headers = { ...response.headers, 'x-html-cache': 'miss' }
    const security = (event.context as { security?: { nonce?: unknown } }).security
    const nonce = typeof security?.nonce === 'string' && security.nonce ? security.nonce : null
    return storeCachedHtml(state.key, response.body, options.ttlSeconds, event, nonce)
  })
})

function headerOf(headers: Record<string, unknown> | undefined, name: string): unknown {
  if (!headers) return undefined
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name) return value
  }
  return undefined
}
