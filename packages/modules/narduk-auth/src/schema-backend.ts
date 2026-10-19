/**
 * narduk-core points `#narduk-core/schema` at `pg-schema.ts` for a Postgres app
 * and at the SQLite schema otherwise. The auth tables follow that choice, so
 * they can never disagree with the `users` table they reference.
 */
export function usesPostgresSchema(coreSchemaAlias: unknown): boolean {
  return typeof coreSchemaAlias === 'string' && /pg-schema\.ts$/u.test(coreSchemaAlias)
}
