import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

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
import { getClientIp } from '../runtime/server/utils/client-ip'

import type { H3Event } from 'h3'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'

type NodeHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void> | void

// Nitro's local fetch is node-mock-http's `fetchNodeRequestHandler`. It is not a direct dependency
// of this package, so load the copy h3 resolves -- the same 1.0.x Nitro runs.
const requireFromH3 = createRequire(createRequire(import.meta.url).resolve('h3'))
const { fetchNodeRequestHandler } = requireFromH3('node-mock-http') as {
  fetchNodeRequestHandler: (
    handler: NodeHandler,
    input: string,
    init?: RequestInit & { context?: unknown },
  ) => Promise<Response>
}

/** The loop guard the middleware sets on the GET it issues. */
const REENTRY_HEADER = 'x-narduk-head-as-get'

/** A client address a proxy forwarded, and one Cloudflare attested. */
const FORWARDED_CLIENT = '198.51.100.9'
const CLOUDFLARE_CLIENT = '203.0.113.7'

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
    // What the default rate-limit and lockout identity resolves to, and what a route that trusts
    // `x-forwarded-for` (the layer's `enforceRateLimit`) resolves to.
    'x-seen-client-ip': getClientIp(event),
    'x-seen-client-ip-trusted': getClientIp(event, { trustForwardedFor: true }),
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

function buildApp(options: { withMiddleware: boolean }) {
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
  // The listener reads the app's stack per request, so the handlers added below still apply.
  const nodeHandler: NodeHandler = toNodeListener(app)
  const localFetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    fetchNodeRequestHandler(nodeHandler, String(input), init)) as typeof fetch
  // Nitro's own `onRequest` (nitropack `runtime/internal/app`), line for line: spread the local
  // fetch's `_platform` into the context, then install `event.fetch` over the in-process fetch.
  // The inner GET therefore takes the same path it takes in a Nitro app, so the test exercises
  // what actually crosses the hop -- headers and `_platform` -- rather than a stand-in for it.
  app.use(
    defineEventHandler((event) => {
      const fetchContext = (
        event.node.req as { __unenv__?: { _platform?: Record<string, unknown> } }
      ).__unenv__
      if (fetchContext?._platform) {
        event.context = {
          _platform: fetchContext._platform,
          ...fetchContext._platform,
          ...event.context,
        }
      }
      event.fetch = (request, init) => fetchWithEvent(event, request, init, { fetch: localFetch })
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
  const server = createServer(toNodeListener(buildApp({ withMiddleware })))
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected TCP listener')
  return `http://127.0.0.1:${address.port}`
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
    expect(head.headers.get('x-seen-client-ip')).toBe('127.0.0.1')
    expect(head.headers.get('x-seen-client-ip-trusted')).toBe('127.0.0.1')
  })

  it('carries the socket as context, never as a synthesised identity header', async () => {
    // `getClientIp` reads `cf-connecting-ip` first and unconditionally. Writing the socket there
    // (#681) put it ahead of a trusted `x-forwarded-for`, so the inner GET of a route that trusts
    // the forwarded header resolved to the proxy (narduk-libs#683).
    const head = await probe('/api/echo', { headers: { 'x-forwarded-for': FORWARDED_CLIENT } })
    expect(head.headers.get('x-seen-cf-connecting-ip')).toBeNull()
  })

  it('never overrides an identity header the caller already arrived with', async () => {
    const head = await probe('/api/echo', {
      headers: { 'cf-connecting-ip': CLOUDFLARE_CLIENT },
    })
    expect(head.headers.get('x-seen-cf-connecting-ip')).toBe(CLOUDFLARE_CLIENT)
    expect(head.headers.get('x-seen-client-ip')).toBe(CLOUDFLARE_CLIENT)
  })

  it('by default resolves an x-forwarded-for request through the socket, as a direct GET does', async () => {
    // `getClientIp` only reads `x-forwarded-for` when a caller opts in with `trustForwardedFor`
    // (off by default), so a direct GET resolves through the socket. The inner request needs that
    // same socket address, not `undefined`, or it falls to the shared `'unknown'` bucket
    // (narduk-libs#681 review).
    const head = await probe('/api/echo', {
      headers: { 'x-forwarded-for': FORWARDED_CLIENT },
    })
    expect(head.headers.get('x-seen-client-ip')).toBe('127.0.0.1')
    expect(head.headers.get('x-seen-forwarded-for')).toBe(FORWARDED_CLIENT)
  })

  it('gives a route that trusts x-forwarded-for the same client on HEAD as on GET', async () => {
    // Behind a proxy, off Cloudflare: the socket is the proxy, the forwarded header is the client.
    // The GET resolves to the client, so the HEAD must too, or every client behind the proxy
    // shares the proxy's bucket for HEAD alone (narduk-libs#683).
    const headers = { 'x-forwarded-for': `${FORWARDED_CLIENT}, 10.0.0.2` }
    const head = await probe('/api/echo', { headers })
    const get = await probe('/api/echo', { headers, method: 'GET' })
    expect(get.headers.get('x-seen-client-ip-trusted')).toBe(FORWARDED_CLIENT)
    expect(head.headers.get('x-seen-client-ip-trusted')).toBe(FORWARDED_CLIENT)
  })

  it.each([
    ['no identity header', {}],
    ['cf-connecting-ip', { 'cf-connecting-ip': CLOUDFLARE_CLIENT }],
    ['x-forwarded-for', { 'x-forwarded-for': FORWARDED_CLIENT }],
    ['both', { 'cf-connecting-ip': CLOUDFLARE_CLIENT, 'x-forwarded-for': FORWARDED_CLIENT }],
  ])('resolves every identity a HEAD sees exactly as its GET does: %s', async (_label, headers) => {
    // HEAD must not change who the caller is under either resolver, and must not make the inner
    // request carry an identity header the caller did not send.
    const head = await probe('/api/echo', { headers })
    const get = await probe('/api/echo', { headers, method: 'GET' })
    for (const name of [
      'x-seen-client-ip',
      'x-seen-client-ip-trusted',
      'x-seen-cf-connecting-ip',
    ]) {
      expect(head.headers.get(name), name).toBe(get.headers.get(name))
    }
  })

  it('relies on a context channel the installed Nitro still has', () => {
    // The fixture copies Nitro's `onRequest`. If a Nitro upgrade stops spreading the local fetch's
    // `_platform` into the inner context, the socket address stops crossing and HEAD falls back to
    // the shared `'unknown'` bucket -- fail here rather than in production (narduk-libs#683).
    const nitroRoot = dirname(createRequire(import.meta.url).resolve('nitropack/package.json'))
    const app = readFileSync(join(nitroRoot, 'dist/runtime/internal/app.mjs'), 'utf8')
    expect(app).toContain('const fetchContext = event.node.req?.__unenv__;')
    expect(app).toContain('...fetchContext._platform,')
    expect(app).toContain(
      'event.fetch = (req, init) => fetchWithEvent(event, req, init, { fetch: localFetch });',
    )
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
