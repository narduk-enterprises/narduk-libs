import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'

import {
  createTenancy,
  type TenancyDatabase,
  type TenancyService,
} from '../../server/utils/tenancy'

export const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '../..')
export const MIGRATION_DIR = join(packageRoot, 'drizzle')

/**
 * Every published migration, in the lexical order a consumer's runner applies
 * them. Discovered rather than listed, so a new file cannot be shipped without
 * the suite executing it -- naming one file is how `0002` shipped past both
 * the better-sqlite3 harness and the D1 driver in narduk-devices
 * (narduk-libs#228 review M6), and this package had the same gap
 * (narduk-libs#229).
 */
export const MIGRATION_PATHS: string[] = readdirSync(MIGRATION_DIR)
  .filter((entry) => entry.endsWith('.sql'))
  .sort()
  .map((entry) => join(MIGRATION_DIR, entry))

export const MIGRATION_SQL = MIGRATION_PATHS.map((path) => readFileSync(path, 'utf8')).join('\n')

export interface TestClock {
  advance: (milliseconds: number) => void
  now: () => number
  set: (milliseconds: number) => void
}

export function createTestClock(start = 1_700_000_000_000): TestClock {
  let current = start
  return {
    now: () => current,
    advance: (milliseconds) => {
      current += milliseconds
    },
    set: (milliseconds) => {
      current = milliseconds
    },
  }
}

export function createTestIdGenerator(prefix = 'id'): () => string {
  let counter = 0
  return () => {
    counter += 1
    return `${prefix}-${counter}`
  }
}

export interface TestHarness {
  clock: TestClock
  db: TenancyDatabase
  sqlite: Database.Database
  tenancy: TenancyService
}

/**
 * Real SQLite, real DDL: every published migration is executed verbatim, in
 * order, against an in-memory database, so nothing here can pass against a
 * schema the package does not ship.
 *
 * The one cast is the documented adapter the package README describes: the
 * service awaits `.get()`/`.all()`/`.run()`, and the synchronous better-sqlite3
 * driver returns values that `await` resolves unchanged, so the same code runs
 * on D1 (async) and here (sync).
 */
export function createTestHarness(options: { tokens?: string[] } = {}): TestHarness {
  const sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  sqlite.exec(MIGRATION_SQL)

  const clock = createTestClock()
  const nextId = createTestIdGenerator()
  const tokens = [...(options.tokens ?? [])]
  const nextToken = createTestIdGenerator('token')

  const db = drizzle(sqlite) as unknown as TenancyDatabase
  const tenancy = createTenancy(db, {
    now: clock.now,
    idGenerator: nextId,
    tokenGenerator: () => tokens.shift() ?? nextToken(),
  })

  return { sqlite, db, tenancy, clock }
}
