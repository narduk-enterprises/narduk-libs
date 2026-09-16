/// <reference types="@cloudflare/workers-types" />
import { sql } from 'drizzle-orm'

import { isDatabaseBackendDeclared, usesNardukAuth } from '../../shared/database-backend'
import { probeDatabaseConnection } from '../utils/database'
import { readWorkerRuntimeEnv } from '../utils/worker-env'

import {
  getHealthCheckRegistry,
  type HealthCheckFailureLogger,
  type HealthCheckReport,
  runRegisteredHealthCheck,
  settleWithTimeout,
} from './checks'

import type { H3Event } from 'h3'

/** HTTP status for a report whose `status` is `error`; `ok` and `degraded` stay 200. */
export const HEALTH_ERROR_STATUS_CODE = 503
export const DATABASE_PROBE_TIMEOUT_MS = 5000
export const REQUIRED_AUTH_TABLES = ['api_keys', 'sessions', 'users'] as const

const DATABASE_CHECK = 'database'
const AUTH_TABLES_CHECK = 'auth-tables'
const AUTH_NOT_ENABLED = 'auth-not-enabled'
const DATABASE_UNAVAILABLE = 'database-unavailable'
const REQUIRED_AUTH_TABLE_SQL = REQUIRED_AUTH_TABLES.map((tableName) => `'${tableName}'`).join(', ')

export type HealthStatus = 'ok' | 'degraded' | 'error'

/** The original `data.database` field, which existing monitors match. */
export type DatabaseHealthStatus =
  'ok' | 'not_applicable' | 'not_available' | 'schema_error' | 'error'

/**
 * The `/api/health` payload. The route serializes it in the order
 * `buildHealthReport` builds it: status, timestamp, database, missingAuthTables, checks.
 */
export interface HealthReport {
  checks: HealthCheckReport[]
  database: DatabaseHealthStatus
  missingAuthTables: string[]
  status: HealthStatus
  timestamp: string
}

/** The runtime config fields the report reads. */
export interface HealthReportConfig {
  authBackend?: unknown
  databaseBackend?: unknown
  databaseBackendSource?: unknown
  nardukHealth?: unknown
}

interface DatabaseProbeReport {
  authTablesCheck: HealthCheckReport
  database: DatabaseHealthStatus
  databaseCheck: HealthCheckReport
  missingAuthTables: string[]
}

function skippedCheck(name: string, reason: string): HealthCheckReport {
  return { name, required: false, result: 'skipped', reason }
}

/** The skipped auth-table entry: `reason` when narduk-auth is installed. */
function skippedAuthTablesCheck(authTables: boolean, reason: string): HealthCheckReport {
  return skippedCheck(AUTH_TABLES_CHECK, authTables ? reason : AUTH_NOT_ENABLED)
}

async function timedProbe<T>(task: () => Promise<T>) {
  const startedAt = Date.now()
  const settled = await settleWithTimeout(DATABASE_PROBE_TIMEOUT_MS, task)
  return { settled, durationMs: Date.now() - startedAt }
}

function passedDatabaseCheck(durationMs: number): HealthCheckReport {
  return { name: DATABASE_CHECK, required: true, result: 'pass', durationMs }
}

function failedDatabaseCheck(kind: 'error' | 'timeout', durationMs: number): HealthCheckReport {
  return {
    name: DATABASE_CHECK,
    required: true,
    result: 'fail',
    durationMs,
    error:
      kind === 'timeout'
        ? `Database probe timed out after ${DATABASE_PROBE_TIMEOUT_MS} ms.`
        : 'Database probe failed.',
  }
}

async function probePostgres(
  event: H3Event,
  authTables: boolean,
  log: HealthCheckFailureLogger,
): Promise<DatabaseProbeReport> {
  // The auth-table probe reads SQLite's catalog, so it only runs on D1.
  const authTablesCheck = skippedAuthTablesCheck(authTables, 'unsupported-backend')
  const { settled, durationMs } = await timedProbe(() =>
    probeDatabaseConnection(event, sql`select 1`),
  )
  if (settled.kind === 'value') {
    return {
      database: 'ok',
      missingAuthTables: [],
      databaseCheck: passedDatabaseCheck(durationMs),
      authTablesCheck,
    }
  }
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

/**
 * An app that never declared a backend inherited D1 without choosing it, so a
 * missing binding stays `degraded` for it. A declared D1 app is broken.
 */
function reportMissingD1Binding(
  config: HealthReportConfig,
  authTables: boolean,
  log: HealthCheckFailureLogger,
): DatabaseProbeReport {
  const declared = isDatabaseBackendDeclared(config.databaseBackendSource)
  if (declared) {
    log.error('Health check found no D1 binding for a declared D1 database')
  }
  return {
    database: 'not_available',
    missingAuthTables: [],
    databaseCheck: {
      name: DATABASE_CHECK,
      required: declared,
      result: 'fail',
      error: declared
        ? 'D1 binding DB is not configured.'
        : "D1 binding DB is not configured. Declare databaseBackend 'none' if this app has no database.",
    },
    authTablesCheck: skippedAuthTablesCheck(authTables, DATABASE_UNAVAILABLE),
  }
}

async function probeD1(
  d1: D1Database,
  authTables: boolean,
  log: HealthCheckFailureLogger,
): Promise<DatabaseProbeReport> {
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
      authTablesCheck: skippedAuthTablesCheck(authTables, DATABASE_UNAVAILABLE),
    }
  }

  const databaseCheck = passedDatabaseCheck(durationMs)
  if (!authTables) {
    return {
      database: 'ok',
      missingAuthTables: [],
      databaseCheck,
      authTablesCheck: skippedCheck(AUTH_TABLES_CHECK, AUTH_NOT_ENABLED),
    }
  }

  const existingTables = new Set(settled.value.results.map((row) => row.name))
  const missingAuthTables = REQUIRED_AUTH_TABLES.filter(
    (tableName) => !existingTables.has(tableName),
  )
  if (missingAuthTables.length === 0) {
    return {
      database: 'ok',
      missingAuthTables,
      databaseCheck,
      authTablesCheck: { name: AUTH_TABLES_CHECK, required: false, result: 'pass' },
    }
  }
  log.error('Health check DB schema probe failed', { missingAuthTables })
  return {
    database: 'schema_error',
    missingAuthTables,
    databaseCheck,
    authTablesCheck: {
      name: AUTH_TABLES_CHECK,
      required: false,
      result: 'fail',
      error: 'Required auth tables are missing.',
    },
  }
}

function probeDatabase(
  event: H3Event,
  config: HealthReportConfig,
  log: HealthCheckFailureLogger,
): DatabaseProbeReport | Promise<DatabaseProbeReport> {
  const authTables = usesNardukAuth(config)
  const backend = config.databaseBackend ?? 'd1'

  if (backend === 'none') {
    return {
      database: 'not_applicable',
      missingAuthTables: [],
      databaseCheck: skippedCheck(DATABASE_CHECK, 'not-configured'),
      authTablesCheck: skippedAuthTablesCheck(authTables, 'no-database'),
    }
  }
  if (backend === 'postgres') {
    return probePostgres(event, authTables, log)
  }

  // Every other value is D1, the historical default.
  const d1 = (readWorkerRuntimeEnv(event) as { DB?: D1Database }).DB
  return d1 ? probeD1(d1, authTables, log) : reportMissingD1Binding(config, authTables, log)
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
