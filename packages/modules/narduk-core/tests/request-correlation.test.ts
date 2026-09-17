import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'

import { ensureRequestId } from '@narduk-enterprises/narduk-logging/h3'
import { createEvent } from 'h3'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import requestMiddleware from '../runtime/server/middleware/requestLogger'
import { resolveLoggingOptions } from '../runtime/server/utils/logger'

import type { H3Event } from 'h3'

const config = vi.hoisted(() => ({ current: {} as Record<string, unknown> }))
vi.mock('nitropack/runtime', () => ({
  useRuntimeConfig: () => config.current,
  defineNitroPlugin: (plugin: unknown) => plugin,
}))

function event(headers: Record<string, string> = {}): H3Event {
  const request = new IncomingMessage(new Socket())
  request.method = 'GET'
  request.url = '/nope'
  Object.assign(request.headers, headers)
  return createEvent(request, new ServerResponse(request))
}

async function run(target: H3Event): Promise<void> {
  await requestMiddleware(target)
}

describe('request id correlation', () => {
  it('echoes the id onto the incoming headers so a re-entrant render adopts it', async () => {
    const first = event()
    await run(first)

    const id = first.context._requestId
    expect(id).toBeTruthy()
    expect(first.node.req.headers['x-request-id']).toBe(id)

    // Nuxt can render a failed page by re-entering the same Nitro app with the
    // original request's headers. That second event must not mint a new id, or
    // the id printed on the error page would not match the log record.
    const rerender = event({ 'x-request-id': String(id) })
    await run(rerender)
    expect(rerender.context._requestId).toBe(id)
    expect(ensureRequestId(rerender)).toBe(id)
  })

  it('keeps an id a caller supplied rather than overwriting it', async () => {
    const supplied = event({ 'x-request-id': 'caller-supplied-id' })
    await run(supplied)

    expect(supplied.context._requestId).toBe('caller-supplied-id')
    expect(supplied.node.req.headers['x-request-id']).toBe('caller-supplied-id')
  })
})

describe('server log context', () => {
  beforeEach(() => {
    config.current = {}
  })

  it('stamps the deployed build version on every record', () => {
    config.current = { public: { buildVersion: 'abc123def456' } }

    expect(resolveLoggingOptions()).toMatchObject({
      context: { buildVersion: 'abc123def456' },
    })
  })

  it('omits the build version rather than recording an empty one', () => {
    config.current = { public: { buildVersion: '' } }

    expect(resolveLoggingOptions().context).toEqual({})
  })

  it('preserves an app-configured logging context', () => {
    config.current = {
      nardukLogging: { context: { tenant: 'buoys' } },
      public: { buildVersion: 'abc123def456' },
    }

    expect(resolveLoggingOptions().context).toEqual({
      tenant: 'buoys',
      buildVersion: 'abc123def456',
    })
  })
})
