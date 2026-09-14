import { describe, expect, it } from 'vitest'

import { checkHealth } from '../src/health.js'
import { createProtocolFake } from '../src/testing.js'
import type { SqlExecutor } from '../src/types.js'

function clock(values: number[]): () => number {
  let index = 0
  return () => values[Math.min(index++, values.length - 1)] ?? 0
}

describe('checkHealth', () => {
  it('runs SELECT 1 and one bounded extension lookup', async () => {
    const fake = createProtocolFake().respondTo(/pg_extension/u, [
      { extname: 'timescaledb', extversion: '2.17.2' },
      { extname: 'postgis', extversion: '3.5.0' },
    ])

    const report = await checkHealth(fake, {
      now: clock([100, 142]),
      requiredExtensions: ['timescaledb', 'postgis'],
    })

    expect(report.ok).toBe(true)
    expect(report.connected).toBe(true)
    expect(report.latencyMs).toBe(42)
    expect(report.missingExtensions).toEqual([])
    expect(report.extensions).toEqual([
      { installed: true, name: 'timescaledb', version: '2.17.2' },
      { installed: true, name: 'postgis', version: '3.5.0' },
    ])
    // Two statements, and the extension lookup binds exactly one array.
    expect(fake.texts).toHaveLength(2)
    expect(fake.parameterCounts).toEqual([0, 1])
  })

  // "Up but wrong" is the state an operator most needs named: a Postgres that
  // answers SELECT 1 without timescaledb cannot hold the history store.
  it('reports connected but not ok when a required extension is absent', async () => {
    const fake = createProtocolFake().respondTo(/pg_extension/u, [
      { extname: 'postgis', extversion: '3.5.0' },
    ])
    const report = await checkHealth(fake, { requiredExtensions: ['timescaledb', 'postgis'] })
    expect(report.connected).toBe(true)
    expect(report.ok).toBe(false)
    expect(report.missingExtensions).toEqual(['timescaledb'])
  })

  it('skips the extension statement when nothing is required', async () => {
    const fake = createProtocolFake()
    const report = await checkHealth(fake)
    expect(report.ok).toBe(true)
    expect(fake.texts).toEqual(['SELECT 1 AS ok'])
  })

  // A health endpoint that throws turns one degraded dependency into a 500 on
  // the page that was meant to report it.
  it('never throws, and never leaks a DSN from the driver error', async () => {
    const failing: SqlExecutor = {
      query: () =>
        Promise.reject(
          new Error('connect ECONNREFUSED postgres://ingest:hunter2@10.70.0.4:5432/mybo_history'),
        ),
    }
    const report = await checkHealth(failing, { requiredExtensions: ['timescaledb'] })
    expect(report.ok).toBe(false)
    expect(report.connected).toBe(false)
    expect(report.error?.message).not.toContain('hunter2')
    expect(report.missingExtensions).toEqual(['timescaledb'])
  })

  // narduk-libs#304: over a Hyperdrive connection (`prepare: false`), the
  // extension lookup used to bind the required-extensions array directly as
  // `$1::text[]`. postgres.js's unprepared path cannot type-infer that
  // parameter and serializes it as bare comma-joined text, which Postgres
  // rejects with `22P02 malformed array literal` -- every healthy database
  // came back `ok: false`. `createProtocolFake({ prepare: false })` is the
  // fake's own model of that failure mode (see `../src/testing.ts`): it
  // throws PROTOCOL_VIOLATION on a raw array parameter, so this test fails
  // against the old `[required]` binding and passes against the fix's single
  // joined-string parameter.
  it('reports healthy extensions over an unprepared (prepare: false) connection, the Hyperdrive shape', async () => {
    const fake = createProtocolFake({ prepare: false }).respondTo(/pg_extension/u, (params) => {
      const names = String(params[0]).split(',')
      return [
        { extname: 'timescaledb', extversion: '2.17.2' },
        { extname: 'postgis', extversion: '3.5.0' },
      ].filter((row) => names.includes(row.extname))
    })

    const report = await checkHealth(fake, { requiredExtensions: ['timescaledb', 'postgis'] })

    expect(report.ok).toBe(true)
    expect(report.connected).toBe(true)
    expect(report.missingExtensions).toEqual([])
    // Still exactly one bound parameter -- a joined string, not an array.
    expect(fake.parameterCounts).toEqual([0, 1])
    expect(fake.statements[1]?.params).toEqual(['timescaledb,postgis'])
  })

  // The other half of narduk-libs#304: a statement error raised *after*
  // `SELECT 1` succeeds (a live 22P02 from the malformed-array-literal bug,
  // or any other extension-lookup failure) is a reachable-but-wrong database,
  // not an unreachable one. Conflating the two is what made a live, connected
  // Postgres report itself unreachable.
  it('reports connected: true when SELECT 1 succeeds but the extension lookup fails', async () => {
    let calls = 0
    const executor: SqlExecutor = {
      query: <Row = Record<string, unknown>>() => {
        calls += 1
        if (calls === 1) {
          return Promise.resolve({ rowCount: 1, rows: [{ ok: 1 }] as Row[] })
        }
        return Promise.reject(
          Object.assign(new Error('malformed array literal: "timescaledb,postgis"'), {
            code: '22P02',
          }),
        )
      },
    }

    const report = await checkHealth(executor, { requiredExtensions: ['timescaledb', 'postgis'] })

    expect(report.connected).toBe(true)
    expect(report.ok).toBe(false)
    expect(report.error?.code).toBe('22P02')
    expect(report.missingExtensions).toEqual(['timescaledb', 'postgis'])
  })

  // SELECT 1 already succeeded by the time the extension list is joined, so a
  // comma-contaminated name is a reachable database reporting a caller
  // mistake -- connected: true, same as any other post-connect statement
  // error -- not silently misparsed into the wrong ANY() membership check.
  it('rejects a required extension name containing a comma rather than silently misparsing it', async () => {
    const fake = createProtocolFake()
    const report = await checkHealth(fake, {
      requiredExtensions: ['timescaledb', 'oops,postgis'],
    })
    expect(report.connected).toBe(true)
    expect(report.ok).toBe(false)
    expect(report.error?.code).toBe('PROTOCOL_VIOLATION')
  })
})
