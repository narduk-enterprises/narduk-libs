/// <reference types="@cloudflare/workers-types" />
import { sql } from 'drizzle-orm'
import type { H3Event } from 'h3'

import { isDatabaseBackendDeclared, usesNardukAuth } from '../../shared/database-backend'
import { probeDatabaseConnection } from '../utils/database'
import { readWorkerRuntimeEnv } from '../utils/worker-env'
import {
  getHealthCheckRegistry,
  runRegisteredHealthCheck,
  settleWithTimeout,
  type HealthCheckFailureLogger,
  type HealthCheckReport,
} from './checks'

/** HTTP status for a report whose `status` is `error`; `ok` and `degraded` stay 200. */
export const HEALTH_ERROR_STATUS_CODE = 503
export const DATABASE_PROBE_TIMEOUT_MS = 5000
export const REQUIRED_AUTH_TABLES = ['api_keys', 'sessions', 'users'] as const

const REQUIRED_AUTH_TABLE_SQL = REQUIRED_AUTH_TABLES.map((tableName) => `'${tableName}'`).join(', ')

export type HealthStatus = 'ok' | 'degraded' | 'error'

/** The original `data.database` field, which existing monitors match. */
export type DatabaseHealthStatus =
  | 'ok'
  | 'not_applicable'
  | 'not_available'
  | 'schema_error'
  | 'error'

export interface HealthReport {
  status: HealthStatus
  timestamp: string
  database: DatabaseHealthStatus
  missingAuthTables: string[]
  checks: HealthCheckReport[]
}

/** The runtime config fields the report reads. */
export interface HealthReportConfig {
  databaseBackend?: unknown
  databaseBackendSource?: unknown
  authBackend?: unknown
  nardukHealth?: unknown
}

interface DatabaseProbeReport {
  database: DatabaseHealthStatus
  missingAuthTables: string[]
  databaseCheck: HealthCheckReport
  authTablesCheck: HealthCheckReport
}

function skippedCheck(name: string, reason: string): HealthCheckReport {
  return { name, required: false, result: 'skipped', reason }
}

async function timedProbe<T>(task: () => Promise<T>) {
  const startedAt = Date.now()
  const settled = await settleWithTimeout(DATABASE_PROBE_TIMEOUT_MS, task)
  return { settled, durationMs: Date.now() - startedAt }
}

function failedDatabaseCheck(kind: 'error' | 'timeout', durationMs: number): HealthCheckReport {
  return {
    name: 'database',
    required: true,
    result: 'fail',
    durationMs,
    error:
      kind === 'timeout'
        ? `Database probe timed out after ${DATABASE_PROBE_TIMEOUT_MS} ms.`
        : 'Database probe failed.',
  }
}

async function probeDatabase(
  event: H3Event,
  config: HealthReportConfig,
  log: HealthCheckFailureLogger,
): Promise<DatabaseProbeReport> {
  const authTables = usesNardukAuth(config)
  const backend = config.databaseBackend ?? 'd1'

  if (backend === 'none') {
    return {
      database: 'not_applicable',
      missingAuthTables: [],
      databaseCheck: skippedCheck('database', 'not-configured'),
      authTablesCheck: skippedCheck('auth-tables', authTables ? 'no-database' : 'auth-not-enabled'),
    }
  }

  if (backend === 'postgres') {
    const authTablesCheck = skippedCheck(
      'auth-tables',
      authTables ? 'unsupported-backend' : 'auth-not-enabled',
    )
    const { settled, durationMs } = await timedProbe(() =>
      probeDatabaseConnection(event, sql`select 1`),
    )
    if (settled.kind !== 'value') {
      log.error(
        settled.kind === 'timeout'
          ? 'Health check Postgres probe timed out'
          : 'Health check Postgres probe failed',
      )
      return {
        database: 'error',
        missingAuthTables: [],
        databaseCheck: failedDatabaseCheck(settled.kind, durationMs),
        authTablesCheck,
      }
    }
    return {
      database: 'ok',
      missingAuthTables: [],
      databaseCheck: { name: 'database', required: true, result: 'pass', durationMs },
      authTablesCheck,
    }
  }

  // Every other value is D1, the historical default.
  const d1 = (readWorkerRuntimeEnv(event) as { DB?: D1Database }).DB
  if (!d1) {
    // An app that never declared a backend inherited D1 without choosing it,
    // so a missing binding stays `degraded` for it. A declared D1 app is broken.
    const declared = isDatabaseBackendDeclared(config.databaseBackendSource)
    if (declared) {
      log.error('Health check found no D1 binding for a declared D1 database')
    }
    return {
      database: 'not_available',
      missingAuthTables: [],
      databaseCheck: {
        name: 'database',
        required: declared,
        result: 'fail',
        error: declared
          ? 'D1 binding DB is not configured.'
          : "D1 binding DB is not configured. Declare databaseBackend 'none' if this app has no database.",
      },
      authTablesCheck: skippedCheck(
        'auth-tables',
        authTables ? 'database-unavailable' : 'auth-not-enabled',
      ),
    }
  }

  // With narduk-auth the table lookup doubles as the connectivity probe.
  const { settled, durationMs } = await timedProbe(() =>
    d1
      .prepare(
        authTables
          ? `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${REQUIRED_AUTH_TABLE_SQL})`
          : 'SELECT 1',
      )
      .all<{ name: string }>(),
  )
  if (settled.kind !== 'value') {
    log.error(
      settled.kind === 'timeout'
        ? 'Health check DB probe timed out'
        : 'Health check DB probe failed',
    )
    return {
      database: 'error',
      missingAuthTables: [],
      databaseCheck: failedDatabaseCheck(settled.kind, durationMs),
      authTablesCheck: skippedCheck(
        'auth-tables',
        authTables ? 'database-unavailable' : 'auth-not-enabled',
      ),
    }
  }

  const databaseCheck: HealthCheckReport = {
    name: 'database',
    required: true,
    result: 'pass',
    durationMs,
  }
  if (!authTables) {
    return {
      database: 'ok',
      missingAuthTables: [],
      databaseCheck,
      authTablesCheck: skippedCheck('auth-tables', 'auth-not-enabled'),
    }
  }

  const existingTables = new Set(settled.value.results.map((row) => row.name))
  const missingAuthTables = REQUIRED_AUTH_TABLES.filter((tableName) => !existingTables.has(tableName))
  if (missingAuthTables.length > 0) {
    log.error('Health check DB schema probe failed', { missingAuthTables })
    return {
      database: 'schema_error',
      missingAuthTables,
      databaseCheck,
      authTablesCheck: {
        name: 'auth-tables',
        required: false,
        result: 'fail',
        error: 'Required auth tables are missing.',
      },
    }
  }
  return {
    database: 'ok',
    missingAuthTables: [],
    databaseCheck,
    authTablesCheck: { name: 'auth-tables', required: false, result: 'pass' },
  }
}

/** `error` when a required check failed, `degraded` when only optional ones did. */
export function summarizeHealthStatus(checks: readonly HealthCheckReport[]): HealthStatus {
  let status: HealthStatus = 'ok'
  for (const check of checks) {
    if (check.result !== 'fail') {
      continue
    }
    if (check.required) {
      return 'error'
    }
    status = 'degraded'
  }
  return status
}

/**
 * Run the built-in database probe and every registered check concurrently.
 * `checks` lists `database`, `auth-tables`, then registered checks in the
 * order they were registered.
 */
export async function buildHealthReport(
  event: H3Event,
  config: HealthReportConfig,
  log: HealthCheckFailureLogger,
): Promise<HealthReport> {
  const registered = [...getHealthCheckRegistry().values()]
  const [probe, registeredChecks] = await Promise.all([
    probeDatabase(event, config, log),
    Promise.all(registered.map((check) => runRegisteredHealthCheck(check, event, log))),
  ])
  const checks = [probe.databaseCheck, probe.authTablesCheck, ...registeredChecks]
  // Key order is part of the contract: `status` and `database` come first so
  // monitors that read only the start of the body still see them.
  return {
    status: summarizeHealthStatus(checks),
    timestamp: new Date().toISOString(),
    database: probe.database,
    missingAuthTables: probe.missingAuthTables,
    checks,
  }
}
