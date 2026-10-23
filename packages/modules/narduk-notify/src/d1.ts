/**
 * The slice of Cloudflare's D1 binding this package uses, so it needs no
 * `@cloudflare/workers-types` dependency. A real `D1Database` satisfies it.
 * Method syntax on purpose: it keeps the binding's own statement type
 * assignable to `batch`'s parameter.
 */
export interface NotifyD1Statement {
  all(): Promise<{ results: unknown[] }>
  bind(...values: unknown[]): NotifyD1Statement
  run(): Promise<{ meta?: { changes?: number } }>
}

export interface NotifyD1Database {
  batch(statements: NotifyD1Statement[]): Promise<unknown[]>
  prepare(sql: string): NotifyD1Statement
}
