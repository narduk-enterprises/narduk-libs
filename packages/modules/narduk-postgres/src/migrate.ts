/**
 * An immutable-file migrations runner.
 *
 * The rule this enforces is the one mybo-at-v2 learned the expensive way on D1:
 * **an applied migration file is frozen**. Editing one that a database has
 * already run leaves every deployed environment on the old bytes with no record
 * that they diverged, and the next fresh environment on the new bytes -- two
 * schemas, one file name, no error anywhere (mybo-at-v2#81/#82). The checksum
 * column below is what turns that into a failed deploy instead of a silent
 * fork.
 *
 * Three other rules follow from the same place:
 *
 *  - **Missing is an error too.** An applied name with no file on disk means
 *    the deploy artifact is not the one that built this database.
 *  - **Out-of-order is an error.** A new file that sorts *before* the highest
 *    applied name is a merge artifact: it will run after migrations that were
 *    written assuming it had not.
 *  - **One writer at a time.** Two deploy jobs, or a Worker and a cron, racing
 *    `CREATE TABLE` is a coin flip. A session-level advisory lock serializes
 *    them; the loser waits, and gives up with a named error rather than
 *    proceeding.
 *
 * The runner is runtime-agnostic: checksums use Web Crypto, which Node >= 22 and
 * workerd both provide. Reading files from disk lives in `./node`, so importing
 * this module into a Worker pulls in no filesystem.
 *
 * **The executor must be a single connection, not a pool.** `pg_advisory_lock`
 * is session-scoped: acquired on one pooled connection and released on another,
 * it protects nothing and the unlock fails. `createNodeMigrationConnection` in
 * `./node` exists to make that the easy path -- it pins `maxConnections` to 1.
 */

import { NardukPostgresError } from './errors.js'
import { isTransactionalExecutor, type SqlExecutor } from './types.js'

export const MIGRATIONS_TABLE = 'schema_migrations'
export const MIGRATION_LOCK_NAMESPACE = 'narduk-postgres:migrations'
export const MIGRATION_NAME_PATTERN = /^\d{4}_[a-z0-9]+(?:_[a-z0-9]+)*\.sql$/u

/**
 * A migration whose DDL cannot run inside a transaction says so on its first
 * line. `CREATE MATERIALIZED VIEW ... WITH (timescaledb.continuous)` and
 * `CREATE INDEX CONCURRENTLY` are the two that matter here; both error out with
 * "cannot run inside a transaction block" and would otherwise look like a bug
 * in this runner.
 */
export const NO_TRANSACTION_DIRECTIVE = '-- narduk:no-transaction'

export interface MigrationSource {
  name: string
  sql: string
}

export interface Migration extends MigrationSource {
  checksum: string
  transactional: boolean
}

export interface AppliedMigration {
  appliedAt: Date | null
  checksum: string
  name: string
}

export interface MigrationPlan {
  applied: AppliedMigration[]
  pending: Migration[]
  tableExists: boolean
}

export interface ApplyMigrationsOptions {
  /** Report the plan and change nothing. Takes no lock and creates no table. */
  dryRun?: boolean
  lockNamespace?: string
  lockRetryDelayMs?: number
  lockTimeoutMs?: number
  now?: () => Date
  sleep?: (milliseconds: number) => Promise<void>
  /**
   * The ledger table, default `schema_migrations`.
   *
   * One table belongs to one migration set: the runner treats an applied name
   * with no file as a deploy-artifact mismatch, so two sets sharing a table
   * would each see the other's rows as missing files. Give a second set its own
   * table name (and its own `lockNamespace`) instead.
   */
  table?: string
}

export interface ApplyMigrationsResult {
  applied: string[]
  dryRun: boolean
  durationMsByName: Record<string, number>
  plan: MigrationPlan
  skipped: string[]
}

const textEncoder = new TextEncoder()

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * The directive is read from the FIRST LINE only.
 *
 * A substring search anywhere in the file would let a comment three hundred
 * lines down -- or a migration that *documents* the directive, as
 * narduk-timeseries's README-adjacent SQL does -- silently change how the whole
 * file is executed. The first line is a place an author has to mean.
 */
export function parseMigrationDirectives(sql: string): { transactional: boolean } {
  const breakAt = sql.indexOf('\n')
  const firstLine = (breakAt === -1 ? sql : sql.slice(0, breakAt)).trim()
  return { transactional: firstLine !== NO_TRANSACTION_DIRECTIVE }
}

/**
 * Split SQL into top-level statements, aware of everything that can contain a
 * bare semicolon: line comments, block comments (which nest in Postgres),
 * single-quoted literals, quoted identifiers, and dollar-quoted bodies.
 *
 * This exists because a **non-transactional migration cannot be sent as one
 * multi-statement string**. libpq's simple query protocol wraps a multi-command
 * string in an implicit transaction, so `CREATE MATERIALIZED VIEW ... WITH
 * (timescaledb.continuous)` in a file the runner has been told not to wrap
 * still fails with "cannot create continuous aggregate in a transaction block".
 * The fix is one statement per round trip, which is what `applyMigrations` does
 * for a `transactional: false` file.
 *
 * Dollar quoting is not optional to handle: `0003_history_roles.sql`-style
 * files use `DO $$ ... END $$;`, whose body is full of semicolons.
 */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = []
  let start = 0
  let index = 0
  let blockCommentDepth = 0

  const push = (endExclusive: number): void => {
    const candidate = sql.slice(start, endExclusive)
    if (stripSqlComments(candidate).trim().length > 0) statements.push(candidate.trim())
    start = endExclusive + 1
  }

  while (index < sql.length) {
    const two = sql.slice(index, index + 2)

    if (blockCommentDepth > 0) {
      if (two === '/*') {
        blockCommentDepth += 1
        index += 2
        continue
      }
      if (two === '*/') {
        blockCommentDepth -= 1
        index += 2
        continue
      }
      index += 1
      continue
    }

    if (two === '--') {
      const newline = sql.indexOf('\n', index)
      index = newline === -1 ? sql.length : newline + 1
      continue
    }
    if (two === '/*') {
      blockCommentDepth = 1
      index += 2
      continue
    }

    const character = sql[index]

    if (character === "'" || character === '"') {
      // `E'...'` (or `e'...'`) turns on backslash escaping, so `E'it\\'s'` is one
      // literal, not a literal followed by a stray `s'`. The `E` counts only
      // when it is its own token, never as the tail of an identifier.
      const previous = index > 0 ? (sql[index - 1] ?? '') : ''
      const beforePrevious = index > 1 ? (sql[index - 2] ?? '') : ''
      const escapeBackslash =
        character === "'" &&
        (previous === 'E' || previous === 'e') &&
        !/[\w$]/u.test(beforePrevious)
      index = skipQuoted(sql, index, character, escapeBackslash)
      continue
    }

    if (character === '$') {
      const tag = dollarTagAt(sql, index)
      if (tag !== null) {
        const closing = sql.indexOf(tag, index + tag.length)
        if (closing === -1) {
          throw new NardukPostgresError(
            'MIGRATION_STATEMENT_UNTERMINATED',
            `A dollar-quoted body opened with ${tag} is never closed.`,
            { tag },
          )
        }
        index = closing + tag.length
        continue
      }
    }

    if (character === ';') {
      push(index)
      index += 1
      continue
    }

    index += 1
  }

  if (blockCommentDepth > 0) {
    throw new NardukPostgresError(
      'MIGRATION_STATEMENT_UNTERMINATED',
      'A block comment is never closed.',
    )
  }
  push(sql.length)
  return statements
}

/**
 * Skip a `'...'` literal or a `"..."` identifier, doubling as its own escape.
 *
 * `escapeBackslash` is true only for an E-string (`E'...'`), where a backslash
 * escapes the next character. In a standard literal a backslash is an ordinary
 * character -- `standard_conforming_strings` has been on by default since 9.1 --
 * so treating it as an escape everywhere would mis-parse `'C:\\'`.
 */
function skipQuoted(
  sql: string,
  openIndex: number,
  quote: string,
  escapeBackslash = false,
): number {
  let index = openIndex + 1
  while (index < sql.length) {
    if (escapeBackslash && sql[index] === '\\') {
      index += 2
      continue
    }
    if (sql[index] === quote) {
      if (sql[index + 1] === quote) {
        index += 2
        continue
      }
      return index + 1
    }
    index += 1
  }
  throw new NardukPostgresError(
    'MIGRATION_STATEMENT_UNTERMINATED',
    `A ${quote === "'" ? 'string literal' : 'quoted identifier'} is never closed.`,
    { openIndex },
  )
}

/**
 * `$$` or `$tag$` at this position, or null when the `$` is something else.
 *
 * A tag follows identifier rules: it may not START with a digit, but it may
 * contain them. The previous pattern excluded every digit, so `$func1$` was not
 * recognized as an opener and the splitter cut the function body at its first
 * internal semicolon -- producing two fragments that are each a syntax error.
 */
function dollarTagAt(sql: string, index: number): string | null {
  const match = /^\$(?:[A-Za-z_]\w*)?\$/u.exec(sql.slice(index))
  return match === null ? null : match[0]
}

function stripSqlComments(sql: string): string {
  return sql.replaceAll(/--[^\n]*/gu, ' ').replaceAll(/\/\*[\s\S]*?\*\//gu, ' ')
}

const TRANSACTION_FORBIDDEN_PATTERNS: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  {
    label: 'CREATE INDEX CONCURRENTLY',
    pattern: /^CREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY\b/iu,
  },
  {
    label: 'DROP INDEX CONCURRENTLY',
    pattern: /^DROP\s+INDEX\s+CONCURRENTLY\b/iu,
  },
  { label: 'REINDEX ... CONCURRENTLY', pattern: /^REINDEX\b[\s\S]+\bCONCURRENTLY\b/iu },
  { label: 'VACUUM', pattern: /^VACUUM\b/iu },
]

// `ALTER TYPE ... ADD VALUE` is deliberately absent: Postgres 12 and later
// allow it inside a transaction block (only *using* the new value in the same
// transaction is barred), and 11 is long out of support. Rejecting it would
// fail a consumer's working migration on a patch release.

// This list is the common set, not a proof of completeness. `CREATE DATABASE`,
// `ALTER SYSTEM`, and a TimescaleDB continuous aggregate are also
// non-transactional and are not detected; they fail with the raw Postgres
// error instead of the named one. See the changeset's operator note.

/**
 * Statements Postgres rejects inside a transaction. Default-transactional
 * files now wrap in BEGIN/COMMIT, so these must fail closed with the
 * opt-out directive rather than being auto-run outside a transaction.
 */
function findTransactionForbiddenStatement(sql: string): string | null {
  for (const statement of splitSqlStatements(sql)) {
    const stripped = stripSqlComments(statement).replaceAll(/\s+/gu, ' ').trim()
    for (const { label, pattern } of TRANSACTION_FORBIDDEN_PATTERNS) {
      if (pattern.test(stripped)) return label
    }
  }
  return null
}

function assertTransactionalMigration(migration: Migration): void {
  const forbidden = findTransactionForbiddenStatement(migration.sql)
  if (forbidden === null) return
  throw new NardukPostgresError(
    'MIGRATION_TRANSACTION_FORBIDDEN',
    `${migration.name} contains ${forbidden}, which cannot run inside a transaction. Put "${NO_TRANSACTION_DIRECTIVE}" on the first line to opt this file out. The runner will not silently run it non-transactionally.`,
    { name: migration.name, statement: forbidden },
  )
}

function assertMigrationsTable(table: string): string {
  if (!/^[a-z_][a-z0-9_]*$/u.test(table)) {
    throw new NardukPostgresError(
      'MIGRATION_TABLE_INVALID',
      'A migrations table name must be lower_snake_case with no schema qualifier or quoting.',
      { table },
    )
  }
  return table
}

export async function createMigration(source: MigrationSource): Promise<Migration> {
  if (!MIGRATION_NAME_PATTERN.test(source.name)) {
    throw new NardukPostgresError(
      'MIGRATION_NAME_INVALID',
      'A migration file must be named NNNN_lower_snake_case.sql (for example 0001_history_core.sql).',
      { name: source.name },
    )
  }
  return {
    checksum: await sha256Hex(source.sql),
    name: source.name,
    sql: source.sql,
    ...parseMigrationDirectives(source.sql),
  }
}

/**
 * Order the set once, here, so every later comparison is a plain string compare
 * on a zero-padded prefix. Duplicate names are rejected rather than deduped: two
 * files claiming `0003_` is a merge that needs a human.
 */
export async function createMigrationSet(
  sources: readonly MigrationSource[],
): Promise<Migration[]> {
  const migrations = await Promise.all(sources.map((source) => createMigration(source)))
  const seen = new Set<string>()
  for (const migration of migrations) {
    if (seen.has(migration.name)) {
      throw new NardukPostgresError(
        'MIGRATION_DUPLICATE',
        'Two migration sources share one name.',
        { name: migration.name },
      )
    }
    seen.add(migration.name)
  }
  // Code-unit order, the same `<`/`>` `assertOrder` compares with and the
  // "lexical order" the README promises. `localeCompare` is ICU collation, which
  // sorts `0002_users_email_idx.sql` before `0002_users.sql` (narduk-libs#943).
  return migrations.sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
  )
}

/**
 * A deterministic 32-bit pair for `pg_try_advisory_lock(int, int)`.
 *
 * The two-integer form is used rather than the bigint one because it is exactly
 * as unique for a namespaced constant and avoids handing a `bigint` through a
 * driver's parameter encoder, where the Number/BigInt boundary is one more
 * thing to get wrong. This is a lock key, not a security boundary, so a small
 * synchronous hash is the right tool.
 */
export function migrationLockKey(namespace: string = MIGRATION_LOCK_NAMESPACE): [number, number] {
  let high = 0x81_23_45_67
  let low = 0x9a_bc_de_f1
  for (let index = 0; index < namespace.length; index += 1) {
    const code = namespace.charCodeAt(index)
    high = Math.imul(high ^ code, 0x01_00_01_93) >>> 0
    low = Math.imul(low ^ ((code << 5) | (code >>> 3)), 0x85_eb_ca_6b) >>> 0
  }
  // pg's arguments are signed 32-bit integers.
  return [high | 0, low | 0]
}

function assertImmutability(applied: AppliedMigration[], migrations: readonly Migration[]): void {
  const byName = new Map(migrations.map((migration) => [migration.name, migration]))
  for (const row of applied) {
    const migration = byName.get(row.name)
    if (!migration) {
      throw new NardukPostgresError(
        'MIGRATION_MISSING',
        `The database has applied ${row.name}, which is not in this migration set. The deployed artifact is not the one that built this database.`,
        { name: row.name },
      )
    }
    if (migration.checksum !== row.checksum) {
      throw new NardukPostgresError(
        'MIGRATION_MODIFIED',
        `${row.name} was edited after it was applied. An applied migration file is immutable: add a new migration instead.`,
        { appliedChecksum: row.checksum, fileChecksum: migration.checksum, name: row.name },
      )
    }
  }
}

function assertOrder(applied: AppliedMigration[], pending: readonly Migration[]): void {
  if (applied.length === 0) return
  const highestApplied = applied.reduce(
    (highest, row) => (row.name > highest ? row.name : highest),
    applied[0]?.name ?? '',
  )
  for (const migration of pending) {
    if (migration.name < highestApplied) {
      throw new NardukPostgresError(
        'MIGRATION_OUT_OF_ORDER',
        `${migration.name} sorts before the highest applied migration ${highestApplied}. Renumber it above the applied set.`,
        { highestApplied, name: migration.name },
      )
    }
  }
}

interface AppliedRow {
  applied_at: Date | string | null
  checksum: string
  name: string
}

async function migrationsTableExists(executor: SqlExecutor, table: string): Promise<boolean> {
  const result = await executor.query<{ exists: boolean }>(
    'SELECT to_regclass($1) IS NOT NULL AS exists',
    [table],
  )
  return result.rows[0]?.exists === true
}

async function readApplied(executor: SqlExecutor, table: string): Promise<AppliedMigration[]> {
  const result = await executor.query<AppliedRow>(
    `SELECT name, checksum, applied_at FROM ${table} ORDER BY name ASC`,
  )
  return result.rows.map((row) => ({
    appliedAt: row.applied_at === null ? null : new Date(row.applied_at),
    checksum: row.checksum,
    name: row.name,
  }))
}

/**
 * Read-only. Creates nothing, locks nothing, and is what `dryRun` returns -- so
 * a deploy job can print the plan from a reader connection.
 */
export async function planMigrations(
  executor: SqlExecutor,
  migrations: readonly Migration[],
  options: { table?: string } = {},
): Promise<MigrationPlan> {
  const table = assertMigrationsTable(options.table ?? MIGRATIONS_TABLE)
  const tableExists = await migrationsTableExists(executor, table)
  const applied = tableExists ? await readApplied(executor, table) : []
  assertImmutability(applied, migrations)

  const appliedNames = new Set(applied.map((row) => row.name))
  const pending = migrations.filter((migration) => !appliedNames.has(migration.name))
  assertOrder(applied, pending)

  return { applied, pending, tableExists }
}

export function createMigrationsTableSql(table: string = MIGRATIONS_TABLE): string {
  return `CREATE TABLE IF NOT EXISTS ${assertMigrationsTable(table)} (
  name TEXT PRIMARY KEY,
  checksum TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  duration_ms INTEGER NOT NULL DEFAULT 0
)`
}

export const CREATE_MIGRATIONS_TABLE_SQL = createMigrationsTableSql()

const defaultSleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds)
  })

async function acquireLock(
  executor: SqlExecutor,
  key: [number, number],
  timeoutMs: number,
  retryDelayMs: number,
  sleep: (milliseconds: number) => Promise<void>,
  now: () => Date,
): Promise<void> {
  const deadline = now().getTime() + timeoutMs
  for (;;) {
    const result = await executor.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock($1, $2) AS locked',
      [key[0], key[1]],
    )
    if (result.rows[0]?.locked === true) return
    if (now().getTime() + retryDelayMs > deadline) {
      throw new NardukPostgresError(
        'MIGRATION_LOCK_TIMEOUT',
        'Another migration run holds the advisory lock. No schema change was attempted.',
        { lockKey: key, timeoutMs },
      )
    }
    await sleep(retryDelayMs)
  }
}

/**
 * The package's own connections are a `SqlExecutor` plus `end()` -- they do
 * not implement `.transaction`. A file marked transactional (the default)
 * still has to run as one unit: wrap it ourselves rather than degrade to
 * autocommit. Files that cannot live in a transaction opt out with
 * `-- narduk:no-transaction` and never reach this helper.
 */
async function applyInOwnTransaction(
  executor: SqlExecutor,
  run: (target: SqlExecutor) => Promise<void>,
): Promise<void> {
  await executor.query('BEGIN')
  try {
    await run(executor)
    await executor.query('COMMIT')
  } catch (cause: unknown) {
    try {
      await executor.query('ROLLBACK')
    } catch {
      // The migration failure is the one the caller must see.
    }
    throw cause
  }
}

export async function applyMigrations(
  executor: SqlExecutor,
  migrations: readonly Migration[],
  options: ApplyMigrationsOptions = {},
): Promise<ApplyMigrationsResult> {
  const now = options.now ?? ((): Date => new Date())
  const table = assertMigrationsTable(options.table ?? MIGRATIONS_TABLE)

  if (options.dryRun === true) {
    const plan = await planMigrations(executor, migrations, { table })
    return {
      applied: [],
      dryRun: true,
      durationMsByName: {},
      plan,
      skipped: plan.pending.map((migration) => migration.name),
    }
  }

  const key = migrationLockKey(options.lockNamespace)
  await acquireLock(
    executor,
    key,
    options.lockTimeoutMs ?? 30_000,
    options.lockRetryDelayMs ?? 250,
    options.sleep ?? defaultSleep,
    now,
  )

  let primaryError: unknown = null
  let result: ApplyMigrationsResult | null = null

  try {
    await executor.query(createMigrationsTableSql(table))
    const plan = await planMigrations(executor, migrations, { table })
    const applied: string[] = []
    const durationMsByName: Record<string, number> = {}

    for (const migration of plan.pending) {
      if (migration.transactional) assertTransactionalMigration(migration)

      const startedAt = now().getTime()
      const recordRow = async (target: SqlExecutor): Promise<void> => {
        await target.query(
          `INSERT INTO ${table} (name, checksum, applied_at, duration_ms) VALUES ($1, $2, $3, $4)`,
          [migration.name, migration.checksum, now(), Math.max(0, now().getTime() - startedAt)],
        )
      }

      if (migration.transactional && isTransactionalExecutor(executor)) {
        await executor.transaction(async (target) => {
          await target.query(migration.sql)
          await recordRow(target)
        })
      } else if (migration.transactional) {
        await applyInOwnTransaction(executor, async (target) => {
          for (const statement of splitSqlStatements(migration.sql)) {
            await target.query(statement)
          }
          await recordRow(target)
        })
      } else {
        // One statement per round trip. A multi-command simple query runs in an
        // implicit transaction, which is exactly what this file said it cannot
        // tolerate -- sending the whole thing at once would fail on the first
        // `CREATE MATERIALIZED VIEW ... WITH (timescaledb.continuous)`.
        for (const statement of splitSqlStatements(migration.sql)) {
          await executor.query(statement)
        }
        await recordRow(executor)
      }

      applied.push(migration.name)
      durationMsByName[migration.name] = Math.max(0, now().getTime() - startedAt)
    }

    result = { applied, dryRun: false, durationMsByName, plan, skipped: [] }
  } catch (cause: unknown) {
    primaryError = cause
  }

  // The unlock is not allowed to mask the migration failure, and a `false`
  // return is not "fine": it means this session never held the lock (a pooled
  // executor), so nothing was serialized and a concurrent deploy may have been
  // running the same DDL.
  let unlockError: unknown = null
  try {
    const unlocked = await executor.query<{ unlocked: boolean }>(
      'SELECT pg_advisory_unlock($1, $2) AS unlocked',
      [key[0], key[1]],
    )
    if (unlocked.rows[0]?.unlocked !== true) {
      unlockError = new NardukPostgresError(
        'MIGRATION_UNLOCK_FAILED',
        'pg_advisory_unlock reported that this session did not hold the migration lock. The executor is not a single pinned connection, so the run was not serialized.',
        { lockKey: key },
      )
    }
  } catch (cause: unknown) {
    unlockError = cause
  }

  if (primaryError !== null) throw primaryError
  if (unlockError !== null) throw unlockError
  return result as ApplyMigrationsResult
}
