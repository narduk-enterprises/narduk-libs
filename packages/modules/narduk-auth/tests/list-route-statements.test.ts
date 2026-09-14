/**
 * Statement ceiling for this package's two list routes (narduk-libs#257).
 *
 * What is counted: every SQL statement the routes prepare against a real
 * Miniflare D1 database, created from narduk-core's own migrations. The D1
 * binding drizzle receives is wrapped so `prepare()` records the statement text
 * — so these are the statements the ORM actually emits, not a count of helper
 * calls. The ceiling must hold as the page size and the offset move.
 */
import { readFileSync } from 'node:fs'

import { drizzle } from 'drizzle-orm/d1'
import { createApp, toWebHandler } from 'h3'
import { Miniflare } from 'miniflare'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { EventHandler } from 'h3'

const harness = vi.hoisted(() => ({
  database: null as unknown,
  statements: [] as string[],
}))

// The real narduk-core tables, so the statements run against the real columns.
vi.mock(
  '#narduk-core/schema',
  async () => await import('@narduk-enterprises/narduk-core/server/database/schema'),
)

// The database helpers are the seam: the query builders themselves are real.
vi.mock('#layer/server/utils/database', () => ({
  getDatabaseRow: async (query: unknown) => (await (query as Promise<unknown[]>))[0],
  getDatabaseRows: async (query: unknown) => await (query as Promise<unknown[]>),
  useDatabase: () => harness.database,
}))

const MIGRATIONS = ['0000_initial_schema.sql', '0003_notifications.sql']
const USER_COUNT = 25
const NOTIFICATION_COUNT = 12

type D1 = Awaited<ReturnType<Miniflare['getD1Database']>>

function readMigration(name: string): string[] {
  const sql = readFileSync(new URL(`../../narduk-core/runtime/drizzle/${name}`, import.meta.url), {
    encoding: 'utf8',
  })

  return sql
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean)
}

/** Records the SQL drizzle prepares, then hands the real statement back. */
function countingBinding(binding: D1): D1 {
  return {
    ...binding,
    batch: (statements: unknown[]) => (binding.batch as (input: unknown[]) => unknown)(statements),
    prepare: (sql: string) => {
      harness.statements.push(sql)
      return binding.prepare(sql)
    },
  } as unknown as D1
}

async function call(handler: EventHandler, url: string) {
  const response = await toWebHandler(createApp().use(handler))(
    new Request(`http://list.test${url}`),
  )

  return { body: (await response.json()) as Record<string, unknown>, status: response.status }
}

describe('list routes hold a one-page-plus-one-count statement ceiling', () => {
  const runtime = new Miniflare({
    compatibilityDate: '2026-07-01',
    d1Databases: ['DB'],
    modules: true,
    script: 'export default { fetch() { return new Response("ok") } }',
  })

  beforeAll(async () => {
    const binding = await runtime.getD1Database('DB')

    for (const migration of MIGRATIONS) {
      await binding.batch(readMigration(migration).map((statement) => binding.prepare(statement)))
    }

    await binding.batch(
      Array.from({ length: USER_COUNT }, (_row, index) =>
        binding
          .prepare(
            'INSERT INTO users (id, email, password_hash, name, is_admin, created_at, updated_at) VALUES (?, ?, NULL, ?, 1, ?, ?)',
          )
          .bind(
            `user-${index}`,
            `user-${index}@list.test`,
            `User ${index}`,
            `2026-01-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
            '2026-01-01T00:00:00.000Z',
          ),
      ),
    )

    await binding.batch(
      Array.from({ length: NOTIFICATION_COUNT }, (_row, index) =>
        binding
          .prepare(
            'INSERT INTO notifications (id, user_id, kind, title, body, is_read, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          )
          .bind(
            `notification-${index}`,
            'user-1',
            'system',
            `Notification ${index}`,
            'body',
            index % 2,
            `2026-02-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
          ),
      ),
    )

    // Seeding used the raw binding; only the routes' own statements are counted.
    harness.database = drizzle(countingBinding(binding))
  })

  afterAll(() => runtime.dispose())

  beforeEach(() => {
    harness.statements.length = 0
  })

  it('serves any page of /api/admin/users in one page query plus one count query', async () => {
    const handler = (await import('../server/api/admin/users/index.get')).default

    for (const [limit, offset] of [
      [2, 0],
      [2, 20],
      [100, 0],
    ]) {
      harness.statements.length = 0
      const { body, status } = await call(handler, `/?limit=${limit}&offset=${offset}`)

      expect(status).toBe(200)
      expect(body).toMatchObject({ limit, offset, q: null, sort: 'createdAt:desc', total: 25 })
      expect(body.items).toHaveLength(Math.min(limit, USER_COUNT - offset))
      expect(body.users).toEqual(body.items)
      expect(body.page).toBe(Math.floor(offset / limit) + 1)
      expect(harness.statements).toHaveLength(2)
      expect(harness.statements.filter((sql) => /count\(\*\)/iu.test(sql))).toHaveLength(1)
    }
  })

  it('pages /api/admin/users by offset rather than ignoring it', async () => {
    const handler = (await import('../server/api/admin/users/index.get')).default
    const first = await call(handler, '/?limit=2&offset=0')
    const second = await call(handler, '/?limit=2&offset=2')

    const ids = (body: Record<string, unknown>) =>
      (body.items as Array<{ id: string }>).map((item) => item.id)

    expect(ids(first.body)).not.toEqual(ids(second.body))
    expect(new Set([...ids(first.body), ...ids(second.body)]).size).toBe(4)
  })

  it('still accepts the pre-contract page key and echoes users + page', async () => {
    const handler = (await import('../server/api/admin/users/index.get')).default
    const first = await call(handler, '/?page=1&limit=2')
    const second = await call(handler, '/?page=2&limit=2')

    expect(first.status).toBe(200)
    expect(first.body).toMatchObject({ limit: 2, offset: 0, page: 1 })
    expect(first.body.users).toEqual(first.body.items)
    expect(second.status).toBe(200)
    expect(second.body).toMatchObject({ limit: 2, offset: 2, page: 2 })
    expect((second.body.items as unknown[]).length).toBe(2)

    // `page` wins when both keys are sent — old callers never sent offset.
    const both = await call(handler, '/?page=2&offset=0&limit=2')
    expect(both.status).toBe(200)
    expect(both.body).toMatchObject({ limit: 2, offset: 2, page: 2 })
  })

  it('serves any page of /api/notifications in a single query, with total null', async () => {
    const handler = (await import('../server/api/notifications/index.get')).default

    for (const query of ['/', '/?limit=4&offset=4', '/?limit=4&unreadOnly=true']) {
      harness.statements.length = 0
      const { body, status } = await call(handler, query)

      expect(status).toBe(200)
      expect(body.total).toBeNull()
      expect(body.notifications).toEqual(body.items)
      expect(harness.statements).toHaveLength(1)
    }
  })

  it('applies the notifications unreadOnly filter and offset to the query itself', async () => {
    const handler = (await import('../server/api/notifications/index.get')).default

    const unread = await call(handler, '/?unreadOnly=true')
    expect((unread.body.items as Array<{ isRead: boolean }>).every((row) => !row.isRead)).toBe(true)
    expect(unread.body.notifications).toEqual(unread.body.items)

    // Pre-contract schema accepted any string; only `'true'` filtered.
    const ignored = await call(handler, '/?unreadOnly=yes')
    expect(ignored.status).toBe(200)
    expect((ignored.body.items as unknown[]).length).toBe(NOTIFICATION_COUNT)

    const firstPage = await call(handler, '/?limit=3&offset=0')
    const secondPage = await call(handler, '/?limit=3&offset=3')
    const ids = (body: Record<string, unknown>) =>
      (body.items as Array<{ id: string }>).map((item) => item.id)

    expect(ids(firstPage.body)).toHaveLength(3)
    expect(new Set([...ids(firstPage.body), ...ids(secondPage.body)]).size).toBe(6)
  })

  it('actually reorders /api/notifications by sort direction, not merely echoing it', async () => {
    const handler = (await import('../server/api/notifications/index.get')).default

    const ids = (body: Record<string, unknown>) =>
      (body.items as Array<{ id: string }>).map((item) => item.id)

    const defaultOrder = await call(handler, '/')
    const descending = await call(handler, '/?sort=createdAt:desc')
    const ascending = await call(handler, '/?sort=createdAt:asc')

    expect(descending.status).toBe(200)
    expect(ascending.status).toBe(200)
    expect(descending.body).toMatchObject({ sort: 'createdAt:desc' })
    expect(ascending.body).toMatchObject({ sort: 'createdAt:asc' })

    // The unsorted default matches the explicit newest-first request...
    expect(ids(defaultOrder.body)).toEqual(ids(descending.body))
    // ...and asking for oldest-first genuinely reverses the row order. An
    // echo-only bug would leave both requests returning the same
    // newest-first rows while only the `sort` field in the body changed.
    expect(ids(ascending.body)).toEqual([...ids(descending.body)].reverse())
    expect(ids(ascending.body)).not.toEqual(ids(descending.body))
  })

  it('tolerates an unknown query key on both routes with a 200, not a 400 or 500', async () => {
    // Tolerate-and-warn (Logan, 2026-09-11): an unknown key is ignored and
    // logged rather than rejected, for one release. See
    // `.changeset/list-query-tolerate-unknown-keys.md`. Neither route opts
    // into `strict: true`, so a typo'd key like these no longer 400s.
    const users = (await import('../server/api/admin/users/index.get')).default
    const notifications = (await import('../server/api/notifications/index.get')).default

    expect((await call(users, '/?pge=2')).status).toBe(200)
    expect((await call(notifications, '/?unread=true')).status).toBe(200)
  })

  it('rejects q on both routes, since neither one searches', async () => {
    const users = (await import('../server/api/admin/users/index.get')).default
    const notifications = (await import('../server/api/notifications/index.get')).default

    expect((await call(users, '/?q=user-1')).status).toBe(400)
    expect((await call(notifications, '/?q=hello')).status).toBe(400)
  })
})
