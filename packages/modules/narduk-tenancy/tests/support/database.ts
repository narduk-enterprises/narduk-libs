import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'

import { createTenancy, type TenancyDatabase, type TenancyService } from '../../server/utils/tenancy'

export const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '../..')
export const MIGRATION_PATH = join(packageRoot, 'drizzle/0001_tenancy.sql')

export interface TestClock {
  now: () => number
  advance: (milliseconds: number) => void
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
  sqlite: Database.Database
  db: TenancyDatabase
  tenancy: TenancyService
  clock: TestClock
}

/**
 * Real SQLite, real DDL: the published migration file is executed verbatim
 * against an in-memory database, so nothing here can pass against a schema the
 * package does not ship.
 *
 * The one cast is the documented adapter the package README describes: the
 * service awaits `.get()`/`.all()`/`.run()`, and the synchronous better-sqlite3
 * driver returns values that `await` resolves unchanged, so the same code runs
 * on D1 (async) and here (sync).
 */
export function createTestHarness(options: { tokens?: string[] } = {}): TestHarness {
  const sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  sqlite.exec(readFileSync(MIGRATION_PATH, 'utf8'))

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
