import { desc, sql } from 'drizzle-orm'
import { createError, defineEventHandler, getValidatedQuery } from 'h3'
import { z } from 'zod'

import { users } from '#layer/orm-tables'
import { requireAdmin } from '#layer/server/utils/auth'
import { getDatabaseRow, getDatabaseRows, useDatabase } from '#layer/server/utils/database'

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
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

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const query = await getValidatedQuery(event, (data) => querySchema.safeParse(data))
  if (!query.success) {
    throw createError({ statusCode: 400, message: 'Invalid pagination parameters.' })
  }

  const { page, limit } = query.data
  const offset = (page - 1) * limit

  const db = useDatabase(event)

  const [totalResult, userRows] = await Promise.all([
    getDatabaseRow<CountRow>(db.select({ count: sql<CountRow['count']>`count(*)` }).from(users)),
    getDatabaseRows<typeof users.$inferSelect>(
      db.select().from(users).orderBy(desc(users.createdAt)).limit(limit).offset(offset),
    ),
  ])

  return {
    users: userRows.map((userRow) => ({
      id: userRow.id,
      email: userRow.email,
      name: userRow.name,
      isAdmin: userRow.isAdmin ?? false,
      createdAt: userRow.createdAt,
    })),
    page,
    limit,
    total: normalizeCount(totalResult?.count),
  }
})
