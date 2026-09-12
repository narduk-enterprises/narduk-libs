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

export function parseMigrationDirectives(sql: string): { transactional: boolean } {
  return { transactional: !sql.includes(NO_TRANSACTION_DIRECTIVE) }
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
  return migrations.sort((left, right) => left.name.localeCompare(right.name))
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

async function migrationsTableExists(executor: SqlExecutor): Promise<boolean> {
  const result = await executor.query<{ exists: boolean }>(
    'SELECT to_regclass($1) IS NOT NULL AS exists',
    [MIGRATIONS_TABLE],
  )
  return result.rows[0]?.exists === true
}

async function readApplied(executor: SqlExecutor): Promise<AppliedMigration[]> {
  const result = await executor.query<AppliedRow>(
    `SELECT name, checksum, applied_at FROM ${MIGRATIONS_TABLE} ORDER BY name ASC`,
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
): Promise<MigrationPlan> {
  const tableExists = await migrationsTableExists(executor)
  const applied = tableExists ? await readApplied(executor) : []
  assertImmutability(applied, migrations)

  const appliedNames = new Set(applied.map((row) => row.name))
  const pending = migrations.filter((migration) => !appliedNames.has(migration.name))
  assertOrder(applied, pending)

  return { applied, pending, tableExists }
}

export const CREATE_MIGRATIONS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
  name TEXT PRIMARY KEY,
  checksum TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  duration_ms INTEGER NOT NULL DEFAULT 0
)`

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

export async function applyMigrations(
  executor: SqlExecutor,
  migrations: readonly Migration[],
  options: ApplyMigrationsOptions = {},
): Promise<ApplyMigrationsResult> {
  const now = options.now ?? ((): Date => new Date())

  if (options.dryRun === true) {
    const plan = await planMigrations(executor, migrations)
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

  try {
    await executor.query(CREATE_MIGRATIONS_TABLE_SQL)
    const plan = await planMigrations(executor, migrations)
    const applied: string[] = []
    const durationMsByName: Record<string, number> = {}

    for (const migration of plan.pending) {
      const startedAt = now().getTime()
      const record = async (target: SqlExecutor): Promise<void> => {
        await target.query(migration.sql)
        await target.query(
          `INSERT INTO ${MIGRATIONS_TABLE} (name, checksum, applied_at, duration_ms) VALUES ($1, $2, $3, $4)`,
          [migration.name, migration.checksum, now(), Math.max(0, now().getTime() - startedAt)],
        )
      }

      if (migration.transactional && isTransactionalExecutor(executor)) {
        await executor.transaction(record)
      } else {
        await record(executor)
      }

      applied.push(migration.name)
      durationMsByName[migration.name] = Math.max(0, now().getTime() - startedAt)
    }

    return { applied, dryRun: false, durationMsByName, plan, skipped: [] }
  } finally {
    await executor.query('SELECT pg_advisory_unlock($1, $2)', [key[0], key[1]])
  }
}
