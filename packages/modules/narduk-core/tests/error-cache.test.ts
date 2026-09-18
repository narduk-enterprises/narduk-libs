import { createServer } from 'node:http'

import { createApp, createError, defineEventHandler, toNodeListener } from 'h3'
import { describe, expect, it, vi } from 'vitest'

import { setCacheProfile } from '../runtime/server/utils/cacheProfile'

import type { H3Event } from 'h3'

vi.mock('nitropack/runtime', () => ({
  defineNitroPlugin: (plugin: unknown) => plugin,
  useRuntimeConfig: () => ({}),
}))
vi.mock('../runtime/server/utils/runtime-public', () => ({
  resolveRuntimePublicOverlay: () => ({ previewSafeMode: false }),
}))

const { default: plugin } = await import('../runtime/server/plugins/error-cache')

const CACHEABLE = 'public, max-age=60, stale-while-revalidate=900'
const LIVE_CDN = 'public, max-age=300, stale-while-revalidate=900'
const NO_STORE = 'private, no-store'
const CACHE_CONTROL = 'cache-control'
const CDN_CACHE_CONTROL = 'cdn-cache-control'

interface RenderResponse {
  headers: Record<string, string | undefined>
  statusCode?: number
}
type RenderHook = (response: RenderResponse, context: { event?: unknown }) => void
type BeforeResponseHook = (event: H3Event, response?: unknown) => void

interface InstalledHooks {
  beforeResponse: BeforeResponseHook | undefined
  renderResponse: RenderHook
}

/** Register the plugin against a fake Nitro and hand back the hooks it installed. */
function installedHooks(): InstalledHooks {
  let renderResponse: RenderHook | undefined
  let beforeResponse: BeforeResponseHook | undefined
  const nitro = {
    hooks: {
      hook: (name: string, handler: RenderHook | BeforeResponseHook) => {
        if (name === 'render:response') renderResponse = handler as RenderHook
        if (name === 'beforeResponse') beforeResponse = handler as BeforeResponseHook
      },
    },
  }

  ;(plugin as (nitro: unknown) => void)(nitro)
  if (!renderResponse) throw new Error('plugin registered no render:response hook')
  return { beforeResponse, renderResponse }
}

/**
 * Drive a real h3 handler through the plugin's `beforeResponse` hook, the way
 * Nitro does for API routes and for the h3-native error path a thrown
 * `createError()` takes (`render:response` never runs there — see the header
 * comment on `runtime/server/plugins/error-cache.ts`).
 */
async function apiRespond(
  handler: (event: H3Event) => unknown,
): Promise<{ body: string; headers: Headers; status: number }> {
  const { beforeResponse } = installedHooks()
  if (!beforeResponse) throw new Error('plugin registered no beforeResponse hook')
  const app = createApp({
    onBeforeResponse: (event, response) => {
      beforeResponse(event, response)
    },
  }).use(
    defineEventHandler((event) => {
      const result = handler(event)
      return result === undefined ? 'ok' : result
    }),
  )
  const server = createServer(toNodeListener(app))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected TCP listener')
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/`)
    return { body: await response.text(), headers: response.headers, status: response.status }
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
}

function expectUnstorable(headers: Headers): void {
  expect(headers.get(CACHE_CONTROL)).toBe(NO_STORE)
  expect(headers.get(CDN_CACHE_CONTROL)).toBeNull()
  expect(headers.get('cloudflare-cdn-cache-control')).toBeNull()
  expect(headers.get('surrogate-control')).toBeNull()
  expect(headers.get('cache-tag')).toBeNull()
  expect(headers.get('expires')).toBeNull()
  expect(headers.get('age')).toBeNull()
}

/**
 * narduk-libs#429: every thrown 4xx/5xx (429 included — covered separately in
 * `tests/rate-limited-handler.test.ts`, which throws through
 * `defineRateLimitedHandler` rather than a bare `createError`) must leave a
 * shared cache with nothing to store, whether or not the route already set a
 * cache posture before it threw.
 */
describe('error-cache Nitro plugin — API routes (beforeResponse)', () => {
  it.each([400, 404, 503])(
    'forces private, no-store with none of the stripped headers on a thrown %i',
    async (statusCode) => {
      const { status, headers } = await apiRespond(() => {
        throw createError({ statusCode, statusMessage: 'thrown' })
      })

      expect(status).toBe(statusCode)
      expectUnstorable(headers)
    },
  )

  it.each([400, 404, 503])(
    'overrides a live cache profile the route already set before throwing %i',
    async (statusCode) => {
      const { status, headers } = await apiRespond((event) => {
        setCacheProfile(event, 'live', { tags: ['stations'] })
        throw createError({ statusCode, statusMessage: 'thrown' })
      })

      expect(status).toBe(statusCode)
      expectUnstorable(headers)
    },
  )

  it('leaves a successful 200 response with a live profile completely unchanged', async () => {
    const { status, headers } = await apiRespond((event) => {
      setCacheProfile(event, 'live', { tags: ['stations'] })
      return { ok: true }
    })

    expect(status).toBe(200)
    expect(headers.get(CACHE_CONTROL)).toBe(CACHEABLE)
    expect(headers.get(CDN_CACHE_CONTROL)).toBe(LIVE_CDN)
    expect(headers.get('cache-tag')).toBe('stations')
  })

  it('leaves a successful 200 response with no cache profile at all unchanged', async () => {
    const { status, headers } = await apiRespond(() => ({ ok: true }))

    expect(status).toBe(200)
    expect(headers.get(CACHE_CONTROL)).toBeNull()
  })

  it('strips shared-cache headers a returned error Response object carries', async () => {
    const { status, headers } = await apiRespond(() => {
      return new Response(JSON.stringify({ error: true }), {
        status: 400,
        headers: {
          [CACHE_CONTROL]: CACHEABLE,
          [CDN_CACHE_CONTROL]: LIVE_CDN,
          'cache-tag': 'stations',
          'content-type': 'application/json',
        },
      })
    })

    expect(status).toBe(400)
    expectUnstorable(headers)
  })
})

describe('error-cache Nitro plugin — SSR error page (render:response)', () => {
  it('leaves a 200 render response alone', () => {
    const { renderResponse } = installedHooks()
    const response: RenderResponse = { headers: { [CACHE_CONTROL]: CACHEABLE }, statusCode: 200 }

    renderResponse(response, { event: { context: {} } })

    expect(response.headers).toEqual({ [CACHE_CONTROL]: CACHEABLE })
  })

  it.each([400, 404, 503])(
    'forces private, no-store on an SSR error-page render response (status %i)',
    (statusCode) => {
      const { renderResponse } = installedHooks()
      const response: RenderResponse = {
        headers: {
          [CACHE_CONTROL]: CACHEABLE,
          'CDN-Cache-Control': LIVE_CDN,
          'Cloudflare-CDN-Cache-Control': 'public, max-age=60',
          'Surrogate-Control': 'max-age=60',
          'Cache-Tag': 'stations',
          Expires: 'Wed, 08 Mar 2026 00:00:00 GMT',
          Age: '12',
          'content-type': 'text/html',
        },
        statusCode,
      }

      renderResponse(response, { event: { context: {} } })

      expect(response.headers[CACHE_CONTROL]).toBe(NO_STORE)
      expect(response.headers['content-type']).toBe('text/html')
      expect(response.headers['CDN-Cache-Control']).toBeUndefined()
      expect(response.headers['Cloudflare-CDN-Cache-Control']).toBeUndefined()
      expect(response.headers['Surrogate-Control']).toBeUndefined()
      expect(response.headers['Cache-Tag']).toBeUndefined()
      expect(response.headers.Expires).toBeUndefined()
      expect(response.headers.Age).toBeUndefined()
    },
  )

  it('falls back to the event status when the render response carries none', () => {
    const { renderResponse } = installedHooks()
    const response: RenderResponse = { headers: { [CACHE_CONTROL]: CACHEABLE } }
    const fakeEvent = {
      context: {},
      node: { res: { statusCode: 404 } },
    }

    renderResponse(response, { event: fakeEvent })

    // getResponseStatus reads `event.node.res.statusCode` via h3; this proves
    // the plugin does not assume `response.statusCode` is always populated.
    expect(response.headers[CACHE_CONTROL]).toBe(NO_STORE)
  })
})
