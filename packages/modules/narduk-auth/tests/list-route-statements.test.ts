/**
 * Statement ceiling for this package's two list routes (narduk-libs#257).
 *
 * What is counted: every SQL statement the routes prepare against a real
 * Miniflare D1 database, created from narduk-core's own migrations by
 * narduk-testkit's D1 query harness. The binding drizzle receives records each
 * `prepare()` — so these are the statements the ORM actually emits, not a
 * count of helper calls. The ceiling must hold as the page size and the offset
 * move.
 */
import { fileURLToPath } from 'node:url'

import { drizzle } from 'drizzle-orm/d1'
import { createApp, toWebHandler } from 'h3'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { createD1QueryHarness, expectStatementBudget } from '../../../tooling/narduk-testkit/src/d1'

import type { D1QueryHarness } from '../../../tooling/narduk-testkit/src/d1'
import type { EventHandler } from 'h3'

const harness = vi.hoisted(() => ({
  database: null as unknown,
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

const MIGRATIONS = ['0000_initial_schema.sql', '0003_notifications.sql'].map((name) =>
  fileURLToPath(new URL(`../../narduk-core/runtime/drizzle/${name}`, import.meta.url)),
)
const USER_COUNT = 25
const NOTIFICATION_COUNT = 12

async function call(handler: EventHandler, url: string) {
  const response = await toWebHandler(createApp().use(handler))(
    new Request(`http://list.test${url}`),
  )

  return { body: (await response.json()) as Record<string, unknown>, status: response.status }
}

describe('list routes hold a one-page-plus-one-count statement ceiling', () => {
  let d1: D1QueryHarness

  beforeAll(async () => {
    d1 = await createD1QueryHarness({ migrations: MIGRATIONS })
    const binding = d1.raw

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
    harness.database = drizzle(d1.db)
  })

  afterAll(() => d1.dispose())

  beforeEach(() => {
    d1.reset()
  })

  it('serves any page of /api/admin/users in one page query plus one count query', async () => {
    const handler = (await import('../server/api/admin/users/index.get')).default

    for (const [limit, offset] of [
      [2, 0],
      [2, 20],
      [100, 0],
    ]) {
      const {
        result: { body, status },
        statements,
      } = await expectStatementBudget(
        d1,
        () => call(handler, `/?limit=${limit}&offset=${offset}`),
        { max: 2 },
      )

      expect(status).toBe(200)
      expect(body).toMatchObject({ limit, offset, q: null, sort: 'createdAt:desc', total: 25 })
      expect(body.items).toHaveLength(Math.min(limit, USER_COUNT - offset))
      expect(body.users).toEqual(body.items)
      expect(body.page).toBe(Math.floor(offset / limit) + 1)
      expect(statements).toHaveLength(2)
      expect(statements.filter((sql) => /count\(\*\)/iu.test(sql))).toHaveLength(1)
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
      const {
        result: { body, status },
        statements,
      } = await expectStatementBudget(d1, () => call(handler, query), { max: 1 })

      expect(status).toBe(200)
      expect(body.total).toBeNull()
      expect(body.notifications).toEqual(body.items)
      expect(statements).toHaveLength(1)
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
