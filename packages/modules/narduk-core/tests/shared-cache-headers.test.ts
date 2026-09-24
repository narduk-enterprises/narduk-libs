import { createServer } from 'node:http'

import { createApp, createError, defineEventHandler, toNodeListener } from 'h3'
import { describe, expect, it, vi } from 'vitest'

import { setCacheProfile } from '../runtime/server/utils/cacheProfile'
import { isSharedCacheable } from '../runtime/shared/utils/shared-cache'

import type { H3Event } from 'h3'

vi.mock('nitropack/runtime', () => ({
  defineNitroPlugin: (plugin: unknown) => plugin,
  useRuntimeConfig: () => ({}),
}))
vi.mock('../runtime/server/utils/runtime-public', () => ({
  resolveRuntimePublicOverlay: () => ({ previewSafeMode: false }),
}))

const { default: plugin } = await import('../runtime/server/plugins/shared-cache-headers')

type BeforeResponseHook = (event: H3Event, response?: unknown) => void

function beforeResponseHook(): BeforeResponseHook {
  let hook: BeforeResponseHook | undefined
  ;(plugin as (nitro: unknown) => void)({
    hooks: {
      hook: (name: string, handler: BeforeResponseHook) => {
        if (name === 'beforeResponse') hook = handler
      },
    },
  })
  if (!hook) throw new Error('plugin registered no beforeResponse hook')
  return hook
}

async function respond(
  handler: (event: H3Event) => unknown,
): Promise<{ headers: Headers; status: number }> {
  const beforeResponse = beforeResponseHook()
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
    await response.text()
    return { headers: response.headers, status: response.status }
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
}

const X_REQUEST_ID = 'x-request-id'
const REMAINING = 'ratelimit-remaining'

const QUOTA: Record<string, string> = {
  RateLimit: '"route";r=41;t=12',
  'RateLimit-Policy': '"route";q=60;w=60',
  'RateLimit-Limit': '60',
  'RateLimit-Remaining': '41',
  'RateLimit-Reset': '12',
}

function writeQuota(event: H3Event): void {
  for (const [name, value] of Object.entries(QUOTA)) event.node.res.setHeader(name, value)
}

/**
 * narduk-libs#412 (second half) and #418: whatever wrote a per-request header
 * *after* the route chose a shared-cacheable profile, the response a shared
 * cache receives must not carry it. Order of operations stops mattering.
 */
describe('shared-cache-headers Nitro plugin', () => {
  it('strips a RateLimit family written after a live profile', async () => {
    const { headers } = await respond((event) => {
      setCacheProfile(event, 'live')
      writeQuota(event)
      event.node.res.setHeader(X_REQUEST_ID, 'late-id')
      event.node.res.setHeader('server-timing', 'total;dur=3')
      event.node.res.setHeader('Retry-After', '12')
    })

    for (const name of [...Object.keys(QUOTA), X_REQUEST_ID, 'server-timing', 'retry-after']) {
      expect(headers.get(name), name).toBeNull()
    }
    expect(headers.get('cdn-cache-control')).toBe('public, max-age=300, stale-while-revalidate=900')
  })

  it('treats a CDN-only edge directive as shared-cacheable', async () => {
    const { headers } = await respond((event) => {
      event.node.res.setHeader('CDN-Cache-Control', 'max-age=300')
      writeQuota(event)
    })
    expect(headers.get(REMAINING)).toBeNull()
  })

  it('leaves a private or unprofiled response alone', async () => {
    for (const setup of [
      (event: H3Event) => setCacheProfile(event, 'none'),
      (event: H3Event) => event.node.res.setHeader('Cache-Control', 'private, max-age=60'),
      (_event: H3Event) => {},
    ]) {
      const { headers } = await respond((event) => {
        setup(event)
        writeQuota(event)
        event.node.res.setHeader(X_REQUEST_ID, 'mine')
      })
      expect(headers.get(REMAINING)).toBe('41')
      expect(headers.get(X_REQUEST_ID)).toBe('mine')
    }
  })

  it('keeps Retry-After and the quota family on a thrown 429', async () => {
    const { headers, status } = await respond((event) => {
      setCacheProfile(event, 'live')
      writeQuota(event)
      event.node.res.setHeader('Retry-After', '12')
      throw createError({ statusCode: 429, statusMessage: 'Too Many Requests' })
    })
    expect(status).toBe(429)
    expect(headers.get('retry-after')).toBe('12')
    expect(headers.get(REMAINING)).toBe('41')
  })

  it('strips per-request headers a returned web Response carries', async () => {
    const { headers } = await respond(
      () =>
        new Response('{}', {
          headers: {
            'cache-control': 'public, max-age=60',
            'content-type': 'application/json',
            [REMAINING]: '41',
            [X_REQUEST_ID]: 'returned-id',
          },
        }),
    )
    expect(headers.get('cache-control')).toBe('public, max-age=60')
    expect(headers.get(REMAINING)).toBeNull()
    expect(headers.get(X_REQUEST_ID)).toBeNull()
  })
})

describe('isSharedCacheable', () => {
  it.each([
    [{ 'cache-control': 'public, max-age=60' }, true],
    [{ 'cache-control': 'max-age=60' }, true],
    [{ 'cache-control': 's-maxage=60' }, true],
    [{ 'cache-control': 'public, immutable' }, true],
    [{ 'cdn-cache-control': 'max-age=300' }, true],
    [{ 'cloudflare-cdn-cache-control': 'max-age=300' }, true],
    [{ 'cache-control': 'private, no-store' }, false],
    [{ 'cache-control': 'private, max-age=60' }, false],
    [{ 'cache-control': 'no-store' }, false],
    [{ 'cache-control': 'max-age=0' }, false],
    [{ 'cache-control': 'private', 'cdn-cache-control': 'max-age=300' }, false],
    [{ 'cdn-cache-control': 'no-store' }, false],
    [{}, false],
  ])('%o -> %s', (headers, expected) => {
    expect(isSharedCacheable((name) => (headers as Record<string, string>)[name])).toBe(expected)
  })
})
