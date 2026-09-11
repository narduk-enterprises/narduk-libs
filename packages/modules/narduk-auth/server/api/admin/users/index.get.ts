import { asc, desc, sql } from 'drizzle-orm'
import { createError, defineEventHandler } from 'h3'

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

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const query = parseListQuery(event, {
    defaultLimit: DEFAULT_LIMIT,
    defaultSort: 'createdAt:desc',
    maxLimit: MAX_LIMIT,
    sortable: SORTABLE,
  })

  const db = useDatabase(event)
  const order = query.sort?.direction === 'asc' ? asc(users.createdAt) : desc(users.createdAt)

  // One page query plus one count query, whatever the page size.
  const [totalResult, userRows] = await Promise.all([
    getDatabaseRow<CountRow>(db.select({ count: sql<CountRow['count']>`count(*)` }).from(users)),
    getDatabaseRows<typeof users.$inferSelect>(
      db.select().from(users).orderBy(order).limit(query.limit).offset(query.offset),
    ),
  ])

  const items = userRows.map((userRow) => ({
    id: userRow.id,
    email: userRow.email,
    name: userRow.name,
    isAdmin: userRow.isAdmin ?? false,
    createdAt: userRow.createdAt,
  }))

  return listResponse(items, { query, total: normalizeCount(totalResult?.count) })
})
