import { defineEventHandler, setHeader, setResponseStatus } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'

import {
  buildHealthReport,
  HEALTH_ERROR_STATUS_CODE,
  type HealthReportConfig,
} from '../health/report'
import { useLogger } from '../utils/logger'

/**
 * Health endpoint for uptime monitoring and deployment verification.
 *
 * GET /api/health returns
 * `{ success: true, data: { status, timestamp, database, missingAuthTables, checks } }`.
 *
 * - `status` is `ok`; `degraded` (HTTP 200) when an optional check failed; or
 *   `error` (HTTP 503) when a required check failed. A monitor matching
 *   `"status":"ok"` reads `degraded` as down, so to the estate detector it
 *   pages exactly like `error`; only the HTTP code differs.
 * - `database` follows `databaseBackend`: `not_applicable` for `'none'`;
 *   otherwise `ok`, `error`, `not_available` (no D1 `DB` binding) or
 *   `schema_error` (narduk-auth tables missing). A missing binding is an
 *   error only for an app that declared its backend.
 * - `missingAuthTables` names the absent narduk-auth tables.
 * - `checks` lists the built-in `database` and `auth-tables` probes, then each
 *   check registered with `registerHealthCheck`, as
 *   `{ name, required, result: 'pass' | 'fail' | 'skipped', ... }`. A check
 *   registered through a core helper also carries a stable `kind` — today only
 *   `registerFreshnessCheck`'s `'freshness'` — so a detector can select a
 *   family of checks without knowing app-chosen names.
 * - `required` on a failing entry is that failure's own rollup contribution. A
 *   freshness check with `failAfter` declares `required: true` but publishes
 *   `required: false` while it is merely stale, so an old feed makes the report
 *   `degraded` (HTTP 200) rather than `error` (HTTP 503). An entry carrying
 *   `notice: true` failed at `notice` severity and is left out of `status`
 *   entirely (narduk-libs#414).
 *
 * The auth-table probe runs only when narduk-auth is installed; otherwise D1
 * gets a plain `SELECT 1`. Failure text is fixed and the causes are logged.
 * `status` and `database` precede `checks`, and check details cannot contain
 * those keys, so a monitor matching `"status":"ok"` sees only the real result.
 */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event) as HealthReportConfig
  const report = await buildHealthReport(event, config, useLogger(event).child('Health'))

  setHeader(event, 'Cache-Control', 'no-store')
  if (report.status === 'error') {
    setResponseStatus(event, HEALTH_ERROR_STATUS_CODE)
  }
  return { success: true as const, data: report }
})
