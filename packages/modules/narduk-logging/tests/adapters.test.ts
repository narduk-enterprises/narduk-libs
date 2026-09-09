import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { createEvent, getResponseHeader, setResponseStatus } from 'h3'
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

  it('completes failures after the response and does not duplicate error hooks', async () => {
    const { sink, nitro } = setup()
    const request = event()
    await nitro.hooks.callHook('request', request)
    const failure = new Error('Synthetic failure', { cause: new Error('Synthetic cause') })
    await nitro.hooks.callHook('error', failure, { event: request, tags: ['request'] })
    await nitro.hooks.callHook('error', failure, { event: request, tags: ['request'] })
    expect(sink.records).toHaveLength(0)
    setResponseStatus(request, 503)
    await nitro.hooks.callHook('afterResponse', request)
    expect(sink.records).toHaveLength(1)
    expect(sink.records[0]).toMatchObject({
      level: 'error',
      data: { status: 503 },
      error: { name: 'Error', message: 'Synthetic failure' },
    })
    expect(sink.records[0]?.error).not.toHaveProperty('stack')
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
