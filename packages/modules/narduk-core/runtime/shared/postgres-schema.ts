/**
 * The PostgreSQL schema narduk-core and narduk-auth keep their tables in
 * (narduk-libs#1953).
 *
 * `public` is the default and means exactly what it always did: the Drizzle
 * tables are plain `pgTable`s and the shipped `drizzle-pg/*.sql` files are
 * applied on the connection's own `search_path`. A named schema puts every core
 * and auth table (`users`, `sessions`, `api_keys`, `auth_*`, ...) in that
 * schema instead, for an app that already owns same-named tables in `public`:
 *
 * ```ts
 * nardukCore: { databaseBackend: 'postgres', postgresSchema: 'narduk' }
 * ```
 *
 * Apply the DDL with the same name (`applyMigrations(..., { schema: 'narduk' })`
 * from `@narduk-enterprises/narduk-postgres/migrate`), so the files run with
 * `search_path` set to it.
 *
 * Dependency-free: the module validates at build time and the migration
 * scripts of an app can import the same check.
 */

export const DEFAULT_POSTGRES_SCHEMA = 'public'

const SCHEMA_NAME_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/u

/** Why `value` is not a usable schema name, or `null` when it is. */
export function postgresSchemaNameError(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return 'must be a non-empty string'
  if (!SCHEMA_NAME_PATTERN.test(value)) {
    return 'must be lower_snake_case (letters, digits and underscores, not starting with a digit), at most 63 characters, with no quoting or qualifier'
  }
  if (value.startsWith('pg_')) return 'must not start with "pg_", which Postgres reserves'
  return null
}

/** The validated schema name; `undefined` resolves to `public`. */
export function resolvePostgresSchema(value: unknown): string {
  if (value === undefined) return DEFAULT_POSTGRES_SCHEMA
  const error = postgresSchemaNameError(value)
  if (error) {
    throw new Error(
      `[narduk-core] nardukCore.postgresSchema ${error}; received ${JSON.stringify(value)}.`,
    )
  }
  return value as string
}
