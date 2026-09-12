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
})
