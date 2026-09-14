/**
 * Health, as something a route handler can return rather than something that
 * throws.
 *
 * Two statements, always: `SELECT 1`, and one extension lookup bound with a
 * single joined-string parameter (see `joinExtensionNames` for why it is not
 * a raw array). The extension check is the half that matters for this estate
 * -- a Postgres that answers `SELECT 1` but has no `timescaledb` is a database
 * the history store cannot use, and the difference between "down" and "up but
 * wrong" is exactly what an operator needs at 3am.
 *
 * `checkHealth` never throws. A connection failure, a timeout, a permission
 * error all come back as `ok: false` with a redacted message, because a health
 * endpoint that throws turns one degraded dependency into a 500 on the page
 * that was supposed to report it.
 */

import { NardukPostgresError } from './errors.js'
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

/**
 * `required.join(',')`, validated.
 *
 * A raw JS array bound as `extname = ANY($1::text[])` is not portable: under
 * an unprepared, simple-protocol connection (`prepare: false` -- what
 * `withHyperdriveConnection` uses, since Hyperdrive terminates and re-pools
 * connections a client-side prepared-statement cache would outlive), the
 * driver cannot type-infer the parameter from a Describe round trip and has
 * been observed to fall back to `Array.prototype.toString()` -- bare
 * comma-joined text, not a `{...}` array literal. PostgreSQL then rejects it
 * with `22P02 malformed array literal` (narduk-libs#304), even though the
 * exact same array works over a prepared connection.
 *
 * A single joined string sidesteps the driver's array encoding entirely --
 * `string_to_array` builds the array server-side instead -- so the lookup
 * behaves identically whether or not the connection prepares statements.
 * Extension names come from caller code, not request input, but a comma in
 * one would silently misparse rather than fail loudly, so it is rejected
 * here instead.
 */
function joinExtensionNames(names: readonly string[]): string {
  for (const name of names) {
    if (name.includes(',')) {
      throw new NardukPostgresError(
        'PROTOCOL_VIOLATION',
        `Required extension name ${JSON.stringify(name)} contains a comma, which the ` +
          `ANY(string_to_array($1, ',')) lookup cannot represent.`,
        { name },
      )
    }
  }
  return names.join(',')
}

export async function checkHealth(
  executor: SqlExecutor,
  options: HealthCheckOptions = {},
): Promise<HealthReport> {
  const now = options.now ?? DEFAULT_NOW
  const required = [...(options.requiredExtensions ?? [])]
  const startedAt = now()
  // Tracks whether `SELECT 1` itself succeeded, so a later statement error
  // (the extension lookup) is reported as a reachable-but-wrong database
  // rather than as an unreachable one -- "down" and "up but wrong" are the
  // distinction an operator needs, and only the connectivity probe can tell
  // them apart.
  let connected = false

  try {
    await executor.query('SELECT 1 AS ok')
    connected = true

    let extensions: ExtensionStatus[] = []
    if (required.length > 0) {
      const result = await executor.query<ExtensionRow>(
        "SELECT extname, extversion FROM pg_extension WHERE extname = ANY(string_to_array($1::text, ','))",
        [joinExtensionNames(required)],
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
