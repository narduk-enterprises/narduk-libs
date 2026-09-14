import { describe, expect, it, vi } from 'vitest'

import { NardukPostgresError } from '../src/errors.js'
import { createProtocolFake } from '../src/testing.js'
import type { ManagedConnection } from '../src/types.js'
import {
  resolveHyperdriveConnectionString,
  withHyperdriveConnection,
  workerDriverOptions,
  workerTuning,
} from '../src/worker.js'

const BINDING = { connectionString: 'postgres://ingest:hunter2@hyperdrive.local:5432/mybo_history' }

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

describe('the Hyperdrive binding', () => {
  it('reads the connection string from env.HISTORY_DB', () => {
    expect(resolveHyperdriveConnectionString(BINDING)).toBe(BINDING.connectionString)
  })

  it('names the binding when it is missing or malformed', () => {
    for (const binding of [undefined, null, {}, { connectionString: '' }, 'a string']) {
      expect(() => resolveHyperdriveConnectionString(binding)).toThrow(
        /HYPERDRIVE_BINDING_INVALID/u,
      )
    }
  })
})

describe('worker driver options', () => {
  it('defaults to the flags Hyperdrive pooling requires', () => {
    expect(workerDriverOptions()).toEqual({
      connect_timeout: 10,
      connection: {
        application_name: 'narduk-postgres-worker',
        statement_timeout: '15000',
      },
      fetch_types: false,
      idle_timeout: 20,
      max: 5,
      prepare: false,
    })
  })

  it('carries a validated role as a startup parameter', () => {
    expect(workerDriverOptions({ role: 'ingest_writer' }).connection.role).toBe('ingest_writer')
    expect(() => workerDriverOptions({ role: 'postgres' as never })).toThrow(/ROLE_UNKNOWN/u)
  })

  // A Worker may hold six outbound TCP connections; a seventh fails the
  // request. The ceiling is enforced rather than documented.
  it('refuses a connection count above the Workers ceiling', () => {
    expect(() => workerTuning({ maxConnections: 7 })).toThrow(/CONNECTION_LIMIT_EXCEEDED/u)
    expect(workerTuning({ maxConnections: 6 }).maxConnections).toBe(6)
  })

  it('refuses a nonsensical timeout instead of silently coercing it', () => {
    expect(() => workerTuning({ statementTimeoutMs: 0 })).toThrow(/TUNING_INVALID/u)
    expect(() => workerTuning({ connectTimeoutSeconds: -1 })).toThrow(/TUNING_INVALID/u)
  })
})

describe('withHyperdriveConnection', () => {
  // The rule this exists for: nothing may outlive the invocation.
  it('closes the connection after the body returns', async () => {
    const connection = managed()
    const result = await withHyperdriveConnection(
      { binding: BINDING, connect: () => connection },
      async (executor) => {
        await executor.query('SELECT 1')
        return 'done'
      },
    )
    expect(result).toBe('done')
    expect(connection.ended).toBe(1)
  })

  it('closes the connection when the body throws, and rethrows the body error', async () => {
    const connection = managed()
    await expect(
      withHyperdriveConnection({ binding: BINDING, connect: () => connection }, async () => {
        throw new Error('query failed')
      }),
    ).rejects.toThrow('query failed')
    expect(connection.ended).toBe(1)
  })

  it('does not mask the body error with a close error', async () => {
    const connection = {
      end: () => {
        throw new Error('socket already gone')
      },
      query: createProtocolFake().query.bind(createProtocolFake()),
    }
    await expect(
      withHyperdriveConnection({ binding: BINDING, connect: () => connection }, async () => {
        throw new Error('query failed')
      }),
    ).rejects.toThrow('query failed')
  })

  it('surfaces a close error when the body succeeded', async () => {
    const connection = {
      end: () => {
        throw new Error('socket already gone')
      },
      query: createProtocolFake().query.bind(createProtocolFake()),
    }
    await expect(
      withHyperdriveConnection({ binding: BINDING, connect: () => connection }, async () => 'ok'),
    ).rejects.toThrow('socket already gone')
  })

  it('redacts the DSN when the driver cannot connect', async () => {
    const connect = vi.fn(() => {
      throw new Error('ECONNREFUSED')
    })
    const error = await withHyperdriveConnection<string>(
      { binding: BINDING, connect },
      async () => 'unreachable',
    ).then(
      () => null,
      (cause: unknown) => cause as NardukPostgresError,
    )
    expect(error).toBeInstanceOf(NardukPostgresError)
    expect(error?.message).toContain('HYPERDRIVE_BINDING_INVALID')
    expect(String(error?.details.connectionString)).not.toContain('hunter2')
  })

  it('hands the driver the connection string and the tuned options', async () => {
    const connection = managed()
    const connect = vi.fn(() => connection)
    await withHyperdriveConnection(
      { binding: BINDING, connect, options: { applicationName: 'mybo-history-consumer' } },
      async () => 'ok',
    )
    expect(connect).toHaveBeenCalledWith(BINDING.connectionString, {
      connect_timeout: 10,
      connection: {
        application_name: 'mybo-history-consumer',
        statement_timeout: '15000',
      },
      fetch_types: false,
      idle_timeout: 20,
      max: 5,
      prepare: false,
    })
  })
})
