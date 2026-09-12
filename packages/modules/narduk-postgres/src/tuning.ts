/**
 * Connection tuning, stated once and shaped per driver.
 *
 * The numbers that matter behind Hyperdrive are not driver-specific -- a
 * statement timeout, a connection ceiling, an idle window, an application name
 * -- so they are declared once as a `ConnectionTuning` and then rendered into
 * whichever driver's option object the consumer actually constructs. That keeps
 * the *policy* (never more than six sockets from a Worker; every statement has
 * a deadline) in the library while leaving the *driver* to the app.
 */

import { NardukPostgresError } from './errors.js'
import { type PostgresRoleName, assertPostgresRole } from './roles.js'

/**
 * A Worker may hold at most six simultaneous outbound TCP connections. Five is
 * the default ceiling here so an invocation that opens a pool still has one
 * socket left for anything else it does (a subrequest, a second binding).
 */
export const WORKER_CONNECTION_CEILING = 6
export const WORKER_DEFAULT_MAX_CONNECTIONS = 5

export interface ConnectionTuningOptions {
  applicationName?: string
  connectTimeoutSeconds?: number
  idleTimeoutSeconds?: number
  maxConnections?: number
  /**
   * Applied as a startup parameter, so it is in force for the first statement
   * rather than after an extra round trip.
   */
  statementTimeoutMs?: number
  /** Validated against the three known roles; never interpolated from input. */
  role?: PostgresRoleName
}

export interface ConnectionTuning {
  applicationName: string
  connectTimeoutSeconds: number
  idleTimeoutSeconds: number
  maxConnections: number
  role: PostgresRoleName | null
  statementTimeoutMs: number
}

export const WORKER_TUNING_DEFAULTS: ConnectionTuning = {
  applicationName: 'narduk-postgres-worker',
  connectTimeoutSeconds: 10,
  // Hyperdrive already pools on its side; a Worker's own client should let an
  // idle socket go well inside the invocation's lifetime.
  idleTimeoutSeconds: 20,
  maxConnections: WORKER_DEFAULT_MAX_CONNECTIONS,
  role: null,
  statementTimeoutMs: 15_000,
}

export const NODE_TUNING_DEFAULTS: ConnectionTuning = {
  applicationName: 'narduk-postgres-node',
  connectTimeoutSeconds: 15,
  idleTimeoutSeconds: 30,
  maxConnections: 4,
  role: null,
  // A migration or a retention sweep is legitimately slower than a request.
  statementTimeoutMs: 300_000,
}

function assertPositiveInteger(label: string, value: number, max?: number): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new NardukPostgresError('TUNING_INVALID', `${label} must be a positive integer.`, {
      label,
      value,
    })
  }
  if (max !== undefined && value > max) {
    throw new NardukPostgresError('TUNING_INVALID', `${label} must not exceed ${max}.`, {
      label,
      max,
      value,
    })
  }
  return value
}

export function resolveTuning(
  options: ConnectionTuningOptions = {},
  defaults: ConnectionTuning = WORKER_TUNING_DEFAULTS,
): ConnectionTuning {
  const maxConnections = options.maxConnections ?? defaults.maxConnections
  if (defaults === WORKER_TUNING_DEFAULTS && maxConnections > WORKER_CONNECTION_CEILING) {
    throw new NardukPostgresError(
      'CONNECTION_LIMIT_EXCEEDED',
      `A Worker may hold at most ${WORKER_CONNECTION_CEILING} simultaneous outbound connections.`,
      { ceiling: WORKER_CONNECTION_CEILING, maxConnections },
    )
  }

  return {
    applicationName: options.applicationName ?? defaults.applicationName,
    connectTimeoutSeconds: assertPositiveInteger(
      'connectTimeoutSeconds',
      options.connectTimeoutSeconds ?? defaults.connectTimeoutSeconds,
    ),
    idleTimeoutSeconds: assertPositiveInteger(
      'idleTimeoutSeconds',
      options.idleTimeoutSeconds ?? defaults.idleTimeoutSeconds,
    ),
    maxConnections: assertPositiveInteger('maxConnections', maxConnections, 64),
    role: options.role === undefined ? defaults.role : assertPostgresRole(options.role),
    statementTimeoutMs: assertPositiveInteger(
      'statementTimeoutMs',
      options.statementTimeoutMs ?? defaults.statementTimeoutMs,
    ),
  }
}

/** Startup parameters both drivers pass through to the server unchanged. */
export function startupParameters(tuning: ConnectionTuning): Record<string, string> {
  const parameters: Record<string, string> = {
    application_name: tuning.applicationName,
    statement_timeout: String(tuning.statementTimeoutMs),
  }
  if (tuning.role) parameters.role = tuning.role
  return parameters
}

export interface PostgresJsOptions {
  connect_timeout: number
  connection: Record<string, string>
  /**
   * Hyperdrive terminates and re-pools connections, so a client-side prepared
   * statement cache can address a statement the server no longer has. Both
   * flags are off for that reason, not for performance.
   */
  fetch_types: boolean
  idle_timeout: number
  max: number
  prepare: boolean
}

export function toPostgresJsOptions(tuning: ConnectionTuning): PostgresJsOptions {
  return {
    connect_timeout: tuning.connectTimeoutSeconds,
    connection: startupParameters(tuning),
    fetch_types: false,
    idle_timeout: tuning.idleTimeoutSeconds,
    max: tuning.maxConnections,
    prepare: false,
  }
}

export interface NodePostgresOptions {
  application_name: string
  connectionTimeoutMillis: number
  idleTimeoutMillis: number
  max: number
  /** libpq-style startup options; `role` is included only when tuned. */
  options: string
  statement_timeout: number
}

export function toNodePostgresOptions(tuning: ConnectionTuning): NodePostgresOptions {
  const parameters = startupParameters(tuning)
  return {
    application_name: tuning.applicationName,
    connectionTimeoutMillis: tuning.connectTimeoutSeconds * 1000,
    idleTimeoutMillis: tuning.idleTimeoutSeconds * 1000,
    max: tuning.maxConnections,
    options: Object.entries(parameters)
      .map(([key, value]) => `-c ${key}=${value}`)
      .join(' '),
    statement_timeout: tuning.statementTimeoutMs,
  }
}
