import { createMemorySink } from '@narduk-enterprises/narduk-logging/testing'
import { createApp, defineEventHandler, toWebHandler } from 'h3'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import {
  LIST_QUERY_STATEMENT_CEILING,
  listResponse,
  parseListQuery,
} from '../runtime/server/utils/listQuery'

import type { EventHandlerRequest, H3Event } from 'h3'

// Controls what `useRuntimeConfig` (and therefore `useLogger`'s sinks) sees,
// the same double `tests/logger.test.ts` uses — real narduk-core server
// utils, run outside a Nitro app, so config must be injected rather than
// read from a running instance.
const runtimeConfig = vi.hoisted(() => ({ current: {} as Record<string, unknown> }))
vi.mock('nitropack/runtime', () => ({
  useRuntimeConfig: () => runtimeConfig.current,
  defineNitroPlugin: (plugin: unknown) => plugin,
}))

interface Row {
  id: string
}

const rows: Row[] = [{ id: 'a' }, { id: 'b' }]
const sortable = ['createdAt', 'name'] as const

beforeEach(() => {
  runtimeConfig.current = {}
})

/** One request through a real h3 app, answering what the route replied. */
async function call(
  url: string,
  handler: (event: H3Event<EventHandlerRequest>) => unknown,
): Promise<{ body: Record<string, unknown>; status: number }> {
  const app = createApp().use(defineEventHandler((event) => handler(event)))
  const response = await toWebHandler(app)(new Request(`http://list.test${url}`))

  return { body: (await response.json()) as Record<string, unknown>, status: response.status }
}

function offsetRoute(event: H3Event) {
  const query = parseListQuery(event, {
    filters: z.object({ status: z.enum(['closed', 'open']).optional() }),
    maxLimit: 100,
    sortable,
  })

  return listResponse(rows, { query, total: 2 })
}

function strictOffsetRoute(event: H3Event) {
  const query = parseListQuery(event, {
    filters: z.object({ status: z.enum(['closed', 'open']).optional() }),
    maxLimit: 100,
    sortable,
    strict: true,
  })

  return listResponse(rows, { query, total: 2 })
}

describe('parseListQuery — unknown keys (tolerate-and-warn default)', () => {
  it('tolerates an unknown key: 200 with the same rows as the request without it', async () => {
    const baseline = await call('/?limit=10', offsetRoute)
    const withUnknown = await call('/?limit=10&pge=2', offsetRoute)

    expect(withUnknown.status).toBe(200)
    expect(withUnknown.body).toEqual(baseline.body)
  })

  it('logs one structured warning naming every unknown key', async () => {
    const sink = createMemorySink()
    runtimeConfig.current = { nardukLogging: { sinks: [sink] } }

    await call('/?limit=10&pge=2&serach=abc', offsetRoute)

    const warnings = sink.records.filter((record) => record.level === 'warn')
    expect(warnings).toHaveLength(1)
    expect(warnings[0]?.message).toContain('pge')
    expect(warnings[0]?.message).toContain('serach')
    expect(warnings[0]?.data).toMatchObject({
      code: 'list_query_unknown_keys',
      unknownKeys: ['pge', 'serach'],
    })
  })

  it('does not warn when the request sends no unknown keys', async () => {
    const sink = createMemorySink()
    runtimeConfig.current = { nardukLogging: { sinks: [sink] } }

    await call('/?limit=10&status=open', offsetRoute)

    expect(sink.records.filter((record) => record.level === 'warn')).toHaveLength(0)
  })
})

describe('parseListQuery — strict opt-in', () => {
  it('answers 400 — never 500 — for an unknown key, naming it in the payload', async () => {
    const { body, status } = await call('/?limit=10&pge=2', strictOffsetRoute)

    expect(status).toBe(400)
    expect(body).toMatchObject({
      data: {
        code: 'invalid_list_query',
        fields: ['pge'],
        unknownKeys: ['pge'],
      },
      statusCode: 400,
    })
  })
})

describe('parseListQuery', () => {
  it('rejects a sort outside the allowlist and names the field', async () => {
    const { body, status } = await call('/?sort=passwordHash:asc', offsetRoute)

    expect(status).toBe(400)
    expect(body).toMatchObject({ data: { fields: ['sort'], unknownKeys: [] } })
  })

  it('rejects a filter value the route does not accept', async () => {
    const { body, status } = await call('/?status=archived', offsetRoute)

    expect(status).toBe(400)
    expect(body).toMatchObject({ data: { fields: ['status'] } })
  })

  it('rejects a repeated parameter instead of silently taking one of them', async () => {
    const { status } = await call('/?limit=10&limit=20', offsetRoute)

    expect(status).toBe(400)
  })

  it('rejects q on a route that does not search, rather than ignoring it', async () => {
    const unsearchable = (event: H3Event) =>
      listResponse(rows, {
        query: parseListQuery(event, { maxLimit: 100, searchable: false, sortable }),
        total: 2,
      })

    const rejected = await call('/?q=ada', unsearchable)
    expect(rejected.status).toBe(400)
    expect(rejected.body).toMatchObject({ data: { fields: ['q'] } })

    // A blank q narrows nothing, so it is absence rather than a dropped filter.
    expect((await call('/?q=', unsearchable)).status).toBe(200)
  })

  it('clamps an over-large limit to the route ceiling', async () => {
    const { body, status } = await call('/?limit=9999', offsetRoute)

    expect(status).toBe(200)
    expect(body.limit).toBe(100)
  })

  it('parses limit, offset, sort, q and filters off a real event', async () => {
    const { body, status } = await call(
      '/?limit=5&offset=10&sort=name:desc&q=%20ada%20&status=open',
      (event) => {
        const query = parseListQuery(event, {
          filters: z.object({ status: z.enum(['closed', 'open']).optional() }),
          maxLimit: 100,
          sortable,
        })

        return { filters: query.filters, ...listResponse(rows, { query, total: 2 }) }
      },
    )

    expect(status).toBe(200)
    expect(body).toMatchObject({
      filters: { status: 'open' },
      limit: 5,
      offset: 10,
      q: 'ada',
      sort: 'name:desc',
    })
  })
})

describe('listResponse', () => {
  it('answers the offset shape, echoing the query back', async () => {
    const { body } = await call('/?sort=createdAt:asc', offsetRoute)

    expect(body).toEqual({
      items: rows,
      limit: 25,
      offset: 0,
      q: null,
      sort: 'createdAt:asc',
      total: 2,
    })
  })

  it('reports total as null when the route does not count', async () => {
    const { body } = await call('/', (event) =>
      listResponse(rows, { query: parseListQuery(event, { maxLimit: 10, sortable }) }),
    )

    expect(body.total).toBeNull()
  })

  it('answers the cursor shape, with nextCursor null when exhausted', async () => {
    const cursorRoute = (next: string | null) => (event: H3Event) =>
      listResponse(rows, {
        nextCursor: next,
        query: parseListQuery(event, { maxLimit: 10, mode: 'cursor', sortable }),
      })

    const exhausted = await call('/', cursorRoute(null))
    expect(exhausted.body).toEqual({
      items: rows,
      limit: 10,
      nextCursor: null,
      q: null,
      sort: null,
      total: null,
    })

    const more = await call('/?cursor=eyJpZCI6ImIifQ', cursorRoute('eyJpZCI6ImMifQ'))
    expect(more.body).toMatchObject({ nextCursor: 'eyJpZCI6ImMifQ' })
    expect(more.body).not.toHaveProperty('offset')
  })
})

describe('statement ceiling', () => {
  it('is one page query plus one optional count — parseListQuery cannot run SQL', () => {
    // The ceiling lives on the contract because parseListQuery never sees a
    // database. Route tests in narduk-auth and narduk-ai wrap the D1 binding
    // and assert the real statement count against this number.
    expect(LIST_QUERY_STATEMENT_CEILING).toBe(2)
  })
})
