/**
 * The Workers connection path: a Hyperdrive binding in, a connection whose
 * lifetime is exactly one invocation out.
 *
 * Two rules are enforced here rather than documented and hoped for.
 *
 * **No client outlives the invocation.** A `postgres()` call at module scope
 * looks like a pool and behaves like a leak: workerd may reuse an isolate
 * across requests, so a socket opened during request 1 can be half-closed,
 * half-reused and entirely unowned by request 2. `withHyperdriveConnection`
 * takes the connect function, gives the caller an executor for the duration of
 * one callback, and closes it in a `finally` -- the connection cannot be
 * captured past the invocation without deliberately doing so.
 *
 * **At most six sockets.** A Worker's outbound TCP connection limit is six, and
 * exceeding it fails the request rather than queueing. `resolveTuning` refuses
 * a `maxConnections` above the ceiling with a named error instead of letting
 * production find it.
 *
 * The driver stays the consumer's. postgres.js is the recommended one behind
 * Hyperdrive -- small enough for a Worker bundle, and `toPostgresJsOptions`
 * shapes the flags Hyperdrive's pooling requires (`prepare: false`,
 * `fetch_types: false`) -- but nothing here imports it.
 */

import { NardukPostgresError } from './errors.js'
import { redactConnectionString, redactErrorCause } from './redact.js'
import {
  type ConnectionTuning,
  type ConnectionTuningOptions,
  type PostgresJsOptions,
  WORKER_TUNING_DEFAULTS,
  resolveTuning,
  toPostgresJsOptions,
} from './tuning.js'
import type { ManagedConnection, SqlExecutor } from './types.js'

/** The shape `env.HISTORY_DB` has: `Hyperdrive` from @cloudflare/workers-types. */
export interface HyperdriveBindingLike {
  connectionString: string
}

export function resolveHyperdriveConnectionString(binding: unknown): string {
  const connectionString = (binding as Partial<HyperdriveBindingLike> | null | undefined)
    ?.connectionString
  if (typeof connectionString !== 'string' || connectionString.length === 0) {
    throw new NardukPostgresError(
      'HYPERDRIVE_BINDING_INVALID',
      'The Hyperdrive binding has no connectionString. Check the binding name in wrangler.jsonc.',
      { received: typeof binding },
    )
  }
  return connectionString
}

export function workerTuning(options: ConnectionTuningOptions = {}): ConnectionTuning {
  return resolveTuning(options, WORKER_TUNING_DEFAULTS)
}

export function workerDriverOptions(options: ConnectionTuningOptions = {}): PostgresJsOptions {
  return toPostgresJsOptions(workerTuning(options))
}

export type WorkerConnect = (
  connectionString: string,
  options: PostgresJsOptions,
) => ManagedConnection | Promise<ManagedConnection>

export interface WorkerConnectionRequest {
  binding: unknown
  connect: WorkerConnect
  options?: ConnectionTuningOptions
}

/**
 * Run `use` with a live connection and close it afterwards, whatever happened.
 *
 * The close failure is deliberately swallowed when the body already threw: the
 * body's error is the one the caller needs, and a driver that fails to end a
 * socket it is about to drop anyway is not the story.
 */
export async function withHyperdriveConnection<T>(
  request: WorkerConnectionRequest,
  use: (executor: SqlExecutor) => Promise<T>,
): Promise<T> {
  const connectionString = resolveHyperdriveConnectionString(request.binding)
  const driverOptions = workerDriverOptions(request.options)

  let connection: ManagedConnection
  try {
    connection = await request.connect(connectionString, driverOptions)
  } catch (cause) {
    throw new NardukPostgresError(
      'HYPERDRIVE_BINDING_INVALID',
      'The driver could not open a connection for the Hyperdrive binding.',
      { connectionString: redactConnectionString(connectionString) },
      { cause: redactErrorCause(cause) },
    )
  }

  let bodyFailed = false
  try {
    return await use(connection)
  } catch (cause) {
    bodyFailed = true
    throw cause
  } finally {
    try {
      await connection.end()
    } catch (closeCause) {
      if (!bodyFailed) throw closeCause
    }
  }
}
