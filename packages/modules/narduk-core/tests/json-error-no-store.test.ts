import { createServer } from 'node:http'

import { createApp, createError, defineEventHandler, toNodeListener } from 'h3'
// Nitro's real production error handler, the one that answered `no-cache`.
import defaultNitroErrorHandler, {
  defaultHandler,
} from 'nitropack/dist/runtime/internal/error/prod'
import { describe, expect, it, vi } from 'vitest'

import { answerJsonErrorNoStore, isJsonErrorRequest } from '../runtime/server/json-error-no-store'
import { setCacheProfile } from '../runtime/server/utils/cacheProfile'

import type { H3Event } from 'h3'

vi.mock('nitropack/runtime', () => ({ useRuntimeConfig: () => ({}) }))
vi.mock('../runtime/server/utils/runtime-public', () => ({
  resolveRuntimePublicOverlay: () => ({ previewSafeMode: false }),
}))

type ChainHandler = (error: unknown, event: H3Event) => Promise<void> | void

const ours: ChainHandler = (error, event) =>
  answerJsonErrorNoStore(error, event, defaultHandler as never, false)
const nitroBuiltin: ChainHandler = (error, event) =>
  (defaultNitroErrorHandler as unknown as ChainHandler)(error, event)

/**
 * An h3 app whose `onError` walks a handler chain the way Nitro 2.13's
 * generated `#nitro-internal-virtual/error-handler` does: in order, stopping
 * once one has handled the event. Nuxt's handler returns at once for a JSON
 * request, so leaving it out does not change which handler answers.
 */
async function serve(
  chain: ChainHandler[],
  route: (event: H3Event) => unknown,
  path: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  const app = createApp({
    onError: async (error, event) => {
      for (const handler of chain) {
        await handler(error, event)
        if (event.handled) return
      }
    },
  })
  app.use(defineEventHandler(route))
  const server = createServer(toNodeListener(app))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('no port')
    return await fetch(`http://127.0.0.1:${address.port}${path}`, { headers })
  } finally {
    server.close()
  }
}

const MISSING_STATION = '/api/stations/ZZZZZ'
const CACHE_CONTROL = 'cache-control'
const NO_STORE = 'private, no-store'

const notFound = () => {
  throw createError({ statusCode: 404, statusMessage: 'Station not found' })
}

describe('JSON errors leave private, no-store (narduk-libs#493)', () => {
  it("is the gap: Nitro's own handler answers a thrown API 404 with no-cache", async () => {
    const response = await serve([nitroBuiltin], notFound, MISSING_STATION)

    expect(response.status).toBe(404)
    expect(response.headers.get(CACHE_CONTROL)).toBe('no-cache')
  })

  it('answers the same API 404 with private, no-store and the same body', async () => {
    const before = await serve([nitroBuiltin], notFound, MISSING_STATION)
    const after = await serve([ours, nitroBuiltin], notFound, MISSING_STATION)

    expect(after.status).toBe(404)
    expect(after.headers.get(CACHE_CONTROL)).toBe(NO_STORE)
    expect(after.headers.get('content-type')).toBe('application/json')
    // Each call listens on its own port, so only `url` may differ.
    const { url: _afterUrl, ...afterBody } = (await after.json()) as Record<string, unknown>
    const { url: _beforeUrl, ...beforeBody } = (await before.json()) as Record<string, unknown>
    expect(afterBody).toEqual(beforeBody)
    expect(afterBody.statusCode).toBe(404)
  })

  it('covers a page path fetched as JSON, the curl default', async () => {
    const response = await serve([ours, nitroBuiltin], notFound, '/stations/ZZZZZ', {
      'user-agent': 'curl/8.7.1',
    })

    expect(response.status).toBe(404)
    expect(response.headers.get(CACHE_CONTROL)).toBe(NO_STORE)
  })

  it('strips the CDN headers of a route that picked a profile and then threw', async () => {
    const response = await serve(
      [ours, nitroBuiltin],
      (event) => {
        setCacheProfile(event, 'live', { tags: ['stations'] })
        throw createError({ statusCode: 503, statusMessage: 'Upstream down' })
      },
      '/api/stations',
    )

    expect(response.status).toBe(503)
    expect(response.headers.get(CACHE_CONTROL)).toBe(NO_STORE)
    expect(response.headers.get('cdn-cache-control')).toBeNull()
    expect(response.headers.get('cache-tag')).toBeNull()
  })

  it('leaves an HTML request to Nuxt, whose error page error-cache already covers', async () => {
    const response = await serve([ours, nitroBuiltin], notFound, '/stations/ZZZZZ', {
      accept: 'text/html',
    })

    // Nitro's builtin stands in for Nuxt's renderer here: this handler did not answer.
    expect(response.headers.get(CACHE_CONTROL)).toBe('no-cache')
  })

  it('agrees with Nuxt on which requests are JSON', () => {
    const event = (path: string, headers: Record<string, string>) =>
      ({ path, node: { req: { headers } } }) as unknown as H3Event

    expect(isJsonErrorRequest(event('/api/x', {}))).toBe(true)
    expect(isJsonErrorRequest(event('/data.json', {}))).toBe(true)
    expect(isJsonErrorRequest(event('/x', { accept: 'application/json' }))).toBe(true)
    expect(isJsonErrorRequest(event('/x', { 'sec-fetch-mode': 'cors' }))).toBe(true)
    expect(isJsonErrorRequest(event('/x', { 'user-agent': 'HTTPie/3.2' }))).toBe(true)
    expect(isJsonErrorRequest(event('/api/x', { accept: 'text/html,*/*' }))).toBe(false)
    expect(isJsonErrorRequest(event('/x', {}))).toBe(false)
  })
})
