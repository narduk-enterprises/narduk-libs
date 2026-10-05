import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'

import { createEvent } from 'h3'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import type { H3Event } from 'h3'

/*
 * Local email/password throttle records, written through narduk-core's real
 * request logger (narduk-logging's sanitizer included) into a capturing sink.
 * The attempts table is a stub: these tests are about what gets recorded.
 */

const state = vi.hoisted(() => ({
  row: undefined as Record<string, unknown> | undefined,
  records: [] as Array<Record<string, unknown>>,
}))

vi.mock('nitropack/runtime', () => ({
  useRuntimeConfig: () => ({
    nardukLogging: {
      level: 'debug',
      service: 'auth-test',
      sinks: [{ write: (record: Record<string, unknown>) => state.records.push(record) }],
    },
  }),
}))
vi.mock('#layer/server/utils/logger', () => import('../../narduk-core/runtime/server/utils/logger'))
vi.mock('#layer/server/utils/database', () => ({
  executeDatabaseQuery: async () => {},
  getDatabaseRow: async () => state.row,
}))
vi.mock('#narduk-auth-server/utils/auth-bridge-database', () => {
  // Any drizzle builder chain; the rows come from `state.row` above.
  const chain: unknown = new Proxy(() => chain, { get: () => chain, apply: () => chain })
  return { useAuthBridgeDatabase: () => chain }
})

const EMAIL = 'jane.doe@example.com'
const CLIENT_IP = '203.0.113.77'

function requestEvent(): H3Event {
  const request = new IncomingMessage(new Socket())
  request.method = 'POST'
  request.url = '/api/auth/login'
  request.headers = { 'cf-connecting-ip': CLIENT_IP }
  const event = createEvent(request, new ServerResponse(request))
  event.context.matchedRoute = { path: '/api/auth/login', handlers: {} } as never
  return event
}

async function throttle() {
  return import('../server/lib/app-auth/local-email-throttle')
}

function messages() {
  return state.records.map((record) => [record.level, record.message, record.data])
}

beforeAll(async () => {
  // narduk-core resolves Nitro's runtime config through a dynamic import.
  await import('../../narduk-core/runtime/server/utils/logger')
  await new Promise((resolve) => setTimeout(resolve, 0))
})

afterEach(() => {
  state.records.length = 0
  state.row = undefined
})

describe('local auth throttle records', () => {
  it('records each failed attempt, then the lockout once the threshold is reached', async () => {
    const { recordLocalEmailAttemptFailure } = await throttle()
    const event = requestEvent()

    state.row = { failures: 1, windowStartedAt: 0, lockedUntil: null }
    await recordLocalEmailAttemptFailure(event, 'login', EMAIL)
    state.row = { failures: 5, windowStartedAt: 0, lockedUntil: null }
    await recordLocalEmailAttemptFailure(event, 'login', EMAIL)

    expect(messages()).toEqual([
      ['info', '[AppAuth] Local auth attempt failed', { kind: 'login', failures: 1 }],
      ['info', '[AppAuth] Local auth attempt failed', { kind: 'login', failures: 5 }],
      [
        'warn',
        '[AppAuth] Local auth lockout started',
        { kind: 'login', failures: 5, lockSeconds: 30 },
      ],
    ])
  })

  it('records a refusal while locked out with the Retry-After it sent', async () => {
    const { assertLocalEmailAttemptAllowed } = await throttle()
    const event = requestEvent()
    state.row = { failures: 6, windowStartedAt: 0, lockedUntil: Math.floor(Date.now() / 1000) + 60 }

    await expect(assertLocalEmailAttemptAllowed(event, 'request', EMAIL)).rejects.toMatchObject({
      statusCode: 429,
    })

    expect(state.records).toEqual([
      expect.objectContaining({
        level: 'warn',
        message: '[AppAuth] Local auth attempt refused while locked out',
        scope: 'AppAuth',
        requestId: expect.any(String),
        path: '/api/auth/login',
        data: { kind: 'request', retryAfterSeconds: expect.any(Number) },
      }),
    ])
    expect(event.node.res.getHeader('retry-after')).toBe(
      (state.records[0]?.data as { retryAfterSeconds: number }).retryAfterSeconds,
    )
  })

  it('never records the email address, the client IP or the attempt key', async () => {
    const { assertLocalEmailAttemptAllowed, recordLocalEmailAttemptFailure } = await throttle()
    const event = requestEvent()
    state.row = { failures: 9, windowStartedAt: 0, lockedUntil: Math.floor(Date.now() / 1000) + 60 }

    await recordLocalEmailAttemptFailure(event, 'login', EMAIL)
    await expect(assertLocalEmailAttemptAllowed(event, 'login', EMAIL)).rejects.toMatchObject({
      statusCode: 429,
    })

    expect(state.records).toHaveLength(3)
    const serialized = JSON.stringify(state.records)
    expect(serialized).not.toContain('jane.doe')
    expect(serialized).not.toContain(CLIENT_IP)
    expect(serialized).not.toMatch(/keyHash|[0-9a-f]{64}/u)
  })
})
