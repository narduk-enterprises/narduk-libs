/** SQL offset paging for a validated list query. SQL expressions are trusted application code, never request strings. */
import { createError } from 'h3'

import { listResponse } from './utils/listQuery'

import type {
  OffsetListQuery,
  OffsetListResponse,
} from '@narduk-enterprises/narduk-platform/list-query'

export interface ListSqlStatement {
  all<T>(): Promise<{ results: T[] }>
  bind(...values: unknown[]): ListSqlStatement
  first<T>(): Promise<T | null>
}
export interface ListSqlDatabase {
  prepare(sql: string): ListSqlStatement
}
export interface OffsetSqlListOptions {
  bindings?: unknown[]
  /** Stable default ORDER BY, and stable tie-breakers after an explicit sort. */
  defaultOrder: string
  /** Trusted table/join/subquery expression. */
  from: string
  /** Trusted searchable column expressions, compared as literal substrings. */
  search?: readonly string[]
  /** Trusted SELECT projection, including any aliases the DTO promises. */
  select: string
  /** Trusted expressions keyed by the route's allowlisted public sort names. */
  sortColumns: Readonly<Record<string, string>>
  tieBreakers: string
  /** Authorization and domain filters, applied identically to rows and count. */
  where?: string
}

/** Exactly two statements: scoped count and bounded page. No row-at-a-time I/O. */
export async function readOffsetSqlPage<T>(
  db: ListSqlDatabase,
  query: OffsetListQuery<unknown>,
  options: OffsetSqlListOptions,
): Promise<OffsetListResponse<T>> {
  const clauses = options.where ? [`(${options.where})`] : []
  const bindings = [...(options.bindings ?? [])]
  if (query.q && options.search?.length) {
    clauses.push(
      `(${options.search.map((column) => `instr(lower(COALESCE(${column}, '')), lower(?)) > 0`).join(' OR ')})`,
    )
    bindings.push(...options.search.map(() => query.q))
  }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''
  let order = options.defaultOrder
  if (query.sort) {
    const column = options.sortColumns[query.sort.key]
    if (!column) throw createError({ statusCode: 400, message: 'Unsupported list sort.' })
    order = `${column} ${query.sort.direction === 'desc' ? 'DESC' : 'ASC'}, ${options.tieBreakers}`
  }
  const [count, page] = await Promise.all([
    db
      .prepare(`SELECT COUNT(*) AS total FROM ${options.from}${where}`)
      .bind(...bindings)
      .first<{ total: number }>(),
    db
      .prepare(
        `SELECT ${options.select} FROM ${options.from}${where} ORDER BY ${order} LIMIT ? OFFSET ?`,
      )
      .bind(...bindings, query.limit, query.offset)
      .all<T>(),
  ])
  if (!count || !Number.isSafeInteger(count.total) || count.total < 0)
    throw createError({ statusCode: 503, message: 'The list count could not be read.' })
  return listResponse(page.results, { query, total: count.total })
}
