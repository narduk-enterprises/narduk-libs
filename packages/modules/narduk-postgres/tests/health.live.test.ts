/** Read-only postgres.js proof. No migrations, fixtures, or application rows. */
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { checkHealth } from '../src/health.js'
import { redactSecrets } from '../src/redact.js'
import type { SqlExecutor } from '../src/types.js'
import { workerDriverOptions } from '../src/worker.js'

const dsn = process.env.NARDUK_POSTGRES_LIVE_DSN
const required = ['timescaledb', 'postgis']

describe.skipIf(!dsn && process.env.NARDUK_POSTGRES_REQUIRE_LIVE !== '1')(
  'live postgres.js prepare:false (requires NARDUK_POSTGRES_LIVE_DSN)',
  () => {
    let sql: ReturnType<typeof postgres>
    let executor: SqlExecutor

    beforeAll(async () => {
      if (!dsn) throw new Error('NARDUK_POSTGRES_LIVE_DSN is required for the live health proof.')
      sql = postgres(dsn, {
        ...workerDriverOptions({
          maxConnections: 1,
          connectTimeoutSeconds: 3,
          statementTimeoutMs: 5000,
        }),
        // Only for a loopback SSH tunnel to a private Origin CA certificate.
        ...(process.env.NARDUK_POSTGRES_LIVE_SSH_TUNNEL === '1'
          ? { ssl: { rejectUnauthorized: false } }
          : {}),
      })
      executor = {
        async query<Row>(text: string, params?: readonly unknown[]) {
          try {
            const rows = await sql.unsafe(text, params as never[])
            return { rowCount: rows.count ?? rows.length, rows: [...rows] as unknown as Row[] }
          } catch (cause) {
            // Driver errors must not leak a DSN through assertion output.
            throw Object.assign(
              new Error(redactSecrets(cause instanceof Error ? cause.message : 'Query failed')),
              {
                code: cause instanceof Error && 'code' in cause ? cause.code : 'UNKNOWN',
              },
            )
          }
        },
      }
      await executor.query('SELECT 1 AS ok')
    })

    afterAll(async () => {
      if (sql) await sql.end({ timeout: 3 })
    })

    it('reproduces the 0.2.0 array failure on the real driver', async () => {
      await expect(
        executor.query('SELECT extname FROM pg_extension WHERE extname = ANY($1::text[])', [
          required,
        ]),
      ).rejects.toMatchObject({ code: '22P02' })
    })

    it('finds both installed extensions with the health query', async () => {
      const report = await checkHealth(executor, { requiredExtensions: required })
      expect(report).toMatchObject({
        connected: true,
        ok: true,
        error: null,
        missingExtensions: [],
      })
      expect(report.extensions.map(({ installed, name }) => ({ installed, name }))).toEqual(
        required.map((name) => ({ installed: true, name })),
      )
    })

    it('keeps connected:true when a subsequent real statement errors', async () => {
      const report = await checkHealth(
        {
          query: (text, params) =>
            text.includes('pg_extension')
              ? executor.query('SELECT 1 / 0')
              : executor.query(text, params),
        },
        { requiredExtensions: required },
      )
      expect(report).toMatchObject({ connected: true, ok: false, error: { code: '22012' } })
    })

    it('treats an absent extension name as a bound value', async () => {
      const name = 'missing,\'"{} extension'
      const report = await checkHealth(executor, { requiredExtensions: [...required, name] })
      expect(report).toMatchObject({
        connected: true,
        ok: false,
        error: null,
        missingExtensions: [name],
      })
    })
  },
)
