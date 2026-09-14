/// <reference types="@cloudflare/workers-types" />
import { sql } from 'drizzle-orm'
import { defineEventHandler } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'

import { probeDatabaseConnection } from '../utils/database'
import { useLogger } from '../utils/logger'
import { readWorkerRuntimeEnv } from '../utils/worker-env'

/**
 * Health check endpoint for uptime monitoring and deployment verification.
 *
 * Probes the active database: `databaseBackend: postgres` runs a simple SQL
 * connectivity check via Hyperdrive; otherwise (default D1) checks required
 * auth-related tables exist in the local D1 schema.
 *
 * GET /api/health
 */
const REQUIRED_AUTH_TABLES = ['api_keys', 'sessions', 'users'] as const
const REQUIRED_AUTH_TABLE_SQL = REQUIRED_AUTH_TABLES.map((tableName) => `'${tableName}'`).join(', ')

export default defineEventHandler(async (event) => {
  const log = useLogger(event).child('Health')
  let dbStatus: 'ok' | 'not_available' | 'error' | 'schema_error' = 'not_available'
  let missingAuthTables: string[] = []

  const config = useRuntimeConfig(event)
  const databaseBackend = (config as { databaseBackend?: string }).databaseBackend ?? 'd1'

  try {
    if (databaseBackend === 'postgres') {
      await probeDatabaseConnection(event, sql`select 1`)
      dbStatus = 'ok'
      missingAuthTables = []
    } else {
      const rawEnv = readWorkerRuntimeEnv(event)
      const d1 = (rawEnv as { DB?: D1Database }).DB
      if (d1) {
        const result = await d1
          .prepare(
            `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${REQUIRED_AUTH_TABLE_SQL})`,
          )
          .all<{ name: string }>()
        const existingTables = new Set(result.results.map((row) => row.name))
        missingAuthTables = REQUIRED_AUTH_TABLES.filter(
          (tableName) => !existingTables.has(tableName),
        )
        dbStatus = missingAuthTables.length === 0 ? 'ok' : 'schema_error'

        if (missingAuthTables.length > 0) {
          log.error('Health check DB schema probe failed', { missingAuthTables })
        }
      }
    }
  } catch {
    log.error(
      databaseBackend === 'postgres'
        ? 'Health check Postgres probe failed'
        : 'Health check DB probe failed',
    )
    dbStatus = 'error'
  }

  const status =
    dbStatus === 'ok' ? 'ok' : dbStatus === 'error' ? ('error' as const) : ('degraded' as const)

  return {
    success: true as const,
    data: {
      status,
      timestamp: new Date().toISOString(),
      database: dbStatus,
      missingAuthTables,
    },
  }
})
