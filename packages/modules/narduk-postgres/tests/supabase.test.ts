import { inspect } from 'node:util'

import { describe, expect, it, vi } from 'vitest'

import type { PostgresBackend } from '../src/backends.js'
import { NardukPostgresError } from '../src/errors.js'
import {
  SUPABASE_CAPABILITIES,
  createSupabaseBackend,
  parseSupabaseConnectionString,
  type SupabaseConnect,
} from '../src/supabase.js'
import { createProtocolFake } from '../src/testing.js'
import type { ManagedConnection } from '../src/types.js'

const DIRECT = 'postgresql://postgres:hunter2@db.abcdefghijklmnop.supabase.co:5432/postgres'
const SESSION =
  'postgresql://postgres.abcdefghijklmnop:hunter2@aws-0-us-east-1.pooler.supabase.com:5432/postgres'
const TRANSACTION =
  'postgresql://postgres.abcdefghijklmnop:hunter2@aws-0-us-east-1.pooler.supabase.com:6543/postgres'

function managed(): ManagedConnection & { end: ReturnType<typeof vi.fn> } {
  const fake = createProtocolFake()
  return Object.assign(fake, { end: vi.fn() })
}

function codeOf(run: () => unknown): string | undefined {
  try {
    run()
  } catch (error) {
    return (error as NardukPostgresError).code
  }
  return undefined
}

describe('parseSupabaseConnectionString', () => {
  it('reads the mode and project from the hosts Supabase publishes', () => {
    expect(parseSupabaseConnectionString(DIRECT)).toEqual({
      host: 'db.abcdefghijklmnop.supabase.co',
      mode: 'direct',
      port: 5432,
      projectRef: 'abcdefghijklmnop',
    })
    expect(parseSupabaseConnectionString(SESSION)).toMatchObject({
      mode: 'session',
      projectRef: 'abcdefghijklmnop',
    })
    expect(parseSupabaseConnectionString(TRANSACTION)).toMatchObject({
      mode: 'transaction',
      port: 6543,
    })
    // The dedicated pooler listens on 6543 on the direct host.
    expect(parseSupabaseConnectionString(DIRECT.replace(':5432', ':6543')).mode).toBe('transaction')
    expect(parseSupabaseConnectionString(DIRECT.replace(':5432', '')).port).toBe(5432)
  })

  it('needs a stated mode for a custom host, and refuses a contradicting one', () => {
    const custom = 'postgres://postgres:pw@db.example.com:5432/postgres'
    expect(codeOf(() => parseSupabaseConnectionString(custom))).toBe('SUPABASE_CONNECTION_INVALID')
    expect(parseSupabaseConnectionString(custom, 'session')).toMatchObject({
      mode: 'session',
      projectRef: null,
    })
    expect(() => parseSupabaseConnectionString(TRANSACTION, 'session')).toThrow(
      /Supabase transaction connection, not session/,
    )
  })

  it('refuses a non-TLS sslmode, a non-postgres URL and an empty string', () => {
    expect(() => parseSupabaseConnectionString(`${DIRECT}?sslmode=disable`)).toThrow(
      /requires TLS; sslmode=disable/,
    )
    expect(parseSupabaseConnectionString(`${DIRECT}?sslmode=verify-full`).mode).toBe('direct')
    expect(codeOf(() => parseSupabaseConnectionString('https://db.x.supabase.co'))).toBe(
      'SUPABASE_CONNECTION_INVALID',
    )
    expect(codeOf(() => parseSupabaseConnectionString('not a url'))).toBe(
      'SUPABASE_CONNECTION_INVALID',
    )
    expect(codeOf(() => parseSupabaseConnectionString(''))).toBe('CONNECTION_STRING_MISSING')
  })

  it('never puts the password in an error', () => {
    try {
      parseSupabaseConnectionString(`${DIRECT}?sslmode=disable`)
      expect.unreachable()
    } catch (error) {
      expect(inspect(error, { depth: 8 })).not.toContain('hunter2')
    }
  })
})

describe('createSupabaseBackend', () => {
  it('is a PostgresBackend of kind supabase with the mode capabilities', () => {
    const backend: PostgresBackend = createSupabaseBackend({
      connect: () => managed(),
      connectionString: TRANSACTION,
    })
    expect(backend.kind).toBe('supabase')
    expect(backend.capabilities).toEqual({ ddl: false, roleSwitching: false, timescale: false })
    expect(SUPABASE_CAPABILITIES.direct).toEqual({
      ddl: true,
      roleSwitching: true,
      timescale: false,
    })
    expect(SUPABASE_CAPABILITIES.session.timescale).toBe(false)
  })

  it('hands the driver TLS, prepare:false and the tuning, then closes the connection', async () => {
    const connection = managed()
    const connect = vi.fn<SupabaseConnect>(() => connection)
    const backend = createSupabaseBackend({
      connect,
      connectionString: SESSION,
      tuning: { applicationName: 'farm', role: 'ingest_writer' },
    })

    const rows = await backend.withConnection(async (executor) => {
      await executor.query('SELECT 1 AS ok')
      return 'done'
    })

    expect(rows).toBe('done')
    expect(connect).toHaveBeenCalledTimes(1)
    const [dsn, options] = connect.mock.calls[0]!
    expect(dsn).toBe(SESSION)
    expect(options).toMatchObject({
      ssl: 'require',
      prepare: false,
      fetch_types: false,
      max: 4,
      connection: { application_name: 'farm', role: 'ingest_writer' },
    })
    expect(connection.end).toHaveBeenCalledTimes(1)
  })

  it('uses the Worker defaults and ceiling for runtime worker', () => {
    const backend = createSupabaseBackend({
      connect: () => managed(),
      connectionString: TRANSACTION,
      runtime: 'worker',
      ssl: 'verify-full',
    })
    expect(backend.driverOptions).toMatchObject({ max: 5, ssl: 'verify-full' })
    expect(() =>
      createSupabaseBackend({
        connect: () => managed(),
        connectionString: TRANSACTION,
        runtime: 'worker',
        tuning: { maxConnections: 7 },
      }),
    ).toThrow(/at most 6/)
  })

  it('refuses a role on a transaction-mode connection before any socket opens', () => {
    const connect = vi.fn<SupabaseConnect>(() => managed())
    expect(() =>
      createSupabaseBackend({
        connect,
        connectionString: TRANSACTION,
        tuning: { role: 'history_reader' },
      }),
    ).toThrow(/cannot hold role history_reader/)
    expect(connect).not.toHaveBeenCalled()
  })

  it('closes the connection when the body throws, and keeps the body error', async () => {
    const connection = managed()
    connection.end.mockRejectedValue(new Error('close failed'))
    const backend = createSupabaseBackend({ connect: () => connection, connectionString: DIRECT })
    await expect(
      backend.withConnection(async () => {
        throw new Error('body failed')
      }),
    ).rejects.toThrow('body failed')
    expect(connection.end).toHaveBeenCalledTimes(1)
  })

  it('wraps a driver connect failure with the password redacted', async () => {
    const backend = createSupabaseBackend({
      connect: () => {
        throw new Error(`connect ECONNREFUSED ${DIRECT}`)
      },
      connectionString: DIRECT,
    })
    const error = await backend.withConnection(async () => 1).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(NardukPostgresError)
    expect((error as NardukPostgresError).code).toBe('SUPABASE_CONNECTION_INVALID')
    expect(inspect(error, { depth: 12, showHidden: true })).not.toContain('hunter2')
  })
})
