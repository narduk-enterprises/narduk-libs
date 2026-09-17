import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inspect } from 'node:util'

import { afterEach, describe, expect, it } from 'vitest'

import { NardukPostgresError } from '../src/errors.js'
import { getUnredactedCause } from '../src/redact.js'

import {
  loadMigrationsFromDirectory,
  migrationDriverOptions,
  nodeDriverOptions,
  withNodeConnection,
} from '../src/node.js'
import { createProtocolFake } from '../src/testing.js'
import type { ManagedConnection } from '../src/types.js'

const DSN = 'postgres://ops:hunter2@10.70.0.4:5432/mybo_history'

function driverConnectError(): Error & { code: string } {
  const nested = new Error(`lookup failed for ${DSN}`)
  const error = new Error(`connect ECONNREFUSED ${DSN}`) as Error & { code: string }
  error.name = 'PostgresError'
  error.code = 'ECONNREFUSED'
  error.cause = nested
  return error
}

function serializedErrorSurface(error: unknown): string {
  const chunks: string[] = []
  const seen = new Set<unknown>()
  const walk = (value: unknown, depth: number): void => {
    if (value == null || depth > 12) return
    if (typeof value === 'string') {
      chunks.push(value)
      return
    }
    if (typeof value !== 'object') {
      chunks.push(String(value))
      return
    }
    if (seen.has(value)) return
    seen.add(value)
    if (value instanceof Error) {
      chunks.push(value.name, value.message, value.stack ?? '')
      if ('code' in value) walk(value.code, depth + 1)
      walk(value.cause, depth + 1)
      if ('details' in value) walk(value.details, depth + 1)
      return
    }
    for (const [key, item] of Object.entries(value)) {
      chunks.push(key)
      walk(item, depth + 1)
    }
  }
  walk(error, 0)
  chunks.push(JSON.stringify(error))
  chunks.push(inspect(error, { depth: 12, getters: true, showHidden: true }))
  return chunks.join('\n')
}

const directories: string[] = []
async function migrationsDirectory(files: Record<string, string>): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'narduk-postgres-migrations-'))
  directories.push(directory)
  for (const [name, sql] of Object.entries(files)) {
    await writeFile(join(directory, name), sql, 'utf8')
  }
  return directory
}

afterEach(() => {
  directories.length = 0
})

describe('node driver options', () => {
  it('renders libpq startup options and a statement timeout', () => {
    const options = nodeDriverOptions()
    expect(options.max).toBe(4)
    expect(options.statement_timeout).toBe(300_000)
    expect(options.options).toBe(
      '-c application_name=narduk-postgres-node -c statement_timeout=300000',
    )
  })

  // pg_advisory_lock is session-scoped, so a pooled migration connection
  // protects nothing. The migration tuning pins one socket and ignores an
  // attempt to raise it.
  it('pins a migration connection to a single socket', () => {
    expect(migrationDriverOptions({ maxConnections: 8 }).max).toBe(1)
  })
})

describe('withNodeConnection', () => {
  function managed(): ManagedConnection & { ended: number } {
    const fake = createProtocolFake()
    const connection = {
      ended: 0,
      end: () => {
        connection.ended += 1
      },
      query: fake.query.bind(fake),
    }
    return connection
  }

  it('closes the connection afterwards', async () => {
    const connection = managed()
    await withNodeConnection({ connect: () => connection, connectionString: DSN }, async () => 'ok')
    expect(connection.ended).toBe(1)
  })

  it('refuses an empty connection string', async () => {
    await expect(
      withNodeConnection({ connect: () => managed(), connectionString: '' }, async () => 'ok'),
    ).rejects.toThrow(/CONNECTION_STRING_MISSING/u)
  })

  it('redacts the DSN when the driver cannot connect', async () => {
    const error = await withNodeConnection<string>(
      {
        connect: () => {
          throw new Error('ECONNREFUSED')
        },
        connectionString: DSN,
      },
      async () => 'unreachable',
    ).then(
      () => null,
      (cause: unknown) => cause as NardukPostgresError,
    )
    expect(error).toBeInstanceOf(NardukPostgresError)
    expect(String(error?.details.connectionString)).not.toContain('hunter2')
  })

  it('redacts a driver-error cause that embeds the DSN password', async () => {
    const error = await withNodeConnection<string>(
      {
        connect: () => {
          throw driverConnectError()
        },
        connectionString: DSN,
      },
      async () => 'unreachable',
    ).then(
      () => null,
      (cause: unknown) => cause,
    )
    expect(error).toBeInstanceOf(NardukPostgresError)
    expect(serializedErrorSurface(error)).not.toContain('hunter2')
    const original = getUnredactedCause(error as object)
    expect(original).toBeInstanceOf(Error)
    expect(String((original as Error).message)).toContain('hunter2')
  })

  it('uses the single-socket tuning when asked', async () => {
    let received: { max?: number } = {}
    await withNodeConnection(
      {
        connect: (_connectionString, options) => {
          received = options
          return managed()
        },
        connectionString: DSN,
        singleConnection: true,
      },
      async () => 'ok',
    )
    expect(received.max).toBe(1)
  })
})

describe('loadMigrationsFromDirectory', () => {
  it('loads .sql files in name order with checksums', async () => {
    const directory = await migrationsDirectory({
      '0001_history_core.sql': 'CREATE TABLE series ();',
      '0002_history_rollups.sql': 'CREATE MATERIALIZED VIEW m AS SELECT 1;',
    })
    const migrations = await loadMigrationsFromDirectory(directory)
    expect(migrations.map((migration) => migration.name)).toEqual([
      '0001_history_core.sql',
      '0002_history_rollups.sql',
    ])
    for (const migration of migrations) expect(migration.checksum).toMatch(/^[0-9a-f]{64}$/u)
  })

  // A `.bak` an editor left behind is exactly the case where silently skipping
  // means a migration nobody notices is missing.
  it('refuses a stray file rather than skipping it', async () => {
    const directory = await migrationsDirectory({
      '0001_history_core.sql': 'SELECT 1;',
      '0002_history_rollups.sql.bak': 'SELECT 2;',
    })
    await expect(loadMigrationsFromDirectory(directory)).rejects.toThrow(/MIGRATION_NAME_INVALID/u)
  })

  it('accepts a file URL as well as a path', async () => {
    const directory = await migrationsDirectory({ '0001_history_core.sql': 'SELECT 1;' })
    const migrations = await loadMigrationsFromDirectory(new URL(`file://${directory}/`))
    expect(migrations).toHaveLength(1)
  })
})
