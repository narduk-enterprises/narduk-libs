import { DatabaseSync, type SQLInputValue } from 'node:sqlite'

import { describe, expect, it, vi } from 'vitest'

import {
  type ListSqlDatabase,
  type ListSqlStatement,
  readOffsetSqlPage,
} from '../runtime/server/sql-list'

import type { OffsetListQuery } from '@narduk-enterprises/narduk-platform/list-query'

vi.mock('nitropack/runtime', () => ({
  useRuntimeConfig: () => ({}),
  defineNitroPlugin: (plugin: unknown) => plugin,
}))

const query = (over: Partial<OffsetListQuery> = {}): OffsetListQuery => ({
  mode: 'offset',
  offset: 0,
  limit: 25,
  q: null,
  sort: null,
  filters: {},
  unknownKeys: [],
  ...over,
})
const spec = {
  from: 'records',
  select: '*',
  defaultOrder: 'name ASC, id ASC',
  tieBreakers: 'id ASC',
  sortColumns: { name: 'name' },
  search: ['name'],
  where: 'tenant = ?',
  bindings: ['one'],
}

function fixture() {
  const raw = new DatabaseSync(':memory:')
  raw.exec(
    'CREATE TABLE records (id INTEGER PRIMARY KEY, tenant TEXT, name TEXT); CREATE INDEX records_scope_name ON records(tenant, name, id)',
  )
  for (let id = 1; id <= 106; id++)
    raw.prepare('INSERT INTO records VALUES (?, ?, ?)').run(id, 'one', 'equal')
  raw.prepare('INSERT INTO records VALUES (?, ?, ?)').run(200, 'two', 'other')
  const statements: string[] = []
  const db: ListSqlDatabase = {
    prepare(sql) {
      statements.push(sql)
      const prepared = raw.prepare(sql)
      const bind = (values: unknown[]): ListSqlStatement => ({
        bind: (...next) => bind(next),
        all: async <T>() => ({ results: prepared.all(...(values as SQLInputValue[])) as T[] }),
        first: async <T>() => (prepared.get(...(values as SQLInputValue[])) ?? null) as T | null,
      })
      return bind([])
    },
  }
  return { db, raw, statements }
}
describe('readOffsetSqlPage', () => {
  it('reaches every equal-sort row in stable bounded pages, scoped before count and paging', async () => {
    const { db, raw, statements } = fixture()
    const ids: number[] = []
    for (let offset = 0; offset < 125; offset += 25) {
      const result = await readOffsetSqlPage<{ id: number }>(db, query({ offset }), spec)
      expect(result.items.length).toBeLessThanOrEqual(25)
      expect(result.total).toBe(106)
      ids.push(...result.items.map((row) => row.id))
    }
    expect(ids).toEqual(Array.from({ length: 106 }, (_, index) => index + 1))
    expect(statements).toHaveLength(10)
    const plan = raw.prepare('EXPLAIN QUERY PLAN ' + statements[1]).all('one', 25, 0)
    expect(plan.some((row) => String(row.detail).includes('records_scope_name'))).toBe(true)
    raw.close()
  })
  it('binds search as a literal substring and rejects a sort outside the trusted map', async () => {
    const { db, raw } = fixture()
    const result = await readOffsetSqlPage(db, query({ q: "%' OR 1=1 --" }), spec)
    expect(result.items).toEqual([])
    expect(result.total).toBe(0)
    await expect(
      readOffsetSqlPage(db, query({ sort: { key: 'password', direction: 'asc' } }), spec),
    ).rejects.toMatchObject({ statusCode: 400 })
    raw.close()
  })
})
