import { asc, desc, sql } from 'drizzle-orm'
import { createError, defineEventHandler, getQuery } from 'h3'
import { z } from 'zod'

import { requireAdmin } from '#layer/server/utils/auth'
import { getDatabaseRow, getDatabaseRows, useDatabase } from '#layer/server/utils/database'
import { listResponse, parseListQuery } from '#layer/server/utils/listQuery'
import { users } from '#narduk-core/schema'

/** Page ceiling this route has always enforced; now a clamp, not a rejection. */
const MAX_LIMIT = 100
const DEFAULT_LIMIT = 20

/**
 * `createdAt` is the only ordering this route has ever served, so it is the
 * whole allowlist: a new sort key needs an index before it is offered.
 */
const SORTABLE = ['createdAt'] as const

/**
 * `page` is the pre-contract pagination key. Keep accepting it so existing
 * fleet callers (`?page=2&limit=20`) do not 400; convert to `offset`.
 */
const LEGACY = z.object({
  page: z.coerce.number().int().min(1).optional(),
})

interface CountRow {
  count: bigint | number | string | null
}

function normalizeCount(value: CountRow['count'] | undefined): number {
  const count = Number(value ?? 0)
  if (!Number.isSafeInteger(count) || count < 0) {
    throw createError({ statusCode: 500, message: 'Invalid user count.' })
  }

  return count
}

/** Prefer `page` when that is what the caller sent; reject a disagreeing pair. */
function resolveOffset(
  query: { filters: { page?: number }; limit: number; offset: number },
  raw: { offset?: unknown },
): number {
  if (query.filters.page == null) return query.offset

  const fromPage = (query.filters.page - 1) * query.limit
  if (raw.offset !== undefined && query.offset !== fromPage) {
    throw createError({
      data: {
        code: 'invalid_list_query',
        fields: ['offset', 'page'],
        issues: [
          {
            code: 'custom',
            field: 'page',
            message: 'page and offset disagree; send one of them.',
          },
        ],
        unknownKeys: [],
      },
      message: 'Invalid list query: offset, page.',
      statusCode: 400,
      statusMessage: 'Bad Request',
    })
  }

  return fromPage
}

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const raw = getQuery(event)
  const query = parseListQuery(event, {
    defaultLimit: DEFAULT_LIMIT,
    defaultSort: 'createdAt:desc',
    filters: LEGACY,
    maxLimit: MAX_LIMIT,
    // This route has never searched; `q` is rejected rather than ignored.
    searchable: false,
    sortable: SORTABLE,
  })
  const offset = resolveOffset(query, raw)
  const resolved = { ...query, offset }

  const db = useDatabase(event)
  const order = query.sort?.direction === 'asc' ? asc(users.createdAt) : desc(users.createdAt)

  // One page query plus one count query, whatever the page size.
  const [totalResult, userRows] = await Promise.all([
    getDatabaseRow<CountRow>(db.select({ count: sql<CountRow['count']>`count(*)` }).from(users)),
    getDatabaseRows<typeof users.$inferSelect>(
      db.select().from(users).orderBy(order).limit(query.limit).offset(offset),
    ),
  ])

  const items = userRows.map((userRow) => ({
    id: userRow.id,
    email: userRow.email,
    name: userRow.name,
    isAdmin: userRow.isAdmin ?? false,
    createdAt: userRow.createdAt,
  }))

  const body = listResponse(items, { query: resolved, total: normalizeCount(totalResult?.count) })
  return {
    ...body,
    // Deprecated aliases: keep `{ users, page }` so existing consumers still
    // read. Drop in the next narduk-auth major once fleet apps use `items`.
    page: query.filters.page ?? Math.floor(offset / query.limit) + 1,
    users: items,
  }
})
