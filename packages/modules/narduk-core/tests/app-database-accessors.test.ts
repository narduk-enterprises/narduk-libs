import { sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { createEvent } from 'h3'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createAppDatabase } from '../runtime/server/utils/database'

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

const authSchema = { authSessions: sqliteTable('auth_sessions', { id: text('id') }) }
const appSchema = { widgets: sqliteTable('widgets', { id: text('id') }) }

function d1Event(): H3Event {
  const request = { headers: {}, method: 'GET', url: '/' } as unknown as IncomingMessage
  const response = { setHeader: vi.fn() } as unknown as ServerResponse
  const event = createEvent(request, response)
  event.context.cloudflare = { env: { DB: { prepare: vi.fn(), batch: vi.fn(), exec: vi.fn() } } }
  return event
}

function schemaKeys(db: unknown): string[] {
  return Object.keys((db as { _: { fullSchema: Record<string, unknown> } })._.fullSchema)
}

describe('createAppDatabase accessors (#919)', () => {
  beforeEach(() => {
    state.config = { databaseBackend: 'd1', databaseBackendSource: 'option' }
  })

  it('gives each accessor its own schema on a request another accessor reached first', () => {
    const useAuthDatabase = createAppDatabase(authSchema)
    const useAppDatabase = createAppDatabase(appSchema)
    const event = d1Event()

    const auth = useAuthDatabase(event)
    const app = useAppDatabase(event)

    expect(app).not.toBe(auth)
    expect(schemaKeys(auth)).toEqual(['authSessions'])
    expect(schemaKeys(app)).toEqual(['widgets'])
  })

  it('still memoizes one instance per accessor per request', () => {
    const useAppDatabase = createAppDatabase(appSchema)
    const event = d1Event()

    expect(useAppDatabase(event)).toBe(useAppDatabase(event))
    expect(useAppDatabase(d1Event())).not.toBe(useAppDatabase(event))
  })
})
