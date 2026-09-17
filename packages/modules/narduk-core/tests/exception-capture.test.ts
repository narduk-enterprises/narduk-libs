import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'

import { installNitroLogging } from '@narduk-enterprises/narduk-logging/h3'
import { createMemorySink } from '@narduk-enterprises/narduk-logging/testing'
import { createEvent } from 'h3'
import { createHooks } from 'hookable'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { resolveLoggingOptions } from '../runtime/server/utils/logger'
import {
  createExceptionDeduper,
  installClientExceptionCapture,
  installServerExceptionCapture,
} from '../runtime/shared/exception-capture'
import {
  buildExceptionReport,
  NARDUK_EXCEPTION_HOOK,
  normalizeExceptionRoute,
  onNardukException,
  readExceptionStatusCode,
  redactExceptionText,
  toException,
  UNMATCHED_EXCEPTION_ROUTE,
} from '../runtime/shared/exception-report'

import type { ExceptionHookHost, NardukExceptionReport } from '../runtime/shared/exception-report'
import type { H3Event } from 'h3'

const config = vi.hoisted(() => ({ current: {} as Record<string, unknown> }))
vi.mock('nitropack/runtime', () => ({
  useRuntimeConfig: () => config.current,
  defineNitroPlugin: (plugin: unknown) => plugin,
}))

const ROUTE_PATTERN = '/stations/:id'
const RAW_ROUTE_PATTERN = '/stations/:id(\\d+)'

function host(): { hooks: ExceptionHookHost; reports: NardukExceptionReport[] } {
  const hooks = createHooks() as unknown as ExceptionHookHost
  const reports: NardukExceptionReport[] = []
  onNardukException(hooks, (report) => reports.push(report))
  return { hooks, reports }
}

function event(path = '/stations/42?token=synthetic'): H3Event {
  const request = new IncomingMessage(new Socket())
  request.method = 'GET'
  request.url = path
  const created = createEvent(request, new ServerResponse(request))
  created.context.matchedRoute = { path: RAW_ROUTE_PATTERN, handlers: {} }
  created.context._requestId = 'req-1234'
  return created
}

describe('exception report shape', () => {
  it('redacts query strings and email addresses out of the message', () => {
    expect(redactExceptionText('GET https://app.test/search?q=secret&token=abc failed')).toBe(
      'GET https://app.test/search?[redacted] failed',
    )
    expect(redactExceptionText('no mailbox for logan@narduk.test here')).toBe(
      'no mailbox for [redacted] here',
    )
  })

  it('collapses a multi-line message and caps its length', () => {
    expect(redactExceptionText('first\n  second\n\tthird')).toBe('first second third')
    expect(redactExceptionText('x'.repeat(900))).toHaveLength(500)
  })

  it('normalizes a route pattern so one page is one value', () => {
    expect(normalizeExceptionRoute('/stations/:id(\\d+)?')).toBe(ROUTE_PATTERN)
    expect(normalizeExceptionRoute('')).toBe('/')
  })

  it('reads the status an h3 error carries and defaults to 500', () => {
    expect(readExceptionStatusCode({ statusCode: 404 })).toBe(404)
    expect(readExceptionStatusCode(new Error('boom'))).toBe(500)
    expect(readExceptionStatusCode('boom')).toBe(500)
  })

  it('normalizes a non-Error throw so a reporter always gets a stack', () => {
    expect(toException('boom').message).toBe('boom')
    expect(toException({ message: 'shaped' })).toBeInstanceOf(Error)
    expect(toException(undefined).message).toBe('Non-Error value thrown')
  })

  it('carries the route pattern, build version, request id and status code', () => {
    const report = buildExceptionReport(Object.assign(new Error('nope'), { statusCode: 404 }), {
      buildVersion: 'abc123def456',
      requestId: 'req-1234',
      route: RAW_ROUTE_PATTERN,
      source: 'server',
    })

    expect(report).toMatchObject({
      buildVersion: 'abc123def456',
      fatal: false,
      message: 'nope',
      name: 'Error',
      requestId: 'req-1234',
      route: ROUTE_PATTERN,
      source: 'server',
      statusCode: 404,
    })
  })

  it('falls back to an unmatched route rather than inventing a path', () => {
    expect(buildExceptionReport(new Error('x'), { source: 'client' }).route).toBe(
      UNMATCHED_EXCEPTION_ROUTE,
    )
  })
})

describe('deduper', () => {
  it('reports an object error once and bounds primitive bookkeeping', () => {
    const isNew = createExceptionDeduper()
    const error = new Error('once')

    expect(isNew(error)).toBe(true)
    expect(isNew(error)).toBe(false)
    expect(isNew('boom')).toBe(true)
    expect(isNew('boom')).toBe(false)

    for (let i = 0; i < 60; i++) isNew(`filler-${i}`)
    // The oldest primitive has aged out of the bounded ring, so it reports again
    // instead of the ring growing without limit on a page throwing strings.
    expect(isNew('boom')).toBe(true)
  })
})

describe('client capture', () => {
  it('reports one error once even though vue:error and app:error both fire', async () => {
    const { hooks, reports } = host()
    installClientExceptionCapture(hooks, {
      resolveBuildVersion: () => 'abc123def456',
      resolveRequestId: () => 'req-1234',
      resolveRoute: () => ROUTE_PATTERN,
    })
    const error = new Error('render failed')

    await hooks.callHook('vue:error', error)
    await hooks.callHook('app:error', error)

    expect(reports).toHaveLength(1)
    expect(reports[0]).toMatchObject({
      buildVersion: 'abc123def456',
      fatal: false,
      requestId: 'req-1234',
      route: ROUTE_PATTERN,
      source: 'client',
    })
  })

  it('marks an app-level error fatal and reports distinct errors separately', async () => {
    const { hooks, reports } = host()
    installClientExceptionCapture(hooks)

    await hooks.callHook('app:error', new Error('fatal one'))
    await hooks.callHook('vue:error', new Error('component two'))

    expect(reports.map((report) => [report.message, report.fatal])).toEqual([
      ['fatal one', true],
      ['component two', false],
    ])
  })

  it('installs once, so a double registration cannot double every report', async () => {
    const { hooks, reports } = host()
    installClientExceptionCapture(hooks)
    installClientExceptionCapture(hooks)

    await hooks.callHook('vue:error', new Error('boom'))

    expect(reports).toHaveLength(1)
  })

  it('reports nothing when no reporter is subscribed, and survives one that throws', async () => {
    const hooks = createHooks() as unknown as ExceptionHookHost
    installClientExceptionCapture(hooks)
    await expect(hooks.callHook('vue:error', new Error('silent'))).resolves.not.toThrow()

    const seen: string[] = []
    onNardukException(hooks, () => {
      throw new Error('broken reporter')
    })
    onNardukException(hooks, (report) => seen.push(report.message))

    await expect(hooks.callHook('vue:error', new Error('second'))).resolves.not.toThrow()
    expect(seen).toEqual([])
  })
})

describe('server capture', () => {
  beforeEach(() => {
    config.current = {}
  })

  it('reports once per request with the route pattern, request id and status', async () => {
    const nitro = { hooks: createHooks() }
    const reports: NardukExceptionReport[] = []
    onNardukException(nitro.hooks as unknown as ExceptionHookHost, (report) => reports.push(report))
    installServerExceptionCapture(nitro as never, {
      resolveBuildVersion: () => 'abc123def456',
    })

    const failing = event()
    const error = Object.assign(new Error('Cannot find any route matching /nope?q=secret'), {
      statusCode: 404,
    })
    await nitro.hooks.callHook('error', error, { event: failing, tags: ['request'] })
    // Nitro can announce the same handled error a second time, untagged.
    await nitro.hooks.callHook('error', error, { event: failing })

    expect(reports).toHaveLength(1)
    expect(reports[0]).toMatchObject({
      buildVersion: 'abc123def456',
      fatal: false,
      message: 'Cannot find any route matching /nope?[redacted]',
      requestId: 'req-1234',
      route: ROUTE_PATTERN,
      source: 'server',
      statusCode: 404,
    })
  })

  it('marks a 5xx fatal and dedupes an eventless error by identity', async () => {
    const nitro = { hooks: createHooks() }
    const reports: NardukExceptionReport[] = []
    onNardukException(nitro.hooks as unknown as ExceptionHookHost, (report) => reports.push(report))
    installServerExceptionCapture(nitro as never)

    const error = new Error('boom')
    await nitro.hooks.callHook('error', error, {})
    await nitro.hooks.callHook('error', error, {})

    expect(reports).toHaveLength(1)
    expect(reports[0]).toMatchObject({
      fatal: true,
      route: UNMATCHED_EXCEPTION_ROUTE,
      statusCode: 500,
      source: 'server',
    })
  })

  it('writes no log record of its own, leaving the request summary the only one', async () => {
    const sink = createMemorySink()
    config.current = { nardukLogging: { sinks: [sink], service: 'capture-test', level: 'debug' } }

    const nitro = { hooks: createHooks() }
    const reports: NardukExceptionReport[] = []
    onNardukException(nitro.hooks as unknown as ExceptionHookHost, (report) => reports.push(report))
    installNitroLogging(nitro as never, resolveLoggingOptions)
    installServerExceptionCapture(nitro as never)

    const failing = event()
    await nitro.hooks.callHook('request', failing)
    await nitro.hooks.callHook('error', new Error('boom'), { event: failing, tags: ['request'] })

    // narduk-libs#359 made narduk-logging's own error hook complete the request
    // summary. Exactly one record, and exactly one exception report.
    expect(sink.records.map((record) => record.message)).toEqual(['Request completed'])
    expect(reports).toHaveLength(1)
  })
})

describe('the seam is one named hook', () => {
  it('publishes on narduk:exception', async () => {
    const hooks = createHooks()
    const seen: unknown[] = []
    hooks.hook(NARDUK_EXCEPTION_HOOK, (report: unknown) => seen.push(report))
    installClientExceptionCapture(hooks as unknown as ExceptionHookHost)

    await hooks.callHook('vue:error', new Error('boom'))

    expect(seen).toHaveLength(1)
  })
})
