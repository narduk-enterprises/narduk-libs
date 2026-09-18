/**
 * `definePublishedDataHandler` (narduk-libs#514): cache profile after success
 * only, a sanitized 503 for an internal failure, deliberate HTTP errors passed
 * through, and a rate limit only when the route opts in.
 *
 * Driven over a real h3 app on a real socket with the core `error-cache`
 * plugin's `beforeResponse` hook installed, so the asserted headers are the
 * ones a client receives.
 */
import { createServer } from 'node:http'

import { createApp, createError, setResponseHeader, setResponseStatus, toNodeListener } from 'h3'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createRateLimitWindowStore } from '../runtime/server/rate-limit/window'
import {
  DEFAULT_PUBLISHED_DATA_FALLBACK_MESSAGE,
  definePublishedDataHandler,
} from '../runtime/server/utils/publishedDataHandler'

import type * as LoggerModule from '../runtime/server/utils/logger'
import type { EventHandler, H3Error, H3Event } from 'h3'

const { logged } = vi.hoisted(() => ({
  logged: [] as Array<{ data: unknown; message: string }>,
}))

vi.mock('nitropack/runtime', () => ({
  defineNitroPlugin: (plugin: unknown) => plugin,
  useRuntimeConfig: () => ({}),
}))
vi.mock('../runtime/server/utils/runtime-public', () => ({
  resolveRuntimePublicOverlay: () => ({ previewSafeMode: false }),
}))
vi.mock('../runtime/server/utils/logger', async (importOriginal) => ({
  ...(await importOriginal<typeof LoggerModule>()),
  useLogger: () => ({
    error: (message: string, data: unknown) => logged.push({ data, message }),
    warn: () => {},
  }),
}))

const { default: errorCachePlugin } = await import('../runtime/server/plugins/error-cache')

const CACHE_CONTROL = 'cache-control'
const LIVE_CACHE_CONTROL = 'public, max-age=60, stale-while-revalidate=900'
const NO_STORE = 'private, no-store'
const SECRET = 'ZodError: expected literal "v1" at manifest.schemaVersion, received "v0"'

interface Served {
  body: string
  error: H3Error | undefined
  headers: Headers
  status: number
}

type BeforeResponseHook = (event: H3Event, response?: unknown) => void

function errorCacheHook(): BeforeResponseHook {
  let hook: BeforeResponseHook | undefined
  ;(errorCachePlugin as (nitro: unknown) => void)({
    hooks: {
      hook: (name: string, handler: BeforeResponseHook) => {
        if (name === 'beforeResponse') hook = handler
      },
    },
  })
  if (!hook) throw new Error('error-cache registered no beforeResponse hook')
  return hook
}

async function serve(handler: EventHandler, times = 1): Promise<Served[]> {
  const beforeResponse = errorCacheHook()
  const errors: H3Error[] = []
  const app = createApp({
    onBeforeResponse: (event, response) => beforeResponse(event, response),
    onError: (error) => {
      errors.push(error)
    },
  })
  app.use('/', handler, { match: () => true })
  const server = createServer(toNodeListener(app))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected TCP listener')
  try {
    const results: Served[] = []
    for (let index = 0; index < times; index += 1) {
      const before = errors.length
      const response = await fetch(`http://127.0.0.1:${address.port}/api/stations`, {
        headers: { 'cf-connecting-ip': '203.0.113.9' },
      })
      results.push({
        body: await response.text(),
        error: errors.length > before ? errors.at(-1) : undefined,
        headers: response.headers,
        status: response.status,
      })
    }
    return results
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
}

async function serveOnce(handler: EventHandler): Promise<Served> {
  const [result] = await serve(handler)
  if (!result) throw new Error('no response')
  return result
}

describe('definePublishedDataHandler', () => {
  beforeEach(() => {
    logged.length = 0
  })

  it('applies the profile and tags to a successful response', async () => {
    const { body, headers, status } = await serveOnce(
      definePublishedDataHandler(() => Promise.resolve({ stations: 3 }), {
        profile: 'live',
        tags: ['published-data'],
      }),
    )

    expect(status).toBe(200)
    expect(JSON.parse(body)).toEqual({ stations: 3 })
    expect(headers.get(CACHE_CONTROL)).toBe(LIVE_CACHE_CONTROL)
    expect(headers.get('cdn-cache-control')).toBe('public, max-age=300, stale-while-revalidate=900')
    expect(headers.get('cache-tag')).toBe('published-data')
  })

  it('turns an internal failure into a sanitized 503 and logs the real error', async () => {
    const failure = new Error(SECRET)
    const { body, error, headers, status } = await serveOnce(
      definePublishedDataHandler(
        () => {
          throw failure
        },
        { profile: 'live', fallbackMessage: 'Station data is temporarily unavailable.' },
      ),
    )

    expect(status).toBe(503)
    expect(body).not.toContain('ZodError')
    expect(body).not.toContain('schemaVersion')
    expect(error?.message).toBe('Station data is temporarily unavailable.')
    expect(JSON.stringify(error?.cause ?? null)).not.toContain('ZodError')
    expect(headers.get(CACHE_CONTROL)).toBe(NO_STORE)
    expect(headers.get('cdn-cache-control')).toBeNull()
    expect(logged).toEqual([{ message: 'Published data read failed', data: { error: failure } }])
  })

  it('uses a default fallback message when the route gives none', async () => {
    const { error, status } = await serveOnce(
      definePublishedDataHandler(() => Promise.reject(new Error(SECRET)), { profile: 'slow' }),
    )

    expect(status).toBe(503)
    expect(error?.message).toBe(DEFAULT_PUBLISHED_DATA_FALLBACK_MESSAGE)
  })

  it('passes a deliberate HTTP error through unchanged and uncacheable', async () => {
    const { error, headers, status } = await serveOnce(
      definePublishedDataHandler(
        () => {
          throw createError({ statusCode: 404, statusMessage: 'Not Found', message: 'No station' })
        },
        { profile: 'live' },
      ),
    )

    expect(status).toBe(404)
    expect(error?.message).toBe('No station')
    expect(headers.get(CACHE_CONTROL)).toBe(NO_STORE)
    expect(logged).toEqual([])
  })

  it('never advertises a profile the handler already chose against by setting an error status', async () => {
    const { headers, status } = await serveOnce(
      definePublishedDataHandler(
        (event) => {
          setResponseStatus(event, 400)
          return { error: 'bad query' }
        },
        { profile: 'live' },
      ),
    )

    expect(status).toBe(400)
    expect(headers.get(CACHE_CONTROL)).toBe(NO_STORE)
  })

  it('applies the profile after the handler, so it replaces a posture the handler set first', async () => {
    const { headers } = await serveOnce(
      definePublishedDataHandler(
        (event) => {
          setResponseHeader(event, 'Cache-Control', 'no-cache')
          return { ok: true }
        },
        { profile: 'live' },
      ),
    )

    expect(headers.get(CACHE_CONTROL)).toBe(LIVE_CACHE_CONTROL)
  })

  it('applies no rate limit unless the route passes one', async () => {
    const results = await serve(
      definePublishedDataHandler(() => ({ ok: true }), { profile: 'live' }),
      5,
    )

    expect(results.map((result) => result.status)).toEqual([200, 200, 200, 200, 200])
    expect(results[0]?.headers.get('ratelimit-limit')).toBeNull()
  })

  it('rate-limits in front of the read when the route opts in', async () => {
    const read = vi.fn(() => ({ ok: true }))
    const results = await serve(
      definePublishedDataHandler(read, {
        profile: 'live',
        rateLimit: {
          headers: 'none',
          key: 'published-test',
          limit: 2,
          store: createRateLimitWindowStore(),
        },
      }),
      3,
    )

    expect(results.map((result) => result.status)).toEqual([200, 200, 429])
    expect(read).toHaveBeenCalledTimes(2)
    expect(results[0]?.headers.get(CACHE_CONTROL)).toBe(LIVE_CACHE_CONTROL)
    expect(results[2]?.headers.get(CACHE_CONTROL)).toBe(NO_STORE)
  })

  it('rejects a rate limit with no key when the route is defined', () => {
    expect(() =>
      definePublishedDataHandler(() => ({ ok: true }), {
        profile: 'live',
        rateLimit: { limit: 2 } as never,
      }),
    ).toThrow()
  })
})
