/// <reference types="@cloudflare/workers-types" />
import { DatabaseSync } from 'node:sqlite'

/**
 * Options for {@link createFakeD1Database}.
 */
export interface CreateFakeD1Options {
  /**
   * An existing `node:sqlite` database to back the fake, so a test can
   * inspect it directly or share schema setup across fakes. Defaults to a
   * fresh `:memory:` database.
   */
  database?: DatabaseSync
}

function isRowReturningStatement(sql: string): boolean {
  const normalized = sql.trim().toUpperCase()
  return (
    normalized.startsWith('SELECT') ||
    normalized.startsWith('WITH') ||
    normalized.startsWith('PRAGMA') ||
    /\bRETURNING\b/.test(normalized)
  )
}

function buildMeta(overrides: Partial<D1Meta>): D1Meta & Record<string, unknown> {
  return {
    changed_db: false,
    changes: 0,
    duration: 0,
    last_row_id: 0,
    rows_read: 0,
    rows_written: 0,
    size_after: 0,
    ...overrides,
  }
}

class FakeD1PreparedStatement implements D1PreparedStatement {
  readonly #database: DatabaseSync
  readonly #params: unknown[]
  readonly #sql: string

  constructor(database: DatabaseSync, sql: string, params: unknown[] = []) {
    this.#database = database
    this.#sql = sql
    this.#params = params
  }

  bind(...values: unknown[]): D1PreparedStatement {
    return new FakeD1PreparedStatement(this.#database, this.#sql, values)
  }

  first<T = unknown>(colName: string): Promise<T | null>
  first<T = Record<string, unknown>>(): Promise<T | null>
  async first<T>(colName?: string): Promise<T | null> {
    const statement = this.#database.prepare(this.#sql)
    const row = statement.get(...(this.#params as never[])) as Record<string, unknown> | undefined
    if (!row) return null
    if (colName !== undefined) return (row[colName] ?? null) as T
    return row as T
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const start = performance.now()
    const statement = this.#database.prepare(this.#sql)
    const rows = statement.all(...(this.#params as never[])) as T[]
    return {
      meta: buildMeta({ duration: performance.now() - start, rows_read: rows.length }),
      results: rows,
      success: true,
    }
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const start = performance.now()
    const statement = this.#database.prepare(this.#sql)
    const info = statement.run(...(this.#params as never[]))
    const changes = Number(info.changes)
    return {
      meta: buildMeta({
        changed_db: changes > 0,
        changes,
        duration: performance.now() - start,
        last_row_id: Number(info.lastInsertRowid),
        rows_written: changes,
      }),
      results: [] as T[],
      success: true,
    }
  }

  raw<T = unknown[]>(options: { columnNames: true }): Promise<[string[], ...T[]]>
  raw<T = unknown[]>(options?: { columnNames?: false }): Promise<T[]>
  async raw<T>(options?: { columnNames?: boolean }): Promise<T[] | [string[], ...T[]]> {
    const statement = this.#database.prepare(this.#sql)
    const columns = statement.columns().map((column) => String(column.name))
    statement.setReturnArrays(true)
    const rows = statement.all(...(this.#params as never[])) as T[]
    return options?.columnNames ? [columns, ...rows] : rows
  }

  /**
   * The execution `batch()` runs per statement: real D1 batches don't
   * distinguish "the caller meant `.run()`" from "the caller meant `.all()`"
   * the way this fake's own `run`/`all` do, so this picks based on the SQL
   * shape (a `SELECT`/`WITH`/`PRAGMA`/`RETURNING` statement gets its rows
   * back; anything else gets `run()`-shaped metadata only).
   */
  async executeForBatch<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return isRowReturningStatement(this.#sql) ? this.all<T>() : this.run<T>()
  }
}

class FakeD1Database implements D1Database {
  readonly #database: DatabaseSync

  constructor(database: DatabaseSync) {
    this.#database = database
  }

  async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<Array<D1Result<T>>> {
    for (const statement of statements) {
      if (!(statement instanceof FakeD1PreparedStatement)) {
        throw new TypeError(
          'createFakeD1Database: batch() only accepts statements created by this fake’s own prepare().',
        )
      }
    }
    const fakeStatements = statements as FakeD1PreparedStatement[]

    // D1 batches are transactions: either every statement lands or none do.
    // A real sqlite BEGIN/COMMIT/ROLLBACK proves that guarantee here, rather
    // than merely promising it.
    this.#database.exec('BEGIN')
    try {
      const results: Array<D1Result<T>> = []
      for (const statement of fakeStatements) {
        results.push(await statement.executeForBatch<T>())
      }
      this.#database.exec('COMMIT')
      return results
    } catch (error) {
      this.#database.exec('ROLLBACK')
      throw error
    }
  }

  async dump(): Promise<ArrayBuffer> {
    throw new Error(
      'createFakeD1Database: dump() is not supported by this fake (deprecated D1 v1 API, out of scope for route-handler unit tests).',
    )
  }

  async exec(query: string): Promise<D1ExecResult> {
    const start = performance.now()
    const statementCount = query
      .split(';')
      .map((statement) => statement.trim())
      .filter(Boolean).length
    this.#database.exec(query)
    return { count: statementCount, duration: performance.now() - start }
  }

  prepare(query: string): D1PreparedStatement {
    return new FakeD1PreparedStatement(this.#database, query)
  }

  withSession(): D1DatabaseSession {
    throw new Error(
      'createFakeD1Database: withSession() is not supported by this fake — D1 sessions/read replicas are out of scope for unit-testing route handlers.',
    )
  }
}

/**
 * A `D1Database` fake backed by a real SQLite engine (`node:sqlite`, no new
 * dependency), so SQL is actually executed rather than stubbed with canned
 * responses. Implements the shape route handlers actually call:
 * `prepare().bind().first()/all()/run()/raw()`, `batch()`, and `exec()`.
 *
 * `batch()` runs its statements inside a real transaction, so a failure
 * partway through rolls back every statement in the batch — the same
 * all-or-nothing guarantee D1 documents for its own batches.
 *
 * Not emulated: D1's real read-replica sessions (`withSession`, unsupported
 * here), its network latency and multi-region consistency, and the
 * deprecated `dump()` API.
 */
export function createFakeD1Database(options: CreateFakeD1Options = {}): D1Database {
  const database = options.database ?? new DatabaseSync(':memory:')
  return new FakeD1Database(database)
}
