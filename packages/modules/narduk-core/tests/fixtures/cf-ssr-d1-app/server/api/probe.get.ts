import { sql } from 'drizzle-orm'

/** One D1 read, so a missing binding is a 500 rather than a silent default. */
export default defineEventHandler(async (event) => {
  const row = await useDatabase(event).get<{ value: string }>(
    sql`SELECT value FROM probe WHERE id = 1`,
  )
  return { value: row?.value ?? null }
})
