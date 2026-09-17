import { createError, defineEventHandler, getRouterParam, readBody } from 'h3'
import { describe, expect, it } from 'vitest'

import { callHandler } from '../../../src/server/handlers/call-handler'
import { createFakeD1Database } from '../../../src/server/handlers/fake-d1'
import { createFakeKVNamespace } from '../../../src/server/handlers/fake-kv'

import type { H3Event } from 'h3'

/**
 * A small stand-in for the kind of route this harness targets -- a
 * Buoys-shaped GET-by-id handler over D1 with a KV cache in front of it, the
 * pattern the issue asks this harness to prove against a realistic handler.
 */
function buoyStatusHandler(env: { DB: D1Database; STATUS_CACHE: KVNamespace }) {
  return defineEventHandler(async (event: H3Event) => {
    const id = getRouterParam(event, 'id')
    if (!id) {
      throw createError({ statusCode: 400, statusMessage: 'Missing buoy id' })
    }

    const cacheKey = `buoy-status:${id}`
    const cached = await env.STATUS_CACHE.get(cacheKey)
    if (cached) return JSON.parse(cached)

    const row = await env.DB.prepare('SELECT id, status FROM buoys WHERE id = ?').bind(id).first()
    if (!row) {
      throw createError({ statusCode: 404, statusMessage: 'Buoy not found' })
    }

    await env.STATUS_CACHE.put(cacheKey, JSON.stringify(row), { expirationTtl: 60 })
    return row
  })
}

/** A handler that reads a JSON body and echoes a derived field. */
const echoNameHandler = defineEventHandler(async (event: H3Event) => {
  const body = await readBody<{ name?: string }>(event)
  if (!body?.name) {
    throw createError({ statusCode: 422, statusMessage: 'name is required' })
  }
  return { greeting: `Hello, ${body.name}!` }
})

async function seededDb() {
  const db = createFakeD1Database()
  await db.exec('CREATE TABLE buoys (id INTEGER PRIMARY KEY, status TEXT NOT NULL)')
  await db.prepare('INSERT INTO buoys (id, status) VALUES (?, ?)').bind(1, 'active').run()
  return db
}

describe('callHandler', () => {
  it('calls a route handler with fake D1 + KV and returns its plain return value', async () => {
    const db = await seededDb()
    const kv = createFakeKVNamespace()

    const response = await callHandler(
      buoyStatusHandler({ DB: db, STATUS_CACHE: kv }),
      { params: { id: '1' } },
      { env: { DB: db, STATUS_CACHE: kv } },
    )

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ id: 1, status: 'active' })
  })

  it('populates the KV cache so a second call is served from cache', async () => {
    const db = await seededDb()
    const kv = createFakeKVNamespace()
    const handler = buoyStatusHandler({ DB: db, STATUS_CACHE: kv })
    const eventOptions = { params: { id: '1' } }
    const callOptions = { env: { DB: db, STATUS_CACHE: kv } }

    await callHandler(handler, eventOptions, callOptions)
    // Delete the row -- if the second call still succeeds, it was the cache that answered.
    await db.prepare('DELETE FROM buoys WHERE id = ?').bind(1).run()

    const response = await callHandler(handler, eventOptions, callOptions)
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ id: 1, status: 'active' })
  })

  it('converts a thrown H3Error into the response Nitro would send (404)', async () => {
    const db = await seededDb()
    const kv = createFakeKVNamespace()

    const response = await callHandler(
      buoyStatusHandler({ DB: db, STATUS_CACHE: kv }),
      { params: { id: '999' } },
      { env: { DB: db, STATUS_CACHE: kv } },
    )

    expect(response.status).toBe(404)
    expect(response.body).toMatchObject({ statusCode: 404, statusMessage: 'Buoy not found' })
  })

  it('converts a thrown H3Error into a 400 without touching env at all', async () => {
    const db = await seededDb()
    const kv = createFakeKVNamespace()

    const response = await callHandler(
      buoyStatusHandler({ DB: db, STATUS_CACHE: kv }),
      {},
      {
        env: { DB: db, STATUS_CACHE: kv },
      },
    )

    expect(response.status).toBe(400)
  })

  it('reads a JSON request body through the fake event', async () => {
    const response = await callHandler(echoNameHandler, {
      body: { name: 'Logan' },
      method: 'POST',
    })

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ greeting: 'Hello, Logan!' })
  })

  it('reports a validation failure as its own status', async () => {
    const response = await callHandler(echoNameHandler, { body: {}, method: 'POST' })
    expect(response.status).toBe(422)
  })
})
