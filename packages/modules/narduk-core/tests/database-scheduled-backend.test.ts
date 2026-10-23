import { createEvent } from 'h3'
import { describe, expect, it, vi } from 'vitest'

import { useDatabase } from '../runtime/server/utils/database'

import type { H3Event } from 'h3'
import type { IncomingMessage, ServerResponse } from 'node:http'

vi.mock('nitropack/runtime', () => ({
  useRuntimeConfig: () => {
    throw new Error('no runtime config in a scheduled handler')
  },
}))
vi.mock('#narduk-core/postgres-runtime', () => ({
  createPostgresDatabase: () => {
    throw new Error('Postgres must not be reached')
  },
}))
vi.mock('#narduk-core/schema', () => ({ apiKeys: {}, sessions: {}, users: {} }))

function scheduledEvent(env: Record<string, unknown>): H3Event {
  const request = { headers: {}, method: 'GET', url: '/' } as unknown as IncomingMessage
  const response = { setHeader: vi.fn() } as unknown as ServerResponse
  const event = createEvent(request, response)
  event.context.cloudflare = { scheduled: {}, env }
  return event
}

describe('useDatabase on a scheduled event without runtime config', () => {
  it('rethrows instead of guessing D1', () => {
    expect(() => useDatabase(scheduledEvent({ DB: {} }))).toThrow(
      'no runtime config in a scheduled handler',
    )
  })

  it('reads the backend from the worker env when it is declared there', () => {
    expect(() => useDatabase(scheduledEvent({ NUXT_DATABASE_BACKEND: 'none' }))).toThrow(
      expect.objectContaining({ statusCode: 500, message: expect.stringContaining("'none'") }),
    )
  })
})
