import { createEvent } from 'h3'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { authenticateApiKey } from '../runtime/server/utils/auth'
import { createAppDatabase, useDatabase } from '../runtime/server/utils/database'

import type { H3Event } from 'h3'
import type { IncomingMessage, ServerResponse } from 'node:http'

const { state } = vi.hoisted(() => ({
  state: { config: {} as Record<string, unknown> },
}))

vi.mock('nitropack/runtime', () => ({ useRuntimeConfig: () => state.config }))
vi.mock('#narduk-core/postgres-runtime', () => ({
  createPostgresDatabase: () => {
    throw new Error('Postgres must not be reached')
  },
}))
vi.mock('#narduk-core/schema', () => ({ apiKeys: {}, sessions: {}, users: {} }))

function requestEvent(headers: Record<string, string> = {}): H3Event {
  const request = { headers, method: 'GET', url: '/' } as unknown as IncomingMessage
  const response = { setHeader: vi.fn() } as unknown as ServerResponse
  return createEvent(request, response)
}

const NO_DATABASE_MESSAGE =
  "This app declares databaseBackend 'none', so it has no database. Declare 'd1' or 'postgres' to use one."

describe("databaseBackend 'none' at runtime", () => {
  beforeEach(() => {
    state.config = { databaseBackend: 'none', databaseBackendSource: 'option' }
  })

  it('makes useDatabase throw a 500 that names the declaration', () => {
    expect(() => useDatabase(requestEvent())).toThrow(
      expect.objectContaining({ statusCode: 500, message: NO_DATABASE_MESSAGE }),
    )
  })

  it('makes app database accessors throw the same error', () => {
    const useAppDatabase = createAppDatabase({})
    expect(() => useAppDatabase(requestEvent())).toThrow(
      expect.objectContaining({ statusCode: 500, message: NO_DATABASE_MESSAGE }),
    )
  })

  it('treats an API key as unauthenticated instead of querying a database', async () => {
    await expect(
      authenticateApiKey(requestEvent({ authorization: 'Bearer nk_live_example' })),
    ).resolves.toBeNull()
  })

  it('still reports a missing D1 binding for a D1 app', () => {
    state.config = { databaseBackend: 'd1', databaseBackendSource: 'option' }
    expect(() => useDatabase(requestEvent())).toThrow(
      expect.objectContaining({
        statusCode: 500,
        message: 'D1 database binding not available. Ensure DB is configured in wrangler.json.',
      }),
    )
  })
})
