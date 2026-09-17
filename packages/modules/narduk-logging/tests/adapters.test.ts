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
  setResponseStatus,
  toNodeListener,
  toWebHandler,
} from 'h3'
import { createHooks } from 'hookable'
import { describe, expect, it, vi } from 'vitest'
import { createLogger } from '../src/index.js'
import { ensureRequestId, installNitroLogging, useLogger } from '../src/h3.js'
import { createMemorySink } from '../src/testing.js'
import { logJob, logRequest } from '../src/worker.js'
import { createNodeLogger } from '../src/node.js'
import type { H3Event } from 'h3'

function event(path = '/items/123?token=synthetic', id?: string): H3Event {
  const request = new IncomingMessage(new Socket())
  request.url = path
  request.method = 'GET'
  if (id) request.headers['x-request-id'] = id
  const event = createEvent(request, new ServerResponse(request))
  event.context.matchedRoute = { path: '/items/:id', handlers: {} }
  return event
}

function setup(level: 'info' | 'silent' = 'info') {
  const sink = createMemorySink()
  const hooks = createHooks<{
    request(event: H3Event): void
    afterResponse(event: H3Event): void
    error(error: Error, context: { event?: H3Event; tags?: string[] }): void
  }>()
  const nitro = { hooks }
  const options = () => ({ service: 'fixture', environment: 'production', level, sinks: [sink] })
  installNitroLogging(nitro, options)
  return { sink, nitro, options }
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
