/**
 * `useDatabase` counts D1 round trips on narduk-logging's request counter
 * (narduk-libs#511), against the real D1 driver (Miniflare) rather than a
 * fake binding, so drizzle's own call shapes are what get counted.
 */
import { useRequestCounter } from '@narduk-enterprises/narduk-logging/h3'
import { eq } from 'drizzle-orm'
import { createEvent } from 'h3'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { createD1QueryHarness } from '../../../tooling/narduk-testkit/src/d1'
import { countD1RoundTrips } from '../runtime/server/database/d1RoundTrips'
import { kvCache } from '../runtime/server/database/schema'
import { createAppDatabase, useDatabase } from '../runtime/server/utils/database'

import type { D1QueryHarness } from '../../../tooling/narduk-testkit/src/d1'
import type { H3Event } from 'h3'
import type { IncomingMessage, ServerResponse } from 'node:http'

vi.mock('nitropack/runtime', () => ({ useRuntimeConfig: () => ({ databaseBackend: 'd1' }) }))
vi.mock('#narduk-core/postgres-runtime', () => ({
  createPostgresDatabase: () => {
    throw new Error('Postgres must not be reached')
  },
}))

const MIGRATIONS_DIR = new URL('../runtime/drizzle', import.meta.url).pathname
const EXPIRES = 4_102_444_800

let harness: D1QueryHarness

function requestEvent(binding: unknown): H3Event {
  const request = { headers: {}, method: 'GET', url: '/' } as unknown as IncomingMessage
  const response = { setHeader: vi.fn() } as unknown as ServerResponse
  const event = createEvent(request, response)
  event.context.cloudflare = { env: { DB: binding } }
  return event
}

describe('useDatabase D1 round-trip counting', () => {
  beforeAll(async () => {
    harness = await createD1QueryHarness({ migrations: MIGRATIONS_DIR })
  })

  afterAll(async () => {
    await harness.dispose()
  })

  beforeEach(async () => {
    await harness.clearData()
  })

  it('records one round trip per statement, for N statements', async () => {
    const event = requestEvent(harness.raw)
    const db = useDatabase(event)

    await db.insert(kvCache).values({ key: 'a', value: '1', expiresAt: EXPIRES }).run()
    await db.select().from(kvCache).all()
    await db.select().from(kvCache).where(eq(kvCache.key, 'a')).get()
    await db.delete(kvCache).where(eq(kvCache.key, 'missing')).run()

    expect(useRequestCounter(event).counts()).toEqual({ roundTrips: 4, statements: 4 })
  })

  it('records one round trip carrying every statement for a batch', async () => {
    const event = requestEvent(harness.raw)
    const db = useDatabase(event)

    const [, , rows] = await db.batch([
      db.insert(kvCache).values({ key: 'a', value: '1', expiresAt: EXPIRES }),
      db.insert(kvCache).values({ key: 'b', value: '2', expiresAt: EXPIRES }),
      db.select().from(kvCache),
    ])

    // The batch really ran on the real binding.
    expect(rows).toHaveLength(2)
    expect(useRequestCounter(event).counts()).toEqual({ roundTrips: 1, statements: 3 })
  })

  it('counts app database accessors the same way', async () => {
    const event = requestEvent(harness.raw)
    const useAppDatabase = createAppDatabase({ kvCache })
    const db = useAppDatabase(event)

    await db.select().from(kvCache).all()
    await db.batch([db.select().from(kvCache), db.select().from(kvCache)])

    expect(useRequestCounter(event).counts()).toEqual({ roundTrips: 2, statements: 3 })
  })

  it('keeps counts per request', async () => {
    const first = requestEvent(harness.raw)
    const second = requestEvent(harness.raw)

    await useDatabase(first).select().from(kvCache).all()
    await useDatabase(first).select().from(kvCache).all()
    await useDatabase(second).select().from(kvCache).all()

    expect(useRequestCounter(first).counts()).toEqual({ roundTrips: 2, statements: 2 })
    expect(useRequestCounter(second).counts()).toEqual({ roundTrips: 1, statements: 1 })
  })
})

describe('countD1RoundTrips', () => {
  beforeAll(async () => {
    harness = await createD1QueryHarness({ migrations: MIGRATIONS_DIR })
  })

  afterAll(async () => {
    await harness.dispose()
  })

  it('never fails the query when the recorder throws', async () => {
    const binding = countD1RoundTrips(harness.raw, () => {
      throw new Error('no request state')
    })

    const single = await binding.prepare('SELECT 1 AS one').first<{ one: number }>()
    const batched = await binding.batch([binding.prepare('SELECT 2 AS two')])

    expect(single).toEqual({ one: 1 })
    expect(batched[0]?.results).toEqual([{ two: 2 }])
  })

  it('counts bound statements and forwards everything else untouched', async () => {
    const calls: Array<number | undefined> = []
    const binding = countD1RoundTrips(harness.raw, (statements) => calls.push(statements))

    const statement = binding.prepare('SELECT ?1 AS value').bind(7)
    expect(await statement.raw()).toEqual([[7]])
    await binding.exec('SELECT 1')

    // `exec` is not a prepared-statement call and is not counted; `prepare`
    // and `bind` themselves are not round trips.
    expect(calls).toEqual([1])
  })

  it('hands batch the statements the binding created, not the counting wrappers', async () => {
    // Miniflare's binding tolerates a wrapped statement, but the #504 contract
    // requires the originals: a binding may check statement identity.
    const created: object[] = []
    let received: unknown[] = []
    const fake = {
      prepare: () => {
        const statement = { bind: () => statement, all: () => Promise.resolve({ results: [] }) }
        created.push(statement)
        return statement
      },
      batch: (statements: unknown[]) => {
        received = statements
        return Promise.resolve([])
      },
    }
    const binding = countD1RoundTrips(fake, () => {})

    const wrapped = [binding.prepare().bind(), binding.prepare()]
    await binding.batch(wrapped)

    expect(wrapped[0]).not.toBe(created[0])
    expect(received).toEqual(created)
    expect(received[0]).toBe(created[0])
    expect(received[1]).toBe(created[1])
  })
})
