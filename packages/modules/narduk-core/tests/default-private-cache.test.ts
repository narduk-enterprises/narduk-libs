/**
 * narduk-libs#435 step 1: a response with no cache posture leaves as
 * `Cache-Control: private`, and every explicit posture wins.
 *
 * Driven through a real h3 app and a real HTTP round trip, with the plugin's
 * `beforeResponse` hook installed next to the two plugins it shares the hook
 * with (`error-cache`, `shared-cache-headers`), in both orders — Nitro runs
 * scanned plugins in file order, and the result must not depend on it.
 */
import { createServer } from 'node:http'

import {
  createApp,
  createError,
  defineEventHandler,
  setResponseHeader,
  setResponseHeaders,
  toNodeListener,
} from 'h3'
import { describe, expect, it, vi } from 'vitest'

import { setCacheProfile } from '../runtime/server/utils/cacheProfile'

import type { H3Event } from 'h3'

const { runtime } = vi.hoisted(() => ({
  runtime: { app: { baseURL: '/', buildAssetsDir: '/_nuxt/' } as Record<string, unknown> },
}))

vi.mock('nitropack/runtime', () => ({
  defineNitroPlugin: (plugin: unknown) => plugin,
  useRuntimeConfig: () => runtime,
}))
vi.mock('../runtime/server/utils/runtime-public', () => ({
  resolveRuntimePublicOverlay: () => ({ previewSafeMode: false }),
}))

const { default: defaultPrivatePlugin } =
  await import('../runtime/server/plugins/default-private-cache')
const { default: errorCachePlugin } = await import('../runtime/server/plugins/error-cache')
const { default: sharedCachePlugin } =
  await import('../runtime/server/plugins/shared-cache-headers')

const CACHE_CONTROL = 'cache-control'

type BeforeResponseHook = (event: H3Event, response?: unknown) => void

const PLUGIN_ORDERS = {
  'file order': [defaultPrivatePlugin, errorCachePlugin, sharedCachePlugin],
  reversed: [sharedCachePlugin, errorCachePlugin, defaultPrivatePlugin],
} as const

function beforeResponseHooks(plugins: readonly unknown[]): BeforeResponseHook[] {
  const hooks: BeforeResponseHook[] = []
  const nitro = {
    hooks: {
      hook: (name: string, handler: BeforeResponseHook) => {
        if (name === 'beforeResponse') hooks.push(handler)
      },
    },
  }
  for (const plugin of plugins) (plugin as (nitro: unknown) => void)(nitro)
  return hooks
}

async function respond(
  handler: (event: H3Event) => unknown,
  { order = 'file order', path = '/' }: { order?: keyof typeof PLUGIN_ORDERS; path?: string } = {},
): Promise<{ body: string; headers: Headers; status: number }> {
  const hooks = beforeResponseHooks(PLUGIN_ORDERS[order])
  const app = createApp({
    onBeforeResponse: (event, response) => {
      for (const hook of hooks) hook(event, response)
    },
  }).use(defineEventHandler((event) => handler(event) ?? 'ok'))
  const server = createServer(toNodeListener(app))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected TCP listener')
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`)
    return { body: await response.text(), headers: response.headers, status: response.status }
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
}

/**
 * What Nitro's `defineRenderHandler` does after `render:response`: copy the
 * render's header map onto the event, then return the HTML body.
 */
function renderSsrPage(event: H3Event, headers: Record<string, string> = {}): string {
  setResponseHeaders(event, { 'content-type': 'text/html;charset=utf-8', ...headers })
  return '<!DOCTYPE html><html><body><div id="__nuxt">page</div></body></html>'
}

describe.each(Object.keys(PLUGIN_ORDERS) as Array<keyof typeof PLUGIN_ORDERS>)(
  'default-private-cache Nitro plugin (%s)',
  (order) => {
    it('makes an SSR page with no posture private', async () => {
      const { headers, status } = await respond((event) => renderSsrPage(event), { order })

      expect(status).toBe(200)
      expect(headers.get('content-type')).toContain('text/html')
      expect(headers.get(CACHE_CONTROL)).toBe('private')
    })

    it('makes an API JSON response with no posture private', async () => {
      const { body, headers, status } = await respond(() => ({ ok: true }), { order })

      expect(status).toBe(200)
      expect(JSON.parse(body)).toEqual({ ok: true })
      expect(headers.get(CACHE_CONTROL)).toBe('private')
    })

    it('keeps an explicit shared-cacheable profile exactly as set', async () => {
      const { headers } = await respond(
        (event) => {
          setCacheProfile(event, 'live', { tags: ['stations'] })
          return { ok: true }
        },
        { order },
      )

      expect(headers.get(CACHE_CONTROL)).toBe('public, max-age=60, stale-while-revalidate=900')
      expect(headers.get('cdn-cache-control')).toBe(
        'public, max-age=300, stale-while-revalidate=900',
      )
      expect(headers.get('cache-tag')).toBe('stations')
    })

    it('keeps an explicit public header on an SSR page (routeRules / setResponseHeader)', async () => {
      const { headers } = await respond(
        (event) => renderSsrPage(event, { [CACHE_CONTROL]: 'public, max-age=3600' }),
        { order },
      )

      expect(headers.get(CACHE_CONTROL)).toBe('public, max-age=3600')
    })

    it('adds no Cache-Control to a response that only states an edge posture', async () => {
      const { headers } = await respond(
        (event) => {
          setResponseHeader(event, 'CDN-Cache-Control', 'public, max-age=300')
          setResponseHeader(event, 'x-request-id', 'req-1')
          return { ok: true }
        },
        { order },
      )

      expect(headers.get(CACHE_CONTROL)).toBeNull()
      expect(headers.get('cdn-cache-control')).toBe('public, max-age=300')
      // shared-cache-headers still sees it as shared and strips the request id.
      expect(headers.get('x-request-id')).toBeNull()
    })

    it('lets a returned Response state its own posture', async () => {
      const { headers } = await respond(
        () =>
          new Response('{"ok":true}', {
            headers: { [CACHE_CONTROL]: 'public, max-age=120', 'content-type': 'application/json' },
          }),
        { order },
      )

      expect(headers.get(CACHE_CONTROL)).toBe('public, max-age=120')
    })

    it('makes a returned Response with no posture private', async () => {
      const { headers } = await respond(
        () => new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } }),
        { order },
      )

      expect(headers.get(CACHE_CONTROL)).toBe('private')
    })

    it.each([404, 500])('keeps a thrown %i private, no-store', async (statusCode) => {
      const { headers, status } = await respond(
        () => {
          throw createError({ statusCode, statusMessage: 'thrown' })
        },
        { order },
      )

      expect(status).toBe(statusCode)
      expect(headers.get(CACHE_CONTROL)).toBe('private, no-store')
    })

    it('leaves build assets alone', async () => {
      const { headers } = await respond(() => 'console.log(1)', {
        order,
        path: '/_nuxt/entry.abc123.js',
      })

      expect(headers.get(CACHE_CONTROL)).toBeNull()
    })
  },
)

describe('default-private-cache build asset prefix', () => {
  it('follows app.baseURL and app.buildAssetsDir', async () => {
    runtime.app = { baseURL: '/docs/', buildAssetsDir: '/assets/' }
    try {
      const asset = await respond(() => 'x', { path: '/docs/assets/entry.js' })
      const page = await respond(() => 'x', { path: '/_nuxt/entry.js' })

      expect(asset.headers.get(CACHE_CONTROL)).toBeNull()
      expect(page.headers.get(CACHE_CONTROL)).toBe('private')
    } finally {
      runtime.app = { baseURL: '/', buildAssetsDir: '/_nuxt/' }
    }
  })
})
