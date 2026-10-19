/**
 * The table factory every narduk-core and narduk-auth Postgres table is built
 * with (narduk-libs#1953).
 *
 * With the default schema this is Drizzle's own `pgTable`, so a `public` app
 * sees no difference. With `nardukCore.postgresSchema` set, it is
 * `pgSchema(name).table`: queries are emitted as `"narduk"."users"`, never as a
 * bare `users` that the connection's `search_path` could resolve to an
 * app-owned table of the same name.
 */
import { pgSchema, pgTable } from 'drizzle-orm/pg-core'

import { postgresSchema } from '#narduk-core/postgres-schema'

/** The schema the tables are created in; `public` unless the app configured one. */
export const nardukPostgresSchema: string = postgresSchema

export const nardukPgTable: typeof pgTable =
  postgresSchema === 'public'
    ? pgTable
    : (pgSchema(postgresSchema).table as unknown as typeof pgTable)
