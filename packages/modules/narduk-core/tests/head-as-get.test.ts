import { createServer } from 'node:http'

import {
  createApp,
  createRouter,
  defineEventHandler,
  fetchWithEvent,
  getQuery,
  getRequestHeader,
  setResponseHeader,
  setResponseStatus,
  toNodeListener,
} from 'h3'
import { afterEach, describe, expect, it } from 'vitest'

import headAsGet from '../runtime/server/middleware/01-head-as-get'

import type { H3Event } from 'h3'
import type { Server } from 'node:http'

/** The loop guard the middleware sets on the GET it issues. */
const REENTRY_HEADER = 'x-narduk-head-as-get'

const servers: Server[] = []

/**
 * The GET side of every fixture route echoes what the handler actually received back as response
 * headers. The middleware copies the GET's headers onto the HEAD, so a HEAD probe can assert what
 * the inner GET saw -- which is the only way to prove the identity forwarding, since the outer
 * request's own headers say nothing about what crossed the hop.
 */
function echoHandler(event: H3Event) {
  const echo: Record<string, string | undefined> = {
    'x-seen-accept': getRequestHeader(event, 'accept'),
    'x-seen-cf-connecting-ip': getRequestHeader(event, 'cf-connecting-ip'),
    'x-seen-forwarded-for': getRequestHeader(event, 'x-forwarded-for'),
    'x-seen-method': event.method,
    'x-seen-query': String(getQuery(event).q ?? ''),
    'x-seen-reentry': getRequestHeader(event, REENTRY_HEADER),
  }
  for (const [name, value] of Object.entries(echo)) {
    if (value) setResponseHeader(event, name, value)
  }
  setResponseHeader(event, 'cache-control', 'no-store')
  return { ok: true, body: 'a body long enough to notice' }
}

function buildApp(options: { baseUrl: () => string; withMiddleware: boolean }) {
  const router = createRouter()
    .get('/api/echo', defineEventHandler(echoHandler))
    .get(
      '/api/failing',
      defineEventHandler((event) => {
        setResponseStatus(event, 503, 'Service Unavailable')
        return { ok: false }
      }),
    )
    .get(
      '/api/cookies',
      defineEventHandler((event) => {
        event.node.res.setHeader('set-cookie', ['a=1, still-a', 'b=2'])
        return { ok: true }
      }),
    )

  const app = createApp()
  // Exactly the line Nitro runs in its own `onRequest`, so the test exercises h3's real
  // header forwarding rather than a stand-in for it.
  app.use(
    defineEventHandler((event) => {
      event.fetch = (request, init) =>
        fetchWithEvent(event, request, init, {
          fetch: ((input: RequestInfo | URL, requestInit?: RequestInit) =>
            fetch(new URL(String(input), options.baseUrl()), requestInit)) as typeof fetch,
        })
    }),
  )
  if (options.withMiddleware) app.use(headAsGet)
  app.use(router)
  // Nuxt registers its renderer as a catch-all handler bound to no method, which is why pages
  // already answer HEAD and API file routes do not. The fixture has to match that shape or the
  // "leave pages alone" case proves nothing.
  app.use(
    '/page',
    defineEventHandler((event) => {
      const marker = getRequestHeader(event, REENTRY_HEADER)
      if (marker) setResponseHeader(event, 'x-seen-reentry', marker)
      setResponseHeader(event, 'x-seen-method', event.method)
      return 'page body'
    }),
  )
  return app
}

async function serve(withMiddleware = true) {
  let base = ''
  const server = createServer(toNodeListener(buildApp({ withMiddleware, baseUrl: () => base })))
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected TCP listener')
  base = `http://127.0.0.1:${address.port}`
  return base
}

async function probe(
  path: string,
  init: { headers?: Record<string, string>; method?: string; withMiddleware?: boolean } = {},
) {
  const base = await serve(init.withMiddleware ?? true)
  const response = await fetch(`${base}${path}`, {
    method: init.method ?? 'HEAD',
    headers: init.headers,
  })
  return {
    body: await response.text(),
    headers: response.headers,
    status: response.status,
  }
}

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          ),
      ),
  )
})

describe('head-as-get middleware', () => {
  it('the bug it fixes is real: without it a GET-only API route 404s on HEAD', async () => {
    const withoutMiddleware = await probe('/api/echo', { withMiddleware: false })
    expect(withoutMiddleware.status).toBe(404)
  })

  it('answers HEAD with the GET status and headers, and no body', async () => {
    const head = await probe('/api/echo')
    expect(head.status).toBe(200)
    expect(head.body).toBe('')
    expect(head.headers.get('cache-control')).toBe('no-store')
    expect(head.headers.get('x-seen-method')).toBe('GET')
  })

  it('reports a failing route as failing rather than as a cheap 200', async () => {
    // The reason HEAD is answered by running the real GET: a monitor that gets a 200 from a
    // hand-written HEAD handler is blind in the direction that matters (narduk-libs#639).
    const head = await probe('/api/failing')
    expect(head.status).toBe(503)
    expect(head.body).toBe('')
  })

  it('drops the headers that frame a body this response does not have', async () => {
    const head = await probe('/api/echo')
    expect(head.headers.get('content-length')).toBeNull()
    expect(head.headers.get('content-encoding')).toBeNull()
    expect(head.headers.get('transfer-encoding')).toBeNull()
  })

  it('translates exactly once: the inner request is marked and a marked HEAD is passed through', async () => {
    const head = await probe('/api/echo')
    expect(head.headers.get('x-seen-reentry')).toBe('1')

    const alreadyMarked = await probe('/api/echo', {
      headers: { [REENTRY_HEADER]: '1' },
    })
    expect(alreadyMarked.status).toBe(404)
  })

  it('leaves non-API paths alone, because pages already answer HEAD', async () => {
    const page = await probe('/page')
    expect(page.status).toBe(200)
    // The page answered the HEAD itself: it was never re-entered as a GET.
    expect(page.headers.get('x-seen-method')).toBe('HEAD')
    expect(page.headers.get('x-seen-reentry')).toBeNull()
  })

  it('leaves methods other than HEAD alone', async () => {
    const get = await probe('/api/echo', { method: 'GET' })
    expect(get.status).toBe(200)
    expect(get.headers.get('x-seen-reentry')).toBeNull()
    expect(get.body).toContain('a body long enough to notice')
  })

  it('carries the caller socket address inward when no identity header arrived', async () => {
    // Without this the inner request has no identity at all and every HEAD in the deployment
    // shares the single `'unknown'` rate-limit bucket (`rate-limit/policy.ts`).
    const head = await probe('/api/echo')
    expect(head.headers.get('x-seen-cf-connecting-ip')).toBe('127.0.0.1')
  })

  it('never overrides an identity header the caller already arrived with', async () => {
    const head = await probe('/api/echo', {
      headers: { 'cf-connecting-ip': '203.0.113.7' },
    })
    expect(head.headers.get('x-seen-cf-connecting-ip')).toBe('203.0.113.7')
  })

  it('never turns a client-chosen forwarded address into the trusted identity header', async () => {
    // `cf-connecting-ip` is read first and unconditionally by `getClientIp`. Synthesising it from
    // `x-forwarded-for` would let a HEAD spend a victim's rate-limit allowance.
    const head = await probe('/api/echo', {
      headers: { 'x-forwarded-for': '198.51.100.9' },
    })
    expect(head.headers.get('x-seen-cf-connecting-ip')).toBeNull()
    expect(head.headers.get('x-seen-forwarded-for')).toBe('198.51.100.9')
  })

  it('forwards accept, which h3 drops from the headers it proxies', async () => {
    const head = await probe('/api/echo', {
      headers: { accept: 'application/json' },
    })
    expect(head.headers.get('x-seen-accept')).toBe('application/json')
  })

  it('preserves the query string', async () => {
    const head = await probe('/api/echo?q=kept')
    expect(head.headers.get('x-seen-query')).toBe('kept')
  })

  it('keeps repeated set-cookie values separate', async () => {
    const head = await probe('/api/cookies')
    expect(head.headers.getSetCookie()).toEqual(['a=1, still-a', 'b=2'])
  })
})
