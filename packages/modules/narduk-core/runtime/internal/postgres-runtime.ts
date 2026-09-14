import { drizzle as drizzlePg } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

type QueryLogger =
  | {
      logQuery(query: string, params: unknown): void
    }
  | undefined

export function createPostgresDatabase<TSchema extends Record<string, unknown>>(
  connectionString: string,
  options: {
    logger?: QueryLogger
    schema: TSchema
  },
) {
  const client = postgres(connectionString, { prepare: false, max: 1 })
  return drizzlePg(client, options)
}
