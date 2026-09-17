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

/** Does this statement change rows, so `changes()`/`last_insert_rowid()` mean something? */
function isMutatingStatement(sql: string): boolean {
  return /^(?:INSERT|UPDATE|DELETE|REPLACE)\b/i.test(sql.trim())
}

/**
 * Strip string literals, quoted identifiers and comments so a `?` inside one
 * of them is never mistaken for a parameter placeholder.
 */
function stripNonCode(sql: string): string {
  return sql
    .replaceAll(/'(?:[^']|'')*'/g, "''")
    .replaceAll(/"(?:[^"]|"")*"/g, '""')
    .replaceAll(/`(?:[^`]|``)*`/g, '``')
    .replaceAll(/\[[^\]]*\]/g, '[]')
    .replaceAll(/--[^\n]*/g, '')
    .replaceAll(/\/\*[\s\S]*?\*\//g, '')
}

/**
 * D1 rejects a `bind()` whose value count does not match the statement's
 * placeholder count — including the "too few" case, where SQLite on its own
 * would happily bind NULL and return a confidently wrong row. Counting the
 * anonymous `?` placeholders reproduces that check.
 *
 * Only anonymous placeholders are counted. A statement using named parameters
 * (`:name`, `@name`, `$name`) or numbered ones (`?1`) is left to the SQLite
 * driver, matching D1, which accepts a positional `bind()` against a named
 * statement without complaint.
 */
function assertBindArity(sql: string, params: unknown[]): void {
  const code = stripNonCode(sql)
  if (/[:@$][a-z_]/i.test(code) || /\?\d/.test(code)) return

  const expected = (code.match(/\?/g) ?? []).length
  if (params.length !== expected) {
    throw new Error('D1_ERROR: Wrong number of parameter bindings for SQL query.')
  }
}

/**
 * D1 hands a BLOB column back as a plain array of byte values, not a
 * `Uint8Array` — a difference a handler notices the moment it calls
 * `Array.isArray`, spreads the value, or JSON-serializes it. `node:sqlite`
 * returns a `Uint8Array`, so convert on the way out.
 */
function toD1Value(value: unknown): unknown {
  return value instanceof Uint8Array ? [...value] : value
}

function toD1Row<T>(row: Record<string, unknown>): T {
  const converted: Record<string, unknown> = {}
  for (const [column, value] of Object.entries(row)) converted[column] = toD1Value(value)
  return converted as T
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
    assertBindArity(this.#sql, this.#params)
    const statement = this.#database.prepare(this.#sql)
    const row = statement.get(...(this.#params as never[])) as Record<string, unknown> | undefined
    if (!row) return null
    if (colName !== undefined) {
      // A column the result set does not have is a D1 error, not `null`.
      // Returning `null` would let a typo'd column name pass every test and
      // fail only in production. (No row at all still resolves `null` —
      // that is D1's behaviour too.)
      if (!Object.hasOwn(row, colName)) {
        throw new Error(`D1_COLUMN_NOTFOUND: Column not found (${colName})`)
      }
      return toD1Value(row[colName]) as T
    }
    return toD1Row<T>(row)
  }

  /**
   * D1's `all()` and `run()` return the identical `D1Result` shape — both
   * carry `results` — so both go through here. A row-returning statement
   * yields its rows from either method; anything else yields `[]` plus the
   * write metadata.
   */
  #execute<T>(): D1Result<T> {
    assertBindArity(this.#sql, this.#params)
    const start = performance.now()
    const statement = this.#database.prepare(this.#sql)

    if (isRowReturningStatement(this.#sql)) {
      const rows = (
        statement.all(...(this.#params as never[])) as Array<Record<string, unknown>>
      ).map((row) => toD1Row<T>(row))
      // A bare SELECT reports no writes. An `INSERT ... RETURNING` does, so
      // its counters come from SQLite after the statement ran.
      const wrote = isMutatingStatement(this.#sql)
      const changes = wrote ? this.#changes() : 0
      return {
        meta: buildMeta({
          changed_db: changes > 0,
          changes,
          duration: performance.now() - start,
          last_row_id: wrote ? this.#lastRowId() : 0,
          rows_read: rows.length,
          rows_written: changes,
        }),
        results: rows,
        success: true,
      }
    }

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

  #changes(): number {
    const row = this.#database.prepare('SELECT changes() AS c').get() as { c: number } | undefined
    return Number(row?.c ?? 0)
  }

  #lastRowId(): number {
    const row = this.#database.prepare('SELECT last_insert_rowid() AS r').get() as
      { r: number } | undefined
    return Number(row?.r ?? 0)
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return this.#execute<T>()
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return this.#execute<T>()
  }

  raw<T = unknown[]>(options: { columnNames: true }): Promise<[string[], ...T[]]>
  raw<T = unknown[]>(options?: { columnNames?: false }): Promise<T[]>
  async raw<T>(options?: { columnNames?: boolean }): Promise<T[] | [string[], ...T[]]> {
    assertBindArity(this.#sql, this.#params)
    const statement = this.#database.prepare(this.#sql)
    const columns = statement.columns().map((column) => String(column.name))
    statement.setReturnArrays(true)
    // `setReturnArrays(true)` makes `all()` yield positional arrays, which the
    // node:sqlite typings still describe as row objects.
    const rows = (statement.all(...(this.#params as never[])) as unknown as unknown[][]).map(
      (row) => row.map((value) => toD1Value(value)),
    ) as T[]
    return options?.columnNames ? [columns, ...rows] : rows
  }

  /** The execution `batch()` runs per statement. Identical to `run()`/`all()`. */
  async executeForBatch<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return this.#execute<T>()
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

  /**
   * D1 counts `exec()` statements by **line**, not by semicolon: three
   * statements on one line all execute but report `count: 1`. Splitting on
   * `;` here would report 3 and quietly disagree with production.
   */
  async exec(query: string): Promise<D1ExecResult> {
    const start = performance.now()
    const count = query.split('\n').filter((line) => line.trim().length > 0).length
    this.#database.exec(query)
    return { count, duration: performance.now() - start }
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
 * Where SQLite alone would be more forgiving than D1, this fake enforces D1's
 * rule instead: a `bind()` with the wrong number of values is an error rather
 * than a silent NULL bind, `first(column)` on a column the result set lacks
 * throws `D1_COLUMN_NOTFOUND`, BLOB columns come back as D1's plain byte
 * arrays rather than `Uint8Array`, and `exec()` counts statements by line the
 * way D1 does.
 *
 * Not emulated: D1's real read-replica sessions (`withSession`, unsupported
 * here), its network latency and multi-region consistency, and the
 * deprecated `dump()` API.
 */
export function createFakeD1Database(options: CreateFakeD1Options = {}): D1Database {
  const database = options.database ?? new DatabaseSync(':memory:')
  return new FakeD1Database(database)
}
