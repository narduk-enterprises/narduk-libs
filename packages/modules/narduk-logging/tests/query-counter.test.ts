/**
 * narduk-libs#325: the statement / round-trip counter contract.
 *
 * Two counters, not one: batching eight reads moves round trips and leaves the statement count
 * where it was, and deleting a query does the opposite. The counter is driver-agnostic -- a D1,
 * Postgres or HTTP fan-out wrapper calls `recordRoundTrip(statements)` -- and the phase timer
 * reads it, so each marked phase reports its own delta.
 */
import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'

import { createEvent, getResponseHeader } from 'h3'
import { createHooks } from 'hookable'
import { describe, expect, it } from 'vitest'

import { createLogger, formatQueryCounts, QueryCounter, RequestTiming } from '../src/index.js'
import { installNitroLogging, useRequestCounter, useRequestTiming } from '../src/h3.js'
import { createMemorySink } from '../src/testing.js'
import { logRequest } from '../src/worker.js'

import type { H3Event } from 'h3'

function clockFrom(...ticks: number[]): () => number {
  const queue = [...ticks]
  return () => queue.shift() ?? queue[queue.length - 1] ?? 0
}

describe('QueryCounter', () => {
  it('counts a batch of eight as eight statements and one round trip', () => {
    const counter = new QueryCounter()
    counter.recordRoundTrip()
    counter.recordRoundTrip(8)
    expect(counter.counts()).toEqual({ roundTrips: 2, statements: 9 })
  })

  it('never throws on a bad statement count: an instrument must not fail the request', () => {
    const counter = new QueryCounter()
    expect(() => {
      counter.recordRoundTrip(Number.NaN)
      counter.recordRoundTrip(-3)
      counter.recordRoundTrip(2.7)
    }).not.toThrow()
    expect(counter.counts()).toEqual({ roundTrips: 3, statements: 2 })
  })

  it('formats with a separator that is not a comma', () => {
    expect(formatQueryCounts({ roundTrips: 13, statements: 20 })).toBe('20 stmt / 13 rt')
  })
})

describe('RequestTiming with a counter', () => {
  it('renders the per-phase delta and the request total, as #325 specifies', () => {
    const timing = new RequestTiming({
      clock: clockFrom(0, 0, 17, 31, 305, 305),
      exposePhases: true,
    })
    timing.mark('auth')
    timing.counter.recordRoundTrip()
    timing.mark('scope')
    timing.counter.recordRoundTrip()
    timing.mark('generation')
    for (let index = 0; index < 10; index += 1) timing.counter.recordRoundTrip()
    timing.counter.recordRoundTrip(8)
    timing.mark('board')
    expect(timing.header()).toBe(
      'auth;dur=0;desc="0 stmt / 0 rt", scope;dur=17;desc="1 stmt / 1 rt", ' +
        'generation;dur=14;desc="1 stmt / 1 rt", board;dur=274;desc="18 stmt / 11 rt", ' +
        'total;dur=305;desc="20 stmt / 13 rt"',
    )
  })

  it('keeps an explicit description over the computed counts', () => {
    const timing = new RequestTiming({ clock: clockFrom(0, 5, 5), exposePhases: true })
    timing.counter.recordRoundTrip()
    timing.mark('board', 'cache miss')
    expect(timing.header()).toBe('board;dur=5;desc="cache miss", total;dur=5;desc="1 stmt / 1 rt"')
  })

  it('leaves the header unchanged when nothing was counted', () => {
    const timing = new RequestTiming({ clock: clockFrom(0, 5, 5), exposePhases: true })
    timing.mark('auth')
    expect(timing.header()).toBe('auth;dur=5, total;dur=5')
  })

  it('keeps counts out of a header that does not expose phases', () => {
    const timing = new RequestTiming({ clock: clockFrom(0, 5, 5) })
    timing.counter.recordRoundTrip(3)
    timing.mark('board')
    expect(timing.header()).toBe('total;dur=5')
  })

  it('shares a counter the caller supplies', () => {
    const counter = new QueryCounter()
    const timing = new RequestTiming({ counter })
    counter.recordRoundTrip(2)
    expect(timing.counter).toBe(counter)
    expect(timing.counter.counts()).toEqual({ roundTrips: 1, statements: 2 })
  })
})

interface NitroHooks {
  request(event: H3Event): void
  beforeResponse(event: H3Event): void
  afterResponse(event: H3Event): void
  error(error: Error, context: { event?: H3Event; tags?: string[] }): void
}

function event(): H3Event {
  const request = new IncomingMessage(new Socket())
  request.url = '/items/1'
  request.method = 'GET'
  const created = createEvent(request, new ServerResponse(request))
  created.context.matchedRoute = { handlers: {}, path: '/items/:id' }
  return created
}

describe('h3: useRequestCounter', () => {
  it('is the request timer counter, and its totals reach the completion record', async () => {
    const sink = createMemorySink()
    const hooks = createHooks<NitroHooks>()
    installNitroLogging({ hooks }, () => ({
      environment: 'production',
      service: 'fixture',
      sinks: [sink],
      timingExposePhases: true,
    }))
    const request = event()
    await hooks.callHook('request', request)

    // A database wrapper reaches the counter without ever touching the timer.
    const counter = useRequestCounter(request)
    counter.recordRoundTrip(4)
    expect(useRequestTiming(request).counter).toBe(counter)
    expect(useRequestCounter(request)).toBe(counter)

    await hooks.callHook('beforeResponse', request)
    await hooks.callHook('afterResponse', request)

    expect(getResponseHeader(request, 'server-timing')).toMatch(
      /^total;dur=\d+;desc="4 stmt \/ 1 rt"$/,
    )
    expect(sink.records[0]?.data).toMatchObject({ roundTrips: 1, statements: 4 })
  })

  it('adds no count fields to a request that counted nothing', async () => {
    const sink = createMemorySink()
    const hooks = createHooks<NitroHooks>()
    installNitroLogging({ hooks }, () => ({
      environment: 'production',
      service: 'fixture',
      sinks: [sink],
    }))
    const request = event()
    await hooks.callHook('request', request)
    await hooks.callHook('beforeResponse', request)
    await hooks.callHook('afterResponse', request)
    expect(sink.records[0]?.data).not.toHaveProperty('statements')
  })
})

describe('worker: logRequest', () => {
  it('reports the counts a handler recorded on the timing argument', async () => {
    const sink = createMemorySink()
    const logger = createLogger({ environment: 'test', service: 'fixture', sinks: [sink] })
    await logRequest(
      new Request('https://example.invalid/items/7'),
      logger,
      (_log, timing) => {
        timing.counter.recordRoundTrip(8)
        return new Response('ok')
      },
      { route: '/items/:id' },
    )
    expect(sink.records[0]?.data).toMatchObject({ roundTrips: 1, statements: 8 })
  })
})
