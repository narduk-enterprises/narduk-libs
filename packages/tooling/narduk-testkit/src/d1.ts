/**
 * A real-D1 query harness for Vitest: Miniflare's D1 (the workerd SQLite the
 * platform runs), created from a package's own migration files, with every
 * statement the code under test prepares recorded.
 *
 * What it proves is query SHAPE — how many statements a route emits, whether
 * that count holds as data grows, which index SQLite picks, how many bytes the
 * response carries. It does NOT prove latency: Miniflare runs on the test
 * machine, with no network hop, no replica, and none of production's load, so
 * its timings mean nothing and nothing here measures them.
 *
 * `miniflare` is an optional peer dependency, loaded only when a harness is
 * created, so importing this module never requires it.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import type { Miniflare } from 'miniflare'

/** The D1 binding Miniflare hands out; `drizzle(harness.db)` accepts it as-is. */
export type D1Binding = Awaited<ReturnType<Miniflare['getD1Database']>>

export interface D1QueryHarnessOptions {
  /**
   * Migration files to apply, in order: either explicit `.sql` paths or one
   * directory, whose numbered files (`0000_initial.sql`, `0001.sql`, …) are
   * applied in lexical order — the same discovery `narduk-app db migrate`
   * uses, so utility SQL such as `seed.sql` is skipped.
   */
  migrations: string | readonly string[]
  /** Worker compatibility date for the Miniflare runtime. */
  compatibilityDate?: string
}

export interface D1QueryHarness {
  /**
   * The recording binding. Hand it to the code under test (`drizzle(db)`);
   * every `prepare()` and `exec()` on it is appended to `statements`.
   */
  db: D1Binding
  /** The same database, unrecorded — for seeding and for assertions of your own. */
  raw: D1Binding
  /** SQL text of every statement prepared on `db` since the last `reset()`. */
  statements: string[]
  /** Empty `statements` (in place, so held references see it). */
  reset: () => void
  /** Delete every row of every table the migrations created; the schema stays. */
  clearData: () => Promise<void>
  /** Shut the Miniflare runtime down. Call from `afterAll`. */
  dispose: () => Promise<void>
}

function migrationPaths(migrations: string | readonly string[]): string[] {
  if (typeof migrations !== 'string') return [...migrations]
  if (!statSync(migrations).isDirectory()) return [migrations]
  return readdirSync(migrations)
    .filter((entry) => /^\d/u.test(entry) && entry.endsWith('.sql'))
    .sort()
    .map((entry) => join(migrations, entry))
}

/**
 * Split a migration file into executable statements: comments stripped, split
 * on `;`. D1's `batch` needs one statement per `prepare`. This does not parse
 * SQL, so a statement with a `;` inside a string literal or a trigger body
 * (`BEGIN … END`) is not supported — pass such a file through `raw.exec`
 * yourself.
 */
export function splitSqlStatements(sql: string): string[] {
  return sql
    .replaceAll(/\/\*[\s\S]*?\*\//gu, '')
    .replaceAll(/--[^\n]*/gu, '')
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean)
}

function recordingBinding(binding: D1Binding, statements: string[]): D1Binding {
  return new Proxy(binding, {
    get(target, property) {
      if (property === 'prepare') {
        return (sql: string) => {
          statements.push(sql)
          return target.prepare(sql)
        }
      }
      if (property === 'exec') {
        return (sql: string) => {
          statements.push(sql)
          return target.exec(sql)
        }
      }
      const value = Reflect.get(target, property, target) as unknown
      return typeof value === 'function' ? (value as () => unknown).bind(target) : value
    },
  })
}

/** Create a Miniflare D1 database from migrations and wrap it in a statement recorder. */
export async function createD1QueryHarness(
  options: D1QueryHarnessOptions,
): Promise<D1QueryHarness> {
  const { Miniflare } = await import('miniflare').catch((error: unknown) => {
    throw new Error(
      'narduk-testkit/d1 needs the optional peer dependency `miniflare`. Add it to devDependencies.',
      { cause: error },
    )
  })
  const runtime = new Miniflare({
    compatibilityDate: options.compatibilityDate ?? '2026-07-01',
    d1Databases: ['DB'],
    modules: true,
    script: 'export default { fetch() { return new Response("narduk-testkit d1") } }',
  })

  try {
    const raw = await runtime.getD1Database('DB')
    for (const path of migrationPaths(options.migrations)) {
      const statements = splitSqlStatements(readFileSync(path, 'utf8'))
      if (statements.length === 0) continue
      await raw.batch(statements.map((statement) => raw.prepare(statement)))
    }

    const statements: string[] = []
    return {
      db: recordingBinding(raw, statements),
      raw,
      statements,
      reset: () => {
        statements.length = 0
      },
      clearData: async () => {
        const tables = await raw
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%'",
          )
          .all<{ name: string }>()
        if (tables.results.length === 0) return
        // Deferred foreign keys let the deletes run in any order inside the
        // one transaction a batch is.
        await raw.batch([
          raw.prepare('PRAGMA defer_foreign_keys = ON'),
          ...tables.results.map(({ name }) => raw.prepare(`DELETE FROM "${name}"`)),
        ])
      },
      dispose: () => runtime.dispose(),
    }
  } catch (error) {
    await runtime.dispose()
    throw error
  }
}

export interface StatementBudgetResult<T> {
  result: T
  statements: string[]
}

/**
 * Run `fn` and fail if it prepared more than `max` statements on `harness.db`.
 * Resets the recorder first; returns what `fn` returned and the statements.
 */
export async function expectStatementBudget<T>(
  harness: D1QueryHarness,
  fn: () => T | Promise<T>,
  budget: { max: number },
): Promise<StatementBudgetResult<T>> {
  harness.reset()
  const result = await fn()
  const statements = [...harness.statements]
  if (statements.length > budget.max) {
    throw new Error(
      `Statement budget exceeded: ${statements.length} statements, max ${budget.max}.\n${statements
        .map((sql, index) => `  ${index + 1}. ${sql}`)
        .join('\n')}`,
    )
  }
  return { result, statements }
}

/**
 * Run `EXPLAIN QUERY PLAN` for `sql` and fail if SQLite scans any table in
 * `forbidFullScanOf` — a `SCAN <table>` step (including `SCAN <table> USING
 * COVERING INDEX`, which still reads every entry) rather than a `SEARCH <table>
 * USING INDEX`. Returns the plan's `detail` lines. Tables are matched by the
 * name the plan prints, which is the alias when the query aliases one.
 */
export async function expectQueryPlan(
  harness: D1QueryHarness,
  sql: string,
  params: readonly unknown[],
  options: { forbidFullScanOf: readonly string[] },
): Promise<string[]> {
  const plan = await harness.raw
    .prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .bind(...params)
    .all<{ detail: string }>()
  const details = plan.results.map((row) => row.detail)
  const forbidden = new Set(options.forbidFullScanOf)
  const scans = details.filter((detail) => {
    const match = /^SCAN (?:TABLE )?(\S+)/u.exec(detail)
    return match !== null && forbidden.has(match[1] ?? '')
  })
  if (scans.length > 0) {
    throw new Error(
      `Query plan scans ${scans.join('; ')}.\nSQL: ${sql}\nPlan:\n${details.map((detail) => `  ${detail}`).join('\n')}`,
    )
  }
  return details
}

export interface ScaleAxes {
  /** Retained rows the query should NOT have to touch (old history). */
  history: readonly number[]
  /** Rows in the live working set the query does return. */
  live: readonly number[]
}

export interface ScaleCell<T> {
  history: number
  live: number
  /** Statements `run()` prepared on `harness.db` for this cell. */
  statements: number
  /** UTF-8 bytes of the result: a string or bytes as-is, anything else as JSON. */
  bytes: number
  result: T
}

function byteLength(value: unknown): number {
  if (typeof value === 'string') return Buffer.byteLength(value, 'utf8')
  if (value instanceof Uint8Array) return value.byteLength
  if (value instanceof ArrayBuffer) return value.byteLength
  return Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8')
}

/**
 * Run `run()` once per (history, live) cell and fail unless every cell
 * prepared the same number of statements — the count must not grow with
 * either axis, which is what "no per-item query" means.
 *
 * Before each cell the harness's rows are cleared and `seed(cell)` fills the
 * database (use `harness.raw`, which is not recorded). The returned cells carry
 * each result and its byte size, so a test can assert result parity across
 * `history` and a response-bytes ceiling.
 *
 * This proves query shape only. Miniflare timings are not production latency,
 * so no cell is timed.
 */
export async function scaleMatrix<T>(
  harness: D1QueryHarness,
  options: {
    axes: ScaleAxes
    seed: (cell: { history: number; live: number }) => void | Promise<void>
    run: () => T | Promise<T>
  },
): Promise<Array<ScaleCell<T>>> {
  const cells: Array<ScaleCell<T>> = []
  for (const history of options.axes.history) {
    for (const live of options.axes.live) {
      await harness.clearData()
      await options.seed({ history, live })
      harness.reset()
      const result = await options.run()
      cells.push({
        history,
        live,
        statements: harness.statements.length,
        bytes: byteLength(result),
        result,
      })
    }
  }
  const counts = new Set(cells.map((cell) => cell.statements))
  if (counts.size > 1) {
    throw new Error(
      `Statement count varies across the scale matrix:\n${cells
        .map((cell) => `  history=${cell.history} live=${cell.live}: ${cell.statements} statements`)
        .join('\n')}`,
    )
  }
  return cells
}
