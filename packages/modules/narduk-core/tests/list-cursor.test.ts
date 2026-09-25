/**
 * Keyset cursor codec and tie-safe seek (narduk-libs#987), the seek proven on
 * the real D1 driver against rows that share a timestamp — the #941 and #974
 * shape.
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { asc, desc, lt } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { createApp, defineEventHandler, toWebHandler } from 'h3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createD1QueryHarness } from '../../../tooling/narduk-testkit/src/d1'
import {
  decodeListCursor,
  encodeListCursor,
  keysetAfter,
  LIST_CURSOR_MAX_LENGTH,
  type ListCursorScope,
  readListCursor,
} from '../runtime/server/list-cursor'

import type { D1QueryHarness } from '../../../tooling/narduk-testkit/src/d1'
import type { H3Event } from 'h3'

const scope: ListCursorScope = { endpoint: 'audit.events', sort: 'createdAt:desc', bind: ['org-1'] }

/** Decodes and returns the 400's data, or `undefined` if nothing threw. */
async function refusal(promise: Promise<unknown>) {
  try {
    await promise
  } catch (error) {
    const { data, statusCode } = error as { data: unknown; statusCode: number }
    return { data, statusCode }
  }
  return
}

function forge(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url')
}

describe('encodeListCursor / decodeListCursor', () => {
  it('round-trips a composite position', async () => {
    const cursor = await encodeListCursor(scope, [1_700_000_000, 'evt_9'])
    expect(cursor).toMatch(/^[\w-]+$/u)
    await expect(decodeListCursor(cursor, scope, { arity: 2 })).resolves.toEqual([
      1_700_000_000,
      'evt_9',
    ])
  })

  it('treats a missing or empty cursor as the first page', async () => {
    await expect(decodeListCursor(undefined, scope, { arity: 2 })).resolves.toBeUndefined()
    await expect(decodeListCursor('', scope, { arity: 2 })).resolves.toBeUndefined()
  })

  it('does not carry the bind values in readable form', async () => {
    const cursor = await encodeListCursor({ ...scope, bind: ['secret-farm-id'] }, ['a'])
    expect(Buffer.from(cursor, 'base64url').toString()).not.toContain('secret-farm-id')
  })

  it.each([
    ['another endpoint', { ...scope, endpoint: 'audit.other' }],
    ['another sort', { ...scope, sort: 'createdAt:asc' }],
    ['another bind', { ...scope, bind: ['org-2'] }],
    ['no bind', { endpoint: scope.endpoint, sort: scope.sort }],
  ])('refuses a cursor read under %s', async (_label, other) => {
    const cursor = await encodeListCursor(scope, [1, 'a'])
    await expect(refusal(decodeListCursor(cursor, other, { arity: 2 }))).resolves.toEqual({
      data: { code: 'cursor_invalid', reason: 'binding' },
      statusCode: 400,
    })
  })

  it('refuses the wrong arity', async () => {
    const cursor = await encodeListCursor(scope, [1])
    await expect(refusal(decodeListCursor(cursor, scope, { arity: 2 }))).resolves.toMatchObject({
      data: { reason: 'arity' },
    })
  })

  it('refuses a stale version', async () => {
    const good = JSON.parse(Buffer.from(await encodeListCursor(scope, [1]), 'base64url').toString())
    const stale = forge({ ...good, v: 0 })
    await expect(refusal(decodeListCursor(stale, scope, { arity: 1 }))).resolves.toMatchObject({
      data: { reason: 'version' },
    })
  })

  it.each([
    ['not base64url', 'not a cursor!'],
    ['not JSON', Buffer.from('{').toString('base64url')],
    ['an array', forge([1])],
    ['a non-scalar position', forge({ h: 'x', p: [{}], v: 1 })],
    ['a non-finite number', Buffer.from('{"h":"x","p":[1e999],"v":1}').toString('base64url')],
  ])('refuses a cursor that is %s', async (_label, cursor) => {
    const result = await refusal(decodeListCursor(cursor, scope, { arity: 1 }))
    expect(result?.statusCode).toBe(400)
    expect(result?.data).toMatchObject({ code: 'cursor_invalid' })
  })

  it('refuses an oversized cursor before decoding it', async () => {
    const huge = 'a'.repeat(LIST_CURSOR_MAX_LENGTH + 1)
    await expect(refusal(decodeListCursor(huge, scope, { arity: 1 }))).resolves.toMatchObject({
      data: { reason: 'too_long' },
    })
  })

  it('applies the caller validate check', async () => {
    const cursor = await encodeListCursor(scope, ['not-a-number'])
    const isNumber = (p: readonly unknown[]): p is [number] => typeof p[0] === 'number'
    await expect(
      refusal(decodeListCursor(cursor, scope, { arity: 1, validate: isNumber })),
    ).resolves.toMatchObject({ data: { reason: 'malformed' } })
  })

  it('refuses to encode an empty or non-finite position', async () => {
    await expect(encodeListCursor(scope, [])).rejects.toThrow(/must not be empty/)
    await expect(encodeListCursor(scope, [Number.NaN])).rejects.toThrow(/finite numbers/)
  })
})

describe('readListCursor', () => {
  async function call(url: string, handler: (event: H3Event) => unknown) {
    const app = createApp().use(defineEventHandler((event) => handler(event)))
    const response = await toWebHandler(app)(new Request(`http://list.test${url}`))
    return { body: (await response.json()) as Record<string, unknown>, status: response.status }
  }

  const route = async (event: H3Event) => ({
    position: (await readListCursor(event, scope, { arity: 2 })) ?? null,
  })

  it('reads ?cursor= and answers the position', async () => {
    const cursor = await encodeListCursor(scope, [5, 'b'])
    await expect(call(`/?cursor=${cursor}`, route)).resolves.toEqual({
      body: { position: [5, 'b'] },
      status: 200,
    })
    await expect(call('/', route)).resolves.toEqual({ body: { position: null }, status: 200 })
  })

  it('refuses a repeated ?cursor= with the stable 400', async () => {
    const cursor = await encodeListCursor(scope, [5, 'b'])
    const { body, status } = await call(`/?cursor=${cursor}&cursor=${cursor}`, route)
    expect(status).toBe(400)
    expect(body.data).toEqual({ code: 'cursor_invalid', reason: 'repeated' })
  })
})

describe('keysetAfter on D1', () => {
  const events = sqliteTable('events', {
    id: text('id').primaryKey(),
    createdAt: integer('created_at').notNull(),
  })

  // Three rows share every timestamp, so any page size below three puts a
  // page boundary between tied rows.
  const rows = Array.from({ length: 12 }, (_, index) => ({
    id: `evt_${String(index).padStart(2, '0')}`,
    createdAt: 1000 + Math.floor(index / 3),
  }))

  let harness: D1QueryHarness

  beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'list-cursor-'))
    const migration = join(dir, '0000.sql')
    writeFileSync(
      migration,
      'CREATE TABLE events (id TEXT PRIMARY KEY NOT NULL, created_at INTEGER NOT NULL);',
    )
    harness = await createD1QueryHarness({ migrations: [migration] })
    await drizzle(harness.raw).insert(events).values(rows)
  })

  afterAll(async () => {
    await harness?.dispose()
  })

  /** Pages through the table two rows at a time with `seek`, via a real cursor. */
  async function pageAll(dir: 'asc' | 'desc', seek = keysetAfter) {
    const db = drizzle(harness.db)
    const order = dir === 'asc' ? asc : desc
    const seen: string[] = []
    let cursor: string | undefined
    for (let guard = 0; guard < 20; guard++) {
      const position = await decodeListCursor(cursor, { ...scope, sort: dir }, { arity: 2 })
      const page = await db
        .select()
        .from(events)
        .where(position ? seek([events.createdAt, events.id], position, dir) : undefined)
        .orderBy(order(events.createdAt), order(events.id))
        .limit(2)
        .all()
      seen.push(...page.map((row) => row.id))
      const last = page.at(-1)
      if (page.length < 2 || !last) return seen
      cursor = await encodeListCursor({ ...scope, sort: dir }, [last.createdAt, last.id])
    }
    throw new Error('did not terminate')
  }

  it('visits every row exactly once, newest first, across tied timestamps', async () => {
    const expected = [...rows]
      .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))
      .map((row) => row.id)
    await expect(pageAll('desc')).resolves.toEqual(expected)
  })

  it('visits every row exactly once, oldest first', async () => {
    await expect(pageAll('asc')).resolves.toEqual(rows.map((row) => row.id))
  })

  it('is the fix: a timestamp-only seek skips tied rows on the same data', async () => {
    const timestampOnly = ((columns, position) => lt(columns[0], position[0])) as typeof keysetAfter
    const seen = await pageAll('desc', timestampOnly)
    expect(seen.length).toBeLessThan(rows.length)
  })

  it('binds every position value as a parameter', () => {
    const query = drizzle(harness.db)
      .select()
      .from(events)
      .where(keysetAfter([events.createdAt, events.id], [1001, "x' OR 1=1 --"], 'desc'))
      .toSQL()
    expect(query.sql).not.toContain('OR 1=1')
    expect(query.params).toEqual([1001, 1001, "x' OR 1=1 --"])
  })

  it('refuses a position whose length does not match the columns', () => {
    expect(() => keysetAfter([events.createdAt, events.id], [1], 'asc')).toThrow(RangeError)
  })
})
