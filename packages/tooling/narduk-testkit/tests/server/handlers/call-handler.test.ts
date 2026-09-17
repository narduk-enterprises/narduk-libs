import {
  createError,
  defineEventHandler,
  getQuery,
  getRequestHeader,
  getRouterParam,
  getRouterParams,
  readBody,
  readRawBody,
  setResponseHeader,
} from 'h3'
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

  /**
   * `defineValidatedHandler` (narduk-core, narduk-libs#394) reads a request
   * through exactly these h3 calls, in this order: `event.method`,
   * `getRouterParams`, `getQuery`, `getRequestHeader('content-length')`,
   * `readRawBody`, then `createError` for a rejected field. Driving the same
   * sequence here proves the fake event supports the wrapper's whole request
   * path without narduk-testkit taking a dependency on narduk-core (which
   * would pull in narduk-logging and zod, and add a build-order edge, for one
   * test). The end-to-end test against the real wrapper belongs in
   * narduk-core's own suite, where that dependency direction already exists.
   */
  const validatedShapeHandler = defineEventHandler(async (event: H3Event) => {
    const params = getRouterParams(event)
    const query = getQuery(event)
    const declaredLength = Number(getRequestHeader(event, 'content-length'))

    if (!params.stationId) {
      throw createError({
        data: {
          code: 'VALIDATION_FAILED',
          issues: [{ message: 'Required', path: 'params.stationId' }],
        },
        statusCode: 400,
        statusMessage: 'Validation failed',
      })
    }

    const raw = BODY_METHODS.has(event.method ?? 'GET') ? await readRawBody(event) : undefined

    return {
      body: raw === undefined ? undefined : JSON.parse(String(raw)),
      declaredLength,
      limit: Number(query.limit),
      stationId: params.stationId,
    }
  })

  const BODY_METHODS = new Set(['DELETE', 'PATCH', 'POST', 'PUT'])

  it('supports the whole defineValidatedHandler request path in one call', async () => {
    const response = await callHandler(validatedShapeHandler, {
      body: { reading: 4.2 },
      method: 'POST',
      params: { stationId: 'BUOY-12' },
      query: { limit: 500 },
    })

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      body: { reading: 4.2 },
      // createFakeEvent sets content-length itself, which is the header the
      // wrapper bounds the body read on -- an absent one would make its
      // maxBodyBytes guard untestable.
      declaredLength: JSON.stringify({ reading: 4.2 }).length,
      limit: 500,
      stationId: 'BUOY-12',
    })
  })

  it('maps a validation-shaped createError to its status, message and data', async () => {
    const response = await callHandler(validatedShapeHandler, { method: 'POST' })

    expect(response.status).toBe(400)
    expect(response.body).toMatchObject({
      data: { code: 'VALIDATION_FAILED', issues: [{ path: 'params.stationId' }] },
      statusCode: 400,
      statusMessage: 'Validation failed',
    })
  })

  /**
   * narduk-logging's `Server-Timing` emitter (narduk-libs#395) sets its header
   * from Nitro's `beforeResponse` hook, which is Nitro's, not h3's — this
   * harness calls a handler directly and never runs it. A handler that sets
   * the header itself is read back correctly, which is what this asserts; a
   * route relying on the hook needs an integration test, not this harness.
   */
  it('reads back a response header a handler set itself', async () => {
    const timedHandler = defineEventHandler((event: H3Event) => {
      setResponseHeader(event, 'Server-Timing', 'total;dur=12')
      return { ok: true }
    })

    const response = await callHandler(timedHandler, {})
    expect(response.headers['server-timing']).toBe('total;dur=12')
  })
})
