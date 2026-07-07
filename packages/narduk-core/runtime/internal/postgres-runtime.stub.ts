export function createPostgresDatabase<TSchema extends Record<string, unknown>>(
  _connectionString: string,
  _options: {
    logger?: {
      logQuery(query: string, params: unknown): void
    }
    schema: TSchema
  },
): never {
  throw new Error(
    'Postgres runtime was requested from a D1 build. Rebuild with NUXT_DATABASE_BACKEND=postgres.',
  )
}
