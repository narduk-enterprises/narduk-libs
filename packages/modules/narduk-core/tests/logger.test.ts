import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'

import { installNitroLogging } from '@narduk-enterprises/narduk-logging/h3'
import { createMemorySink } from '@narduk-enterprises/narduk-logging/testing'
import { createEvent, setResponseStatus } from 'h3'
import { createHooks } from 'hookable'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import requestMiddleware from '../runtime/server/middleware/requestLogger'
import errorPlugin from '../runtime/server/plugins/error-logger'
import {
  ensureRequestId,
  resolveLoggingOptions,
  resolveLogLevel,
  useLogger,
} from '../runtime/server/utils/logger'
import { sanitizeErrorForLog, sanitizeUrlForLog } from '../runtime/server/utils/logSanitizer'

import type { Logger, LogLevel } from '../runtime/server/utils/logger'
import type { H3Event } from 'h3'

const config = vi.hoisted(() => ({ current: {} as Record<string, unknown> }))
vi.mock('nitropack/runtime', () => ({
  useRuntimeConfig: () => config.current,
  defineNitroPlugin: (plugin: unknown) => plugin,
}))

function event(level?: string): H3Event {
  const request = new IncomingMessage(new Socket())
  request.method = 'GET'
  request.url = '/private/123?token=synthetic'
  const event = createEvent(request, new ServerResponse(request))
  event.context.matchedRoute = { path: '/private/:id', handlers: {} }
  if (level) event.context.cloudflare = { env: { LOG_LEVEL: level } }
  return event
}

describe('legacy logging compatibility', () => {
  beforeEach(() => {
    config.current = {}
    vi.unstubAllEnvs()
  })

  it('preserves import types, memoization, message/data signatures, and nested child prefixes', () => {
    const sink = createMemorySink()
    config.current = { logLevel: 'debug', nardukLogging: { sinks: [sink], service: 'legacy' } }
    const request = event()
    const level: LogLevel = resolveLogLevel(request)
    const log: Logger = useLogger(request)
    expect(level).toBe('debug')
    expect(log).toBe(useLogger(request))
    log.child('first').child('second').info('Ready', { count: 2, password: 'synthetic' })
    expect(sink.records[0]).toMatchObject({
      message: '[first][second] Ready',
      scope: 'first.second',
      requestId: ensureRequestId(request),
      path: '/private/:id',
      data: { count: 2, password: '[REDACTED]' },
    })
  })

  it('preserves the production warn default and runtime binding precedence', () => {
    const sink = createMemorySink()
    config.current = { nardukLogging: { sinks: [sink] } }
    expect(resolveLogLevel(event())).toBe('warn')
    useLogger(event()).info('Hidden')
    useLogger(event()).warn('Visible')
    expect(sink.records).toHaveLength(1)
    config.current.logLevel = 'error'
    expect(resolveLogLevel(event('debug'))).toBe('debug')
    expect(resolveLogLevel(event('invalid'))).toBe('warn')
    vi.stubEnv('LOG_LEVEL', 'silent')
    expect(resolveLogLevel(event())).toBe('silent')
    expect(resolveLogLevel(event('info'))).toBe('info')
  })

  it('allows new apps to select info explicitly without changing old defaults', () => {
    const sink = createMemorySink()
    config.current = {
      logLevel: 'warn',
      nardukLogging: { service: 'new-app', level: 'info', sinks: [sink] },
    }
    useLogger(event()).info('Ready')
    expect(sink.records[0]?.service).toBe('new-app')
    useLogger(event('silent')).error('Hidden')
    expect(sink.records).toHaveLength(1)
  })

  it('uses one shared lifecycle registration when core and the standalone module coexist', async () => {
    const sink = createMemorySink()
    config.current = { logLevel: 'info', nardukLogging: { sinks: [sink] } }
    const hooks = createHooks<{
      afterResponse(event: H3Event): void
      error(error: Error, context: { event?: H3Event; tags?: string[] }): void
      request(event: H3Event): void
    }>()
    // These are real Hookable hooks; the plugin only needs the structural Nitro surface.
    const nitro = { hooks }
    const install = errorPlugin as (host: typeof nitro) => void
    install(nitro)
    installNitroLogging(nitro, resolveLoggingOptions)
    const request = event()
    await requestMiddleware(request)
    await hooks.callHook('request', request)
    setResponseStatus(request, 500)
    await hooks.callHook('error', new Error('Synthetic failure'), {
      event: request,
      tags: ['request'],
    })
    await hooks.callHook('afterResponse', request)
    expect(sink.records).toHaveLength(1)
    expect(sink.records[0]?.level).toBe('error')
    expect(request.node.res.listenerCount('finish')).toBe(0)
  })

  it('routes the old error plugin through silent mode and safe error normalization', async () => {
    const sink = createMemorySink()
    config.current = { logLevel: 'silent', nardukLogging: { sinks: [sink] } }
    const hooks = createHooks<{
      afterResponse(event: H3Event): void
      error(error: Error, context: { event?: H3Event }): void
      request(event: H3Event): void
    }>()
    const install = errorPlugin as (host: { hooks: typeof hooks }) => void
    install({ hooks })
    await hooks.callHook('error', new Error('Synthetic'), {})
    expect(sink.records).toHaveLength(0)
    expect(sanitizeUrlForLog('/private?token=synthetic')).toBe('/private')
    expect(sanitizeUrlForLog('https://user:synthetic@example.invalid/path?token=synthetic')).toBe(
      'https://example.invalid/path',
    )
    expect(sanitizeErrorForLog(new Error('Synthetic'))).not.toHaveProperty('stack')
  })
})
