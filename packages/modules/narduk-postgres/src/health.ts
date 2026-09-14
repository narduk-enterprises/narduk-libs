/**
 * Health, as something a route handler can return rather than something that
 * throws.
 *
 * Two statements, always: `SELECT 1`, and one extension lookup with a single
 * array parameter. The extension check is the half that matters for this
 * estate -- a Postgres that answers `SELECT 1` but has no `timescaledb` is a
 * database the history store cannot use, and the difference between "down" and
 * "up but wrong" is exactly what an operator needs at 3am.
 *
 * `checkHealth` never throws. A connection failure, a timeout, a permission
 * error all come back as `ok: false` with a redacted message, because a health
 * endpoint that throws turns one degraded dependency into a 500 on the page
 * that was supposed to report it.
 */

import { placeholderTuples } from './parameters.js'
import { redactSecrets } from './redact.js'
import type { SqlExecutor } from './types.js'

export interface ExtensionStatus {
  installed: boolean
  name: string
  version: string | null
}

export interface HealthReport {
  connected: boolean
  extensions: ExtensionStatus[]
  error: { code: string; message: string } | null
  latencyMs: number
  missingExtensions: string[]
  ok: boolean
}

export interface HealthCheckOptions {
  /** Extensions that must be present for `ok` to be true. */
  requiredExtensions?: readonly string[]
  /** Injected for deterministic tests; defaults to a monotonic clock. */
  now?: () => number
}

const DEFAULT_NOW = (): number =>
  typeof performance === 'undefined' ? Date.now() : performance.now()

interface ExtensionRow {
  extname: string
  extversion: string | null
}

function describeError(cause: unknown): { code: string; message: string } {
  if (cause instanceof Error) {
    const code = (cause as { code?: unknown }).code
    return {
      code: typeof code === 'string' ? code : 'UNKNOWN',
      // A driver puts the DSN into its connection errors. Redact before the
      // message reaches a report a caller may log or serve.
      message: redactSecrets(cause.message),
    }
  }
  return { code: 'UNKNOWN', message: 'The health check failed.' }
}

export async function checkHealth(
  executor: SqlExecutor,
  options: HealthCheckOptions = {},
): Promise<HealthReport> {
  const now = options.now ?? DEFAULT_NOW
  const required = [...(options.requiredExtensions ?? [])]
  const startedAt = now()
  let connected = false

  try {
    await executor.query('SELECT 1 AS ok')
    connected = true

    let extensions: ExtensionStatus[] = []
    if (required.length > 0) {
      const result = await executor.query<ExtensionRow>(
        // postgres.js prepare:false sends bare arrays as comma-joined text.
        // Scalar binds work without array type discovery or literal escaping.
        `SELECT extname, extversion FROM pg_extension WHERE extname IN ${placeholderTuples(1, required.length)}`,
        required,
      )
      const found = new Map(result.rows.map((row) => [row.extname, row.extversion ?? null]))
      extensions = required.map((name) => ({
        installed: found.has(name),
        name,
        version: found.get(name) ?? null,
      }))
    }

    const missingExtensions = extensions
      .filter((extension) => !extension.installed)
      .map((extension) => extension.name)

    return {
      connected: true,
      error: null,
      extensions,
      latencyMs: Math.max(0, Math.round(now() - startedAt)),
      missingExtensions,
      ok: missingExtensions.length === 0,
    }
  } catch (cause) {
    return {
      connected,
      error: describeError(cause),
      extensions: required.map((name) => ({ installed: false, name, version: null })),
      latencyMs: Math.max(0, Math.round(now() - startedAt)),
      missingExtensions: required,
      ok: false,
    }
  }
}
