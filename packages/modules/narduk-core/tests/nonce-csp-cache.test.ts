import { createServer } from 'node:http'

import {
  createApp,
  defineEventHandler,
  setResponseHeader,
  setResponseHeaders,
  toNodeListener,
} from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setCacheProfile } from '../runtime/server/utils/cacheProfile'
import {
  isNonceCspHtml,
  NONCE_CSP_CACHE_REQUESTED_CONTEXT_KEY,
  NONCE_CSP_HTML_CONTEXT_KEY,
} from '../runtime/shared/utils/nonce-csp'

import type { H3Event } from 'h3'

const { runtime } = vi.hoisted(() => ({
  runtime: { nardukSecurityHeaders: { mode: 'off' as string } },
}))

vi.mock('nitropack/runtime', () => ({
  defineNitroPlugin: (plugin: unknown) => plugin,
  useRuntimeConfig: () => runtime,
}))
vi.mock('../runtime/server/utils/runtime-public', () => ({
  resolveRuntimePublicOverlay: () => ({ previewSafeMode: false }),
}))

const {
  default: plugin,
  resetNonceCspCacheWarningsForTests,
  warnIfNonceCspHtmlCacheRefused,
} = await import('../runtime/server/plugins/nonce-csp-cache')

const LIVE_BROWSER = 'public, max-age=60, stale-while-revalidate=900'
const LIVE_CDN = 'public, max-age=300, stale-while-revalidate=900'
const NO_STORE = 'private, no-store'
const HTML = 'text/html;charset=utf-8'
const JSON_TYPE = 'application/json'
const CONTENT_TYPE = 'content-type'

type Hook = (...args: unknown[]) => unknown

/** Register the plugin against a fake Nitro and hand back every hook it installed. */
function installedHooks(): Record<string, Hook[]> {
  const hooks: Record<string, Hook[]> = {}
  const nitro = {
    hooks: {
      hook: (name: string, handler: Hook) => {
        ;(hooks[name] ??= []).push(handler)
      },
    },
  }
  ;(plugin as (nitro: unknown) => void)(nitro)
  return hooks
}

async function callHook(hooks: Record<string, Hook[]>, name: string, ...args: unknown[]) {
  for (const handler of hooks[name] ?? []) await handler(...args)
}

interface RenderResult {
  body: string
  headers?: Record<string, string>
  statusCode?: number
}

/**
 * Replays nitropack 2.13's `defineRenderHandler` (`runtime/internal/renderer.mjs`)
 * and Nuxt 4.5's `renderRoute` around a page body: `render:before` fires
 * before the page renders (where page setup can call `setCacheProfile`),
 * `render:response` fires on the returned `{ body, headers }`, Nitro copies
 * `response.headers` onto the event, and h3 fires `onBeforeResponse` last.
 *
 * `streamed` models Nuxt's streamed renderer, which sets `content-type`
 * directly on the event and returns no `headers` map at all.
 */
function renderRoute(
  page: (event: H3Event) => void,
  options: { contentType?: string; streamed?: boolean } = {},
) {
  const contentType = options.contentType ?? HTML
  return (hooks: Record<string, Hook[]>) =>
    defineEventHandler(async (event) => {
      const ctx: { event: H3Event; response?: RenderResult } = { event }
      await callHook(hooks, 'render:before', ctx)
      page(event)
      const body = contentType === HTML ? '<!doctype html><html></html>' : '{"data":1}'
      if (options.streamed) {
        setResponseHeader(event, CONTENT_TYPE, contentType)
        ctx.response = { body }
      } else {
        ctx.response = {
          body,
          statusCode: 200,
          headers: { [CONTENT_TYPE]: contentType, 'x-powered-by': 'Nuxt' },
        }
      }
      await callHook(hooks, 'render:response', ctx.response, ctx)
      if (ctx.response.headers) setResponseHeaders(event, ctx.response.headers)
      return ctx.response.body
    })
}

/** A plain API route: Nitro never calls a render hook for it. */
function apiRoute(route: (event: H3Event) => void) {
  return () =>
    defineEventHandler((event) => {
      route(event)
      setResponseHeader(event, CONTENT_TYPE, JSON_TYPE)
      return JSON.stringify({ ok: true })
    })
}

async function serve(
  handlerFor: (hooks: Record<string, Hook[]>) => ReturnType<typeof defineEventHandler>,
  path = '/',
): Promise<{ headers: Headers; status: number }> {
  const hooks = installedHooks()
  const app = createApp({
    onBeforeResponse: async (event, response) => {
      await callHook(hooks, 'beforeResponse', event, response)
    },
  }).use(handlerFor(hooks))
  const server = createServer(toNodeListener(app))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected TCP listener')
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`)
    await response.text()
    return { headers: response.headers, status: response.status }
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
}

const CACHE_HEADER_NAMES = [
  'cache-control',
  'cdn-cache-control',
  'cloudflare-cdn-cache-control',
  'surrogate-control',
  'cache-tag',
  'expires',
  'age',
] as const

/** Every shared-cache header a client received, `null` when absent. */
function cacheHeaders(headers: Headers): Record<string, string | null> {
  return Object.fromEntries(CACHE_HEADER_NAMES.map((name) => [name, headers.get(name)]))
}

const EXACTLY_NO_STORE = {
  'cache-control': NO_STORE,
  'cdn-cache-control': null,
  'cloudflare-cdn-cache-control': null,
  'surrogate-control': null,
  'cache-tag': null,
  expires: null,
  age: null,
}

const LIVE_UNCHANGED = {
  ...EXACTLY_NO_STORE,
  'cache-control': LIVE_BROWSER,
  'cdn-cache-control': LIVE_CDN,
  'cache-tag': 'stations',
}

const liveProfile = (event: H3Event) => {
  setCacheProfile(event, 'live', { tags: ['stations'] })
}

beforeEach(() => {
  runtime.nardukSecurityHeaders.mode = 'off'
})

/**
 * narduk-libs#435: under a nonce CSP, nuxt-security writes one per-request
 * nonce into both the SSR HTML and its CSP header. A shared cache that stores
 * that response replays the nonce to every visitor, so nonce-CSP HTML is never
 * storable. JSON carries no nonce and stays edge-cacheable.
 */
describe('nonce-csp-cache — enforce mode', () => {
  beforeEach(() => {
    runtime.nardukSecurityHeaders.mode = 'enforce'
  })

  it('forces exactly private, no-store on SSR HTML whose page asked for live', async () => {
    const { headers, status } = await serve(renderRoute(liveProfile))

    expect(status).toBe(200)
    expect(headers.get(CONTENT_TYPE)).toBe(HTML)
    expect(cacheHeaders(headers)).toEqual(EXACTLY_NO_STORE)
  })

  it('refuses the live profile at call time with the nonce-csp-html reason', async () => {
    let result: ReturnType<typeof setCacheProfile> | undefined
    await serve(
      renderRoute((event) => {
        result = setCacheProfile(event, 'live', { tags: ['stations'] })
      }),
    )

    expect(result?.suppressedBy).toBe('nonce-csp-html')
    expect(result?.cacheControl).toBe(NO_STORE)
    expect(result?.cdnCacheControl).toBeUndefined()
    expect(result?.cacheTag).toBeUndefined()
  })

  it('refuses the slow profile too', async () => {
    const { headers } = await serve(
      renderRoute((event) => {
        setCacheProfile(event, 'slow', { tags: ['stations'] })
      }),
    )

    expect(cacheHeaders(headers)).toEqual(EXACTLY_NO_STORE)
  })

  it('strips cacheable headers SSR HTML got without setCacheProfile (backstop)', async () => {
    const { headers } = await serve(
      renderRoute((event) => {
        setResponseHeaders(event, {
          'Cache-Control': 'public, max-age=600',
          'CDN-Cache-Control': 'max-age=600',
          'Cloudflare-CDN-Cache-Control': 'max-age=600',
          'Surrogate-Control': 'max-age=600',
          'Cache-Tag': 'stations',
          Expires: 'Wed, 08 Mar 2034 00:00:00 GMT',
          Age: '3',
        })
      }),
    )

    expect(cacheHeaders(headers)).toEqual(EXACTLY_NO_STORE)
  })

  it('covers the streamed renderer, which puts content-type on the event', async () => {
    const { headers } = await serve(renderRoute(liveProfile, { streamed: true }))

    expect(headers.get(CONTENT_TYPE)).toBe(HTML)
    expect(cacheHeaders(headers)).toEqual(EXACTLY_NO_STORE)
  })

  it('pins no-store on SSR HTML that set no cache posture at all', async () => {
    const { headers } = await serve(renderRoute(() => {}))

    expect(cacheHeaders(headers)).toEqual(EXACTLY_NO_STORE)
  })

  it('leaves a JSON API route with live completely unchanged and edge-cacheable', async () => {
    const { headers } = await serve(apiRoute(liveProfile))

    expect(headers.get(CONTENT_TYPE)).toBe(JSON_TYPE)
    expect(cacheHeaders(headers)).toEqual(LIVE_UNCHANGED)
  })

  it('leaves a JSON API route with no profile untouched', async () => {
    const { headers } = await serve(apiRoute(() => {}))

    expect(headers.get('cache-control')).toBeNull()
  })

  it('leaves a Nuxt _payload.json render (JSON, no nonce) edge-cacheable', async () => {
    const { headers } = await serve(
      renderRoute(liveProfile, { contentType: JSON_TYPE }),
      '/stations/_payload.json',
    )

    expect(headers.get(CONTENT_TYPE)).toBe(JSON_TYPE)
    expect(cacheHeaders(headers)).toEqual(LIVE_UNCHANGED)
  })
})

describe('nonce-csp-cache — security headers off', () => {
  it('leaves SSR HTML with live unchanged and cacheable', async () => {
    const { headers } = await serve(renderRoute(liveProfile))

    expect(headers.get(CONTENT_TYPE)).toBe(HTML)
    expect(cacheHeaders(headers)).toEqual(LIVE_UNCHANGED)
  })

  it('does not mark the event', async () => {
    let marked: boolean | undefined
    await serve(
      renderRoute((event) => {
        marked = isNonceCspHtml(event)
      }),
    )

    expect(marked).toBe(false)
  })

  it('still refuses when nuxt-security minted a nonce on the event anyway', async () => {
    // An app that installs nuxt-security itself, outside `security.headers`,
    // still gets a per-request nonce in `event.context.security.nonce`.
    const { headers } = await serve((hooks) =>
      defineEventHandler(async (event) => {
        event.context.security = { nonce: 'abc123' }
        return renderRoute(liveProfile)(hooks)(event)
      }),
    )

    expect(cacheHeaders(headers)).toEqual(EXACTLY_NO_STORE)
  })
})

/**
 * Report-only mode is covered on evidence, not by assumption: nuxt-security
 * 2.6's `40-cspSsrNonce` mints and injects the nonce whenever `nonce` is on,
 * with no report-only branch, `50-updateCsp` substitutes it the same way, and
 * only `70-securityHeaders` differs, by naming the header
 * `Content-Security-Policy-Report-Only`. `buildNuxtSecurityConfig` sets
 * `nonce: true` in both on-modes. So report-only HTML carries a nonce too.
 */
describe('nonce-csp-cache — report-only mode', () => {
  beforeEach(() => {
    runtime.nardukSecurityHeaders.mode = 'report-only'
  })

  it('forces exactly private, no-store on SSR HTML whose page asked for live', async () => {
    const { headers } = await serve(renderRoute(liveProfile))

    expect(cacheHeaders(headers)).toEqual(EXACTLY_NO_STORE)
  })

  it('leaves a JSON API route with live edge-cacheable', async () => {
    const { headers } = await serve(apiRoute(liveProfile))

    expect(cacheHeaders(headers)).toEqual(LIVE_UNCHANGED)
  })
})

describe('nonce-csp-cache — dev warning', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    resetNonceCspCacheWarningsForTests()
  })

  function refusedEvent(path: string) {
    return {
      path,
      context: {
        [NONCE_CSP_HTML_CONTEXT_KEY]: true,
        [NONCE_CSP_CACHE_REQUESTED_CONTEXT_KEY]: true,
      } as Record<string, unknown>,
    }
  }

  it('warns once per path in dev when a nonce page asked for a cacheable profile', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    warnIfNonceCspHtmlCacheRefused(refusedEvent('/stations'), true)
    warnIfNonceCspHtmlCacheRefused(refusedEvent('/stations'), true)
    warnIfNonceCspHtmlCacheRefused(refusedEvent('/history'), true)

    expect(warn).toHaveBeenCalledTimes(2)
    expect(String(warn.mock.calls[0])).toMatch(/\/stations/)
    expect(String(warn.mock.calls[0])).toMatch(/nonce/i)
    expect(String(warn.mock.calls[0])).toMatch(/#435/)
    expect(String(warn.mock.calls[1])).toMatch(/\/history/)
  })

  it('is silent outside development', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    warnIfNonceCspHtmlCacheRefused(refusedEvent('/stations'), false)

    expect(warn).not.toHaveBeenCalled()
  })

  it('is silent when the page never asked for a cacheable profile', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    warnIfNonceCspHtmlCacheRefused(
      { path: '/about', context: { [NONCE_CSP_HTML_CONTEXT_KEY]: true } },
      true,
    )

    expect(warn).not.toHaveBeenCalled()
  })

  it('marks the event when a nonce page asks for live', async () => {
    runtime.nardukSecurityHeaders.mode = 'enforce'
    let requested: unknown
    await serve(
      renderRoute((event) => {
        setCacheProfile(event, 'live')
        requested = event.context[NONCE_CSP_CACHE_REQUESTED_CONTEXT_KEY]
      }),
    )

    expect(requested).toBe(true)
  })

  it('does not mark the event when a nonce page asks for none', async () => {
    runtime.nardukSecurityHeaders.mode = 'enforce'
    let requested: unknown
    await serve(
      renderRoute((event) => {
        setCacheProfile(event, 'none')
        requested = event.context[NONCE_CSP_CACHE_REQUESTED_CONTEXT_KEY]
      }),
    )

    expect(requested).toBeUndefined()
  })
})
