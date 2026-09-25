/**
 * The Supabase backend (narduk-libs#112).
 *
 * Supabase is PostgreSQL, so this is not a second client: it is the same
 * `SqlExecutor` seam every other part of the package speaks, opened through the
 * consumer's own driver (postgres.js recommended, exactly as for Hyperdrive).
 * No `@supabase/supabase-js`, no PostgREST, no auth -- nothing is imported, and
 * a call site that takes a `PostgresBackend` does not change when the backend
 * behind it does.
 *
 * What Supabase does differ in is the connection, and that is what this module
 * owns:
 *
 * - **Three connection modes with different guarantees.** A direct connection
 *   (`db.<ref>.supabase.co:5432`) and the Supavisor session pooler
 *   (`*.pooler.supabase.com:5432`) give a real session. Port 6543 (Supavisor or
 *   the dedicated pooler) is transaction mode: a session-scoped
 *   `pg_advisory_lock` (the migration runner's mutual exclusion) and a `SET
 *   ROLE` do not survive past one transaction. The capability matrix says so,
 *   and a role asked for in transaction mode is refused rather than silently
 *   dropped.
 * - **TLS is required.** A connection string with `sslmode=disable` is refused,
 *   and the driver options always carry `ssl`.
 * - **No TimescaleDB.** Supabase deprecated the extension on Postgres 17
 *   projects, so `timescale` is false in every mode; `narduk-timeseries` must
 *   not assume hypertables here.
 */

import type { PostgresBackend, PostgresBackendCapabilities } from './backends.js'
import { NardukPostgresError } from './errors.js'
import { redactConnectionString } from './redact.js'
import {
  type ConnectionTuningOptions,
  NODE_TUNING_DEFAULTS,
  type PostgresJsOptions,
  WORKER_TUNING_DEFAULTS,
  resolveTuning,
  toPostgresJsOptions,
} from './tuning.js'
import type { ManagedConnection, SqlExecutor } from './types.js'

export type SupabaseConnectionMode = 'direct' | 'session' | 'transaction'

export const SUPABASE_TRANSACTION_POOLER_PORT = 6543

export const SUPABASE_CAPABILITIES: Readonly<
  Record<SupabaseConnectionMode, PostgresBackendCapabilities>
> = Object.freeze({
  direct: Object.freeze({ ddl: true, roleSwitching: true, timescale: false }),
  session: Object.freeze({ ddl: true, roleSwitching: true, timescale: false }),
  // Migrations need a session for their advisory lock; run them over a direct
  // or session connection instead.
  transaction: Object.freeze({ ddl: false, roleSwitching: false, timescale: false }),
})

/** postgres.js `ssl` values that encrypt. `verify-full` needs the Supabase CA in the driver. */
export type SupabaseSsl = 'require' | 'verify-ca' | 'verify-full'

export interface SupabasePostgresJsOptions extends PostgresJsOptions {
  ssl: SupabaseSsl
}

export interface SupabaseConnectionInfo {
  host: string
  mode: SupabaseConnectionMode
  port: number
  /** The project ref, from `db.<ref>.supabase.co` or a pooler user `postgres.<ref>`; null if neither names it. */
  projectRef: string | null
}

const DIRECT_HOST = /^db\.([a-z0-9]+)\.supabase\.co$/u
const POOLER_HOST = /\.pooler\.supabase\.com$/u
const POOLER_USER = /^[^.]+\.([a-z0-9]+)$/u
const INSECURE_SSLMODES = new Set(['disable', 'allow', 'prefer'])

function invalid(message: string, connectionString: string): NardukPostgresError {
  return new NardukPostgresError('SUPABASE_CONNECTION_INVALID', message, {
    connectionString: redactConnectionString(connectionString),
  })
}

/**
 * Read a Supabase connection string: which mode it is, and which project.
 *
 * The mode comes from the host and port Supabase publishes. A custom domain or
 * a self-hosted Supabase has neither shape, so `mode` must then be stated.
 */
export function parseSupabaseConnectionString(
  connectionString: string,
  mode?: SupabaseConnectionMode,
): SupabaseConnectionInfo {
  if (typeof connectionString !== 'string' || connectionString.length === 0) {
    throw new NardukPostgresError(
      'CONNECTION_STRING_MISSING',
      'A Supabase connection needs a connection string.',
    )
  }
  let url: URL
  try {
    url = new URL(connectionString)
  } catch {
    throw invalid('The Supabase connection string is not a URL.', connectionString)
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw invalid(
      'The Supabase connection string must use postgres:// or postgresql://.',
      connectionString,
    )
  }
  const sslmode = url.searchParams.get('sslmode')
  if (sslmode !== null && INSECURE_SSLMODES.has(sslmode)) {
    throw invalid(
      `Supabase requires TLS; sslmode=${sslmode} would allow an unencrypted connection.`,
      connectionString,
    )
  }

  const host = url.hostname.toLowerCase()
  const port = url.port === '' ? 5432 : Number(url.port)
  const direct = DIRECT_HOST.exec(host)
  const pooler = POOLER_HOST.test(host)
  let detected: SupabaseConnectionMode | null = null
  if (port === SUPABASE_TRANSACTION_POOLER_PORT && (direct || pooler)) detected = 'transaction'
  else if (pooler) detected = 'session'
  else if (direct) detected = 'direct'

  if (mode !== undefined && detected !== null && mode !== detected) {
    throw invalid(
      `The connection string is a Supabase ${detected} connection, not ${mode}.`,
      connectionString,
    )
  }
  const resolved = mode ?? detected
  if (resolved === null) {
    throw invalid(
      'The host is not a Supabase host (db.<ref>.supabase.co or *.pooler.supabase.com); ' +
        'state the connection mode for a custom domain or a self-hosted Supabase.',
      connectionString,
    )
  }

  const user = decodeURIComponent(url.username)
  const projectRef = direct?.[1] ?? POOLER_USER.exec(user)?.[1] ?? null
  return { host, mode: resolved, port, projectRef }
}

export type SupabaseConnect = (
  connectionString: string,
  options: SupabasePostgresJsOptions,
) => ManagedConnection | Promise<ManagedConnection>

export interface SupabaseBackendOptions {
  connect: SupabaseConnect
  connectionString: string
  /** Required only when the host is not one Supabase publishes. */
  mode?: SupabaseConnectionMode
  /** Tuning defaults, and the Worker six-socket ceiling. Default `node`. */
  runtime?: 'node' | 'worker'
  /** Default `require`. */
  ssl?: SupabaseSsl
  tuning?: ConnectionTuningOptions
}

export interface SupabaseBackend extends PostgresBackend {
  readonly connection: SupabaseConnectionInfo
  readonly driverOptions: SupabasePostgresJsOptions
  readonly kind: 'supabase'
}

/**
 * A `PostgresBackend` for a Supabase project. Each `withConnection` opens one
 * connection through `connect` and closes it afterwards, as the Worker and Node
 * paths do. Validation happens here, before any socket is opened.
 */
export function createSupabaseBackend(options: SupabaseBackendOptions): SupabaseBackend {
  const connection = parseSupabaseConnectionString(options.connectionString, options.mode)
  const capabilities = SUPABASE_CAPABILITIES[connection.mode]
  const tuning = resolveTuning(
    options.tuning,
    options.runtime === 'worker' ? WORKER_TUNING_DEFAULTS : NODE_TUNING_DEFAULTS,
  )
  if (tuning.role !== null && !capabilities.roleSwitching) {
    throw invalid(
      `A ${connection.mode}-mode Supabase connection cannot hold role ${tuning.role}: ` +
        'the pooler does not keep session state between transactions. Use a direct or session connection.',
      options.connectionString,
    )
  }
  const driverOptions: SupabasePostgresJsOptions = Object.freeze({
    ...toPostgresJsOptions(tuning),
    ssl: options.ssl ?? 'require',
  })
  const { connect, connectionString } = options

  return Object.freeze({
    capabilities,
    connection: Object.freeze(connection),
    driverOptions,
    kind: 'supabase' as const,
    async withConnection<T>(use: (executor: SqlExecutor) => Promise<T>): Promise<T> {
      let managed: ManagedConnection
      try {
        managed = await connect(connectionString, { ...driverOptions })
      } catch (cause) {
        throw new NardukPostgresError(
          'SUPABASE_CONNECTION_INVALID',
          'The driver could not open a Supabase connection.',
          { connectionString: redactConnectionString(connectionString), mode: connection.mode },
          { cause },
        )
      }
      let bodyFailed = false
      try {
        return await use(managed)
      } catch (cause) {
        bodyFailed = true
        throw cause
      } finally {
        try {
          await managed.end()
        } catch (closeCause) {
          if (!bodyFailed) throw closeCause
        }
      }
    },
  })
}
