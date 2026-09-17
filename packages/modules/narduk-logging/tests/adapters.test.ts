import { createServer, IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import {
  createApp,
  createError,
  createEvent,
  createRouter,
  defineEventHandler,
  getResponseHeader,
  send,
  setResponseHeader,
  setResponseStatus,
  toNodeListener,
  toWebHandler,
} from 'h3'
import { createHooks } from 'hookable'
import { describe, expect, it, vi } from 'vitest'
import { createLogger } from '../src/index.js'
import {
  ensureRequestId,
  installNitroLogging,
  requestIdHeaders,
  useLogger,
  useRequestTiming,
} from '../src/h3.js'
import { createMemorySink } from '../src/testing.js'
import { logJob, logRequest } from '../src/worker.js'
import { createNodeLogger } from '../src/node.js'
import type { H3Event } from 'h3'

function event(
  path = '/items/123?token=synthetic',
  id?: string,
  headers: Record<string, string> = {},
): H3Event {
  const request = new IncomingMessage(new Socket())
  request.url = path
  request.method = 'GET'
  if (id) request.headers['x-request-id'] = id
  for (const [name, value] of Object.entries(headers)) request.headers[name] = value
  const event = createEvent(request, new ServerResponse(request))
  event.context.matchedRoute = { path: '/items/:id', handlers: {} }
  return event
}

function setup(level: 'info' | 'silent' = 'info') {
  const sink = createMemorySink()
  const hooks = createHooks<NitroHooks>()
  const nitro = { hooks }
  const options = () => ({ service: 'fixture', environment: 'production', level, sinks: [sink] })
  installNitroLogging(nitro, options)
  return { sink, nitro, options }
}

interface NitroHooks {
  request(event: H3Event): void
  beforeResponse(event: H3Event): void
  afterResponse(event: H3Event): void
  error(error: Error, context: { event?: H3Event; tags?: string[] }): void
}

/**
 * A real Nitro-shaped app: `beforeResponse`/`afterResponse` are wired exactly as
 * `nitropack/dist/runtime/internal/app.mjs` wires them, so a hook that runs too late here runs
 * too late in production. `serve` puts it behind a real `http.Server` (the node-server preset,
 * `nuxt dev`, `nuxt preview`); `fetchWeb` drives the same app through h3's web handler, the shape
 * the Cloudflare preset uses. narduk-libs#395: the header was set from `afterResponse`, which h3
 * calls *after* the response is written, so it reached the Workers path and never the Node one.
 */
function nitroApp(options: () => Record<string, unknown>) {
  const hooks = createHooks<NitroHooks>()
  installNitroLogging({ hooks }, options as never)
  const app = createApp({
    onRequest: (event) => hooks.callHook('request', event),
    onBeforeResponse: (event) => hooks.callHook('beforeResponse', event),
    onAfterResponse: (event) => hooks.callHook('afterResponse', event),
    onError: (error, event) => hooks.callHook('error', error, { event, tags: ['request'] }),
  })
  return {
    app,
    use: (router: ReturnType<typeof createRouter>) => app.use(router),
    async serve(path: string): Promise<Response> {
      const server = createServer(toNodeListener(app))
      try {
        await new Promise<void>((resolve) => server.listen(0, resolve))
        const address = server.address()
        const port = typeof address === 'object' && address ? address.port : 0
        return await fetch(`http://127.0.0.1:${port}${path}`)
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()))
      }
    },
    fetchWeb(path: string): Promise<Response> {
      return toWebHandler(app)(new Request(`http://fixture.invalid${path}`))
    },
  }
}

describe('Nitro request lifecycle', () => {
  it('registers once, validates IDs, and emits one completion with a route template', async () => {
    const { sink, nitro, options } = setup()
    installNitroLogging(nitro, options)
    const request = event(undefined, 'invalid id with spaces')
    await nitro.hooks.callHook('request', request)
    useLogger(request).info('Read')
    await nitro.hooks.callHook('afterResponse', request)
    await nitro.hooks.callHook('afterResponse', request)
    expect(sink.records.filter((record) => record.message === 'Request completed')).toHaveLength(1)
    expect(sink.records.every((record) => record.path === '/items/:id')).toBe(true)
    expect(getResponseHeader(request, 'x-request-id')).toBe(ensureRequestId(request))
    expect(ensureRequestId(request)).not.toContain(' ')
    expect(JSON.stringify(sink.records)).not.toContain('synthetic')
  })

  it('isolates overlapping requests and accepts safe caller correlation IDs', async () => {
    const { sink, nitro } = setup()
    const first = event(undefined, 'first'),
      second = event(undefined, 'second')
    await Promise.all([
      nitro.hooks.callHook('request', first),
      nitro.hooks.callHook('request', second),
    ])
    useLogger(second).info('Second')
    useLogger(first).info('First')
    expect(sink.records.map((record) => record.requestId)).toEqual(['second', 'first'])
  })

  it('completes failures from the error hook and does not duplicate the summary', async () => {
    const { sink, nitro } = setup()
    const request = event()
    await nitro.hooks.callHook('request', request)
    const failure = Object.assign(
      new Error('Synthetic failure', { cause: new Error('Synthetic cause') }),
      { statusCode: 503 },
    )
    await nitro.hooks.callHook('error', failure, { event: request, tags: ['request'] })
    expect(sink.records).toHaveLength(1)
    expect(sink.records[0]).toMatchObject({
      message: 'Request completed',
      level: 'error',
      data: { status: 503 },
      error: { name: 'Error', message: 'Synthetic failure' },
    })
    expect(sink.records[0]?.error).not.toHaveProperty('stack')
    // afterResponse is unreachable behind a sent error response, but a runtime that does
    // reach it must not produce a second summary.
    setResponseStatus(request, 503)
    await nitro.hooks.callHook('afterResponse', request)
    await nitro.hooks.callHook('error', failure, { event: request, tags: ['request'] })
    expect(sink.records.filter((record) => record.message === 'Request completed')).toHaveLength(1)
    expect(sink.records[1]?.message).toBe('Captured server error')
  })

  it('suppresses normal health noise but retains failures and post-response errors', async () => {
    const { sink, nitro } = setup()
    const health = event('/api/health')
    await nitro.hooks.callHook('request', health)
    await nitro.hooks.callHook('afterResponse', health)
    expect(sink.records).toHaveLength(0)
    await nitro.hooks.callHook('error', new Error('Background failure'), { event: health })
    expect(sink.records[0]?.message).toBe('Captured server error')
    const failed = event('/api/health')
    await nitro.hooks.callHook('request', failed)
    setResponseStatus(failed, 500)
    await nitro.hooks.callHook('afterResponse', failed)
    expect(sink.records[1]?.data?.status).toBe(500)
  })

  it('applies silent to all lifecycle paths, including errors without requests', async () => {
    const { sink, nitro } = setup('silent')
    const request = event()
    await nitro.hooks.callHook('request', request)
    await nitro.hooks.callHook('error', new Error('Failure'), { event: request })
    await nitro.hooks.callHook('error', new Error('Global failure'), {})
    setResponseStatus(request, 500)
    await nitro.hooks.callHook('afterResponse', request)
    expect(sink.records).toHaveLength(0)
  })
})

describe('Request ID fallback and outbound headers', () => {
  it('falls back to cf-ray when the caller sends no request ID', () => {
    const request = event(undefined, undefined, { 'cf-ray': '830b3a1f9c1b4e9a-DFW' })
    expect(ensureRequestId(request)).toBe('830b3a1f9c1b4e9a-DFW')
  })

  it('prefers a valid caller-supplied ID over cf-ray', () => {
    const request = event(undefined, 'caller-id', { 'cf-ray': '830b3a1f9c1b4e9a-DFW' })
    expect(ensureRequestId(request)).toBe('caller-id')
  })

  it('ignores an unsafe caller ID and an unsafe cf-ray fallback, generating a UUID', () => {
    const request = event(undefined, 'bad id with spaces', { 'cf-ray': 'also bad; ray' })
    const id = ensureRequestId(request)
    expect(id).not.toContain(' ')
    expect(id).not.toContain(';')
  })

  it('generates a UUID when neither the caller nor cf-ray supply an ID', () => {
    const request = event()
    expect(typeof ensureRequestId(request)).toBe('string')
    expect(ensureRequestId(request).length).toBeGreaterThan(0)
  })

  it('returns a forwardable header bag for outbound calls', () => {
    expect(requestIdHeaders('abc-123')).toEqual({ 'x-request-id': 'abc-123' })
  })
})

describe('Server-Timing and slow-route logging (h3/Nitro)', () => {
  it('emits a total-only header by default, even when the route never touches timing', async () => {
    const { sink, nitro } = setup()
    const request = event()
    await nitro.hooks.callHook('request', request)
    await nitro.hooks.callHook('beforeResponse', request)
    await nitro.hooks.callHook('afterResponse', request)
    expect(getResponseHeader(request, 'server-timing')).toMatch(/^total;dur=\d+$/)
    expect(sink.records).toHaveLength(1)
  })

  it('exposes named phases only once the route opts in via useRequestTiming', async () => {
    const { nitro } = setup()
    const request = event()
    await nitro.hooks.callHook('request', request)
    const timing = useRequestTiming(request, { exposePhases: true })
    timing.mark('auth')
    timing.mark('board', '18 stmt / 11 rt')
    await nitro.hooks.callHook('beforeResponse', request)
    await nitro.hooks.callHook('afterResponse', request)
    const header = getResponseHeader(request, 'server-timing') as string
    expect(header).toMatch(/^auth;dur=\d+, board;dur=\d+;desc="18 stmt \/ 11 rt", total;dur=\d+$/)
  })

  it('keeps phases out of the header when useRequestTiming is called without exposePhases', async () => {
    const { nitro } = setup()
    const request = event()
    await nitro.hooks.callHook('request', request)
    useRequestTiming(request).mark('auth')
    await nitro.hooks.callHook('beforeResponse', request)
    await nitro.hooks.callHook('afterResponse', request)
    expect(getResponseHeader(request, 'server-timing')).toMatch(/^total;dur=\d+$/)
  })

  it('logs a structured warning when total duration exceeds the configured threshold', async () => {
    const sink = createMemorySink()
    const hooks = createHooks<{
      request(event: H3Event): void
      afterResponse(event: H3Event): void
      error(error: Error, context: { event?: H3Event; tags?: string[] }): void
    }>()
    const nitro = { hooks }
    installNitroLogging(nitro, () => ({
      service: 'fixture',
      environment: 'production',
      sinks: [sink],
      slowRouteThresholdMs: -1, // any nonnegative duration exceeds this, deterministically
    }))
    const request = event()
    await nitro.hooks.callHook('request', request)
    await nitro.hooks.callHook('afterResponse', request)
    const slow = sink.records.find((record) => record.message === 'Slow route')
    expect(slow).toBeDefined()
    expect(slow).toMatchObject({ level: 'warn', path: '/items/:id', method: 'GET' })
    expect(typeof slow?.data?.durationMs).toBe('number')
    expect(slow?.data?.status).toBe(200)
    expect(slow?.requestId).toBe(ensureRequestId(request))
  })

  it('never logs a slow-route warning when no threshold is configured (disabled by default)', async () => {
    const { sink, nitro } = setup()
    const request = event()
    await nitro.hooks.callHook('request', request)
    await nitro.hooks.callHook('afterResponse', request)
    expect(sink.records.some((record) => record.message === 'Slow route')).toBe(false)
  })

  it('does not log slow-route below the threshold', async () => {
    const sink = createMemorySink()
    const hooks = createHooks<{
      request(event: H3Event): void
      afterResponse(event: H3Event): void
      error(error: Error, context: { event?: H3Event; tags?: string[] }): void
    }>()
    const nitro = { hooks }
    installNitroLogging(nitro, () => ({
      service: 'fixture',
      environment: 'production',
      sinks: [sink],
      slowRouteThresholdMs: Number.MAX_SAFE_INTEGER,
    }))
    const request = event()
    await nitro.hooks.callHook('request', request)
    await nitro.hooks.callHook('afterResponse', request)
    expect(sink.records.some((record) => record.message === 'Slow route')).toBe(false)
  })
})

describe('Workers and Node', () => {
  it('preserves streaming responses and adds correlation without logging URL input', async () => {
    const sink = createMemorySink()
    const logger = createLogger({ service: 'fixture', environment: 'test', sinks: [sink] })
    const upstream = new Response('streamed body', {
      status: 201,
      headers: { 'x-existing': 'kept' },
    })
    const response = await logRequest(
      new Request('https://example.invalid/private?token=synthetic'),
      logger,
      () => upstream,
      { route: '/items/:id' },
    )
    expect(response.status).toBe(201)
    expect(response.headers.get('x-existing')).toBe('kept')
    expect(response.headers.get('x-request-id')).toBe(sink.records[0]?.requestId)
    expect(await response.text()).toBe('streamed body')
    expect(sink.records[0]?.path).toBe('/items/:id')
  })

  it('falls back to cf-ray for the correlation ID and always emits a total-only header', async () => {
    const sink = createMemorySink()
    const logger = createLogger({ service: 'fixture', environment: 'test', sinks: [sink] })
    const response = await logRequest(
      new Request('https://example.invalid/items/7', {
        headers: { 'cf-ray': '830b3a1f9c1b4e9a-DFW' },
      }),
      logger,
      () => new Response('ok'),
      { route: '/items/:id' },
    )
    expect(response.headers.get('x-request-id')).toBe('830b3a1f9c1b4e9a-DFW')
    expect(sink.records[0]?.requestId).toBe('830b3a1f9c1b4e9a-DFW')
    expect(response.headers.get('server-timing')).toMatch(/^total;dur=\d+$/)
  })

  it('exposes phases marked via the timing argument only when opted in', async () => {
    const sink = createMemorySink()
    const logger = createLogger({ service: 'fixture', environment: 'test', sinks: [sink] })
    const response = await logRequest(
      new Request('https://example.invalid/items/7'),
      logger,
      async (_log, timing) => {
        await timing.measure('upstream', async () => {})
        return new Response('ok')
      },
      { route: '/items/:id', timingExposePhases: true },
    )
    expect(response.headers.get('server-timing')).toMatch(/^upstream;dur=\d+, total;dur=\d+$/)
  })

  it('logs a slow-route warning on a successful response over threshold', async () => {
    const sink = createMemorySink()
    const logger = createLogger({ service: 'fixture', environment: 'test', sinks: [sink] })
    await logRequest(
      new Request('https://example.invalid/items/7'),
      logger,
      () => new Response('ok'),
      {
        route: '/items/:id',
        slowRouteThresholdMs: -1,
      },
    )
    const slow = sink.records.find((record) => record.message === 'Slow route')
    expect(slow).toMatchObject({ level: 'warn', path: '/items/:id', data: { status: 200 } })
  })

  it('logs a slow-route warning when the handler throws over threshold, without suppressing it', async () => {
    const sink = createMemorySink()
    const logger = createLogger({ service: 'fixture', environment: 'test', sinks: [sink] })
    const original = new Error('Synthetic failure')
    await expect(
      logRequest(
        new Request('https://example.invalid/items/7'),
        logger,
        () => {
          throw original
        },
        { route: '/items/:id', slowRouteThresholdMs: -1 },
      ),
    ).rejects.toBe(original)
    const slow = sink.records.find((record) => record.message === 'Slow route')
    expect(slow).toMatchObject({ level: 'warn', data: { status: 500 } })
  })

  it('never logs slow-route when no threshold is configured', async () => {
    const sink = createMemorySink()
    const logger = createLogger({ service: 'fixture', environment: 'test', sinks: [sink] })
    await logRequest(
      new Request('https://example.invalid/items/7'),
      logger,
      () => new Response('ok'),
      {
        route: '/items/:id',
      },
    )
    expect(sink.records.some((record) => record.message === 'Slow route')).toBe(false)
  })

  it('preserves thrown HTTP errors and queue retry or acknowledgment decisions', async () => {
    const sink = createMemorySink()
    const logger = createLogger({ service: 'fixture', environment: 'test', sinks: [sink] })
    const original = new Error('Synthetic failure')
    await expect(
      logRequest(new Request('https://example.invalid'), logger, () => {
        throw original
      }),
    ).rejects.toBe(original)
    const batch = { ackAll: vi.fn(), retryAll: vi.fn() }
    await expect(
      logJob(logger, 'queue', () => {
        batch.retryAll()
        throw original
      }),
    ).rejects.toBe(original)
    expect(batch.retryAll).toHaveBeenCalledOnce()
    expect(batch.ackAll).not.toHaveBeenCalled()
    expect(await logJob(logger, 'scheduled', () => 42)).toBe(42)
    expect(sink.records[1]).toMatchObject({
      source: 'job',
      data: { operation: 'queue', outcome: 'failure' },
    })
  })

  it('keeps Node diagnostics off stdout and sanitizes terminal output', () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    try {
      createNodeLogger({ service: 'fixture', environment: 'production' }).info('Ready', {
        token: 'synthetic',
      })
      expect(stdout).not.toHaveBeenCalled()
      expect(stderr).toHaveBeenCalledOnce()
      expect(String(stderr.mock.calls[0]?.[0])).toContain('[REDACTED]')
    } finally {
      stderr.mockRestore()
      stdout.mockRestore()
    }
  })
})

/**
 * The unit suites above drive the hooks directly. This one drives real h3 routing so the
 * reproduction for narduk-libs#356 is the runtime's own ordering rather than a hand-made
 * sequence: h3 sends the error response from `onError` and then returns, so `onAfterResponse`
 * never runs on a failing request in either the Node listener or the fetch handler that the
 * Cloudflare Worker artifact is built from.
 */
describe('Nitro-shaped lifecycle over real h3 routing', () => {
  function lifecycle() {
    const sink = createMemorySink()
    const seen: string[] = []
    const hooks = createHooks<{
      request(event: H3Event): void
      afterResponse(event: H3Event): void
      error(error: Error, context: { event?: H3Event; tags?: string[] }): void
    }>()
    installNitroLogging({ hooks }, () => ({
      service: 'fixture',
      environment: 'production',
      level: 'info',
      sinks: [sink],
    }))
    const app = createApp({
      onRequest: async (request) => {
        seen.push('request')
        await hooks.callHook('request', request)
      },
      // Mirrors nitropack's own onError: capture, then let the error handler send the response.
      onError: async (failure, request) => {
        seen.push('error')
        await hooks.callHook('error', failure, { event: request, tags: ['request'] })
        setResponseStatus(request, failure.statusCode)
        return send(request, JSON.stringify({ error: true, statusCode: failure.statusCode }))
      },
      onAfterResponse: async (request) => {
        seen.push('afterResponse')
        await hooks.callHook('afterResponse', request)
      },
    })
    const router = createRouter({ preemptive: true })
    router.get(
      '/api/items/:id',
      defineEventHandler(() => ({ ok: true })),
    )
    router.get(
      '/api/unavailable',
      defineEventHandler(() => {
        throw createError({ statusCode: 503, statusMessage: 'Service Unavailable' })
      }),
    )
    router.get(
      '/api/broken',
      defineEventHandler(() => {
        throw new Error('Synthetic handler failure')
      }),
    )
    app.use(router)
    return { sink, seen, app }
  }

  async function overNode(app: ReturnType<typeof lifecycle>['app'], path: string) {
    const server = createServer(toNodeListener(app))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0
    try {
      const response = await fetch(`http://127.0.0.1:${port}${path}`)
      await response.text()
      return response.status
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }

  async function overFetch(app: ReturnType<typeof lifecycle>['app'], path: string) {
    const response = await toWebHandler(app)(new Request(`https://fixture.invalid${path}`))
    await response.text()
    return response.status
  }

  for (const [runtime, call] of Object.entries({
    'node listener': overNode,
    'fetch handler': overFetch,
  })) {
    it(`emits exactly one summary per request over the ${runtime}`, async () => {
      for (const [path, status, template, level, withError] of [
        ['/api/items/7', 200, '/api/items/:id', 'info', false],
        ['/api/unavailable', 503, '/api/unavailable', 'error', true],
        ['/api/broken', 500, '/api/broken', 'error', true],
        ['/api/nope', 404, '/[unmatched]', 'info', false],
      ] as const) {
        const { sink, seen, app } = lifecycle()
        expect(await call(app, path)).toBe(status)
        const summaries = sink.records.filter((record) => record.message === 'Request completed')
        expect(summaries, `${runtime} ${path}`).toHaveLength(1)
        expect(summaries[0]).toMatchObject({
          level,
          path: template,
          method: 'GET',
          data: { status },
        })
        expect(typeof summaries[0]?.requestId).toBe('string')
        expect(typeof summaries[0]?.data?.durationMs).toBe('number')
        expect(Object.hasOwn(summaries[0] ?? {}, 'error')).toBe(withError)
        // The failing paths prove why the error hook has to complete the record itself.
        expect(seen.includes('afterResponse')).toBe(status < 400)
      }
    })
  }

  it('keeps the unmatched request target out of the 404 summary', async () => {
    const { sink, app } = lifecycle()
    expect(await overFetch(app, '/api/nope?token=synthetic')).toBe(404)
    expect(JSON.stringify(sink.records)).not.toContain('synthetic')
    expect(JSON.stringify(sink.records)).not.toContain('/api/nope')
  })
})

describe('Server-Timing reaches a real response (narduk-libs#395)', () => {
  function app(options: Record<string, unknown> = {}) {
    const sink = createMemorySink()
    const host = nitroApp(() => ({
      service: 'fixture',
      environment: 'production',
      sinks: [sink],
      ...options,
    }))
    const router = createRouter()
    router.get(
      '/items/:id',
      defineEventHandler((event) => {
        useRequestTiming(event).mark('db')
        return { ok: true }
      }),
    )
    router.get(
      '/cached',
      defineEventHandler((event) => {
        setResponseHeader(event, 'cache-control', 'public, max-age=3600')
        return { ok: true }
      }),
    )
    router.get(
      '/private',
      defineEventHandler((event) => {
        setResponseHeader(event, 'cache-control', 'private, max-age=60')
        return { ok: true }
      }),
    )
    router.get(
      '/upstream-timing',
      defineEventHandler((event) => {
        setResponseHeader(event, 'server-timing', 'cf-cache;dur=3')
        return { ok: true }
      }),
    )
    router.get(
      '/boom',
      defineEventHandler(() => {
        throw createError({ statusCode: 500, message: 'Synthetic failure' })
      }),
    )
    host.use(router)
    return { sink, host }
  }

  it('sets the header on a 200 served by a real Node http server', async () => {
    // Regression: stamped from `afterResponse`, h3 has already ended the response here and
    // `headersSent` is true, so every successful Node response went out with no header at all.
    const response = await app().host.serve('/items/7')
    expect(response.status).toBe(200)
    expect(response.headers.get('server-timing')).toMatch(/^total;dur=\d+$/)
    expect(response.headers.get('x-request-id')).toBeTruthy()
  })

  it('sets the header on a 200 through the web handler the Workers preset uses', async () => {
    const response = await app().host.fetchWeb('/items/7')
    expect(response.status).toBe(200)
    expect(response.headers.get('server-timing')).toMatch(/^total;dur=\d+$/)
  })

  it('still carries the ID and timing on a failing response', async () => {
    const response = await app().host.serve('/boom')
    expect(response.status).toBe(500)
    expect(response.headers.get('server-timing')).toMatch(/total;dur=\d+/)
    expect(response.headers.get('x-request-id')).toBeTruthy()
  })

  it('exposes phases end to end once the plugin opts in', async () => {
    const response = await app({ timingExposePhases: true }).host.serve('/items/7')
    expect(response.headers.get('server-timing')).toMatch(/^db;dur=\d+, total;dur=\d+$/)
  })

  it('leaves a shared-cacheable response free of per-request headers', async () => {
    // The edge stores this body; a request ID baked into it would be replayed to every later
    // client, so a log search for that ID would answer one request while the header claims many.
    const response = await app().host.serve('/cached')
    expect(response.headers.get('cache-control')).toBe('public, max-age=3600')
    expect(response.headers.get('x-request-id')).toBeNull()
    expect(response.headers.get('server-timing')).toBeNull()
  })

  it('still stamps a response that is only privately cacheable', async () => {
    const response = await app().host.serve('/private')
    expect(response.headers.get('x-request-id')).toBeTruthy()
    expect(response.headers.get('server-timing')).toMatch(/total;dur=\d+/)
  })

  it('appends to an upstream Server-Timing instead of clobbering it', async () => {
    const response = await app().host.serve('/upstream-timing')
    expect(response.headers.get('server-timing')).toMatch(/^cf-cache;dur=3, total;dur=\d+$/)
  })
})

describe('Slow-route logging respects the routes an app silenced', () => {
  function host(options: Record<string, unknown>) {
    const sink = createMemorySink()
    const hooks = createHooks<NitroHooks>()
    const nitro = { hooks }
    installNitroLogging(nitro, () => ({
      service: 'fixture',
      environment: 'production',
      sinks: [sink],
      ...options,
    }))
    return { sink, nitro }
  }

  async function run(nitro: ReturnType<typeof host>['nitro'], request: H3Event) {
    await nitro.hooks.callHook('request', request)
    await nitro.hooks.callHook('beforeResponse', request)
    await nitro.hooks.callHook('afterResponse', request)
  }

  it('stays quiet on a skipped path', async () => {
    const { sink, nitro } = host({ slowRouteThresholdMs: -1 })
    await run(nitro, event('/api/health'))
    expect(sink.records.some((record) => record.message === 'Slow route')).toBe(false)
  })

  it('stays quiet when request logging is switched off', async () => {
    const { sink, nitro } = host({ slowRouteThresholdMs: -1, requestLogging: false })
    await run(nitro, event())
    expect(sink.records.some((record) => record.message === 'Slow route')).toBe(false)
  })

  it('still reports a slow failure on an otherwise skipped path', async () => {
    const { sink, nitro } = host({ slowRouteThresholdMs: -1 })
    const request = event('/api/health')
    await nitro.hooks.callHook('request', request)
    setResponseStatus(request, 500)
    await nitro.hooks.callHook('afterResponse', request)
    expect(sink.records.some((record) => record.message === 'Slow route')).toBe(true)
  })
})

describe('Worker response stamping', () => {
  const logger = () => createLogger({ service: 'fixture', environment: 'test', sinks: [] })

  it('leaves a shared-cacheable response unstamped', async () => {
    const response = await logRequest(
      new Request('https://example.invalid/a'),
      logger(),
      () => new Response('ok', { headers: { 'cache-control': 's-maxage=60' } }),
      { route: '/a' },
    )
    expect(response.headers.get('x-request-id')).toBeNull()
    expect(response.headers.get('server-timing')).toBeNull()
  })

  it('stamps a no-store response', async () => {
    const response = await logRequest(
      new Request('https://example.invalid/a'),
      logger(),
      () => new Response('ok', { headers: { 'cache-control': 'public, no-store' } }),
      { route: '/a' },
    )
    expect(response.headers.get('x-request-id')).toBeTruthy()
  })

  it('appends to an upstream Server-Timing instead of clobbering it', async () => {
    const response = await logRequest(
      new Request('https://example.invalid/a'),
      logger(),
      () => new Response('ok', { headers: { 'server-timing': 'cf-cache;dur=3' } }),
      { route: '/a' },
    )
    expect(response.headers.get('server-timing')).toMatch(/^cf-cache;dur=3, total;dur=\d+$/)
  })
})
