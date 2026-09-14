/**
 * The direct-connection path: migrations, retention sweeps, seed jobs, the
 * integration suite -- anything that runs on Node rather than in a Worker.
 *
 * This is also where the filesystem lives. `loadMigrationsFromDirectory` is the
 * only function in the package that reads a file, which is what keeps
 * `./migrate` importable into a Worker bundle.
 */

import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { NardukPostgresError } from './errors.js'
import { MIGRATION_NAME_PATTERN, type Migration, createMigrationSet } from './migrate.js'
import { redactConnectionString } from './redact.js'
import {
  type ConnectionTuning,
  type ConnectionTuningOptions,
  NODE_TUNING_DEFAULTS,
  type NodePostgresOptions,
  resolveTuning,
  toNodePostgresOptions,
} from './tuning.js'
import type { ManagedConnection, SqlExecutor } from './types.js'

export function nodeTuning(options: ConnectionTuningOptions = {}): ConnectionTuning {
  return resolveTuning(options, NODE_TUNING_DEFAULTS)
}

export function nodeDriverOptions(options: ConnectionTuningOptions = {}): NodePostgresOptions {
  return toNodePostgresOptions(nodeTuning(options))
}

/**
 * Migration tuning: one connection, always.
 *
 * `pg_advisory_lock` is session-scoped, so a pool silently breaks the mutual
 * exclusion the runner depends on. This pins `maxConnections` to 1 and ignores
 * any attempt to raise it, rather than trusting every caller to remember.
 */
export function migrationDriverOptions(options: ConnectionTuningOptions = {}): NodePostgresOptions {
  return toNodePostgresOptions(nodeTuning({ ...options, maxConnections: 1 }))
}

export type NodeConnect = (
  connectionString: string,
  options: NodePostgresOptions,
) => ManagedConnection | Promise<ManagedConnection>

export interface NodeConnectionRequest {
  connect: NodeConnect
  connectionString: string
  options?: ConnectionTuningOptions
  /** Pin the connection to one socket (migrations). Defaults to false. */
  singleConnection?: boolean
}

export async function withNodeConnection<T>(
  request: NodeConnectionRequest,
  use: (executor: SqlExecutor) => Promise<T>,
): Promise<T> {
  if (typeof request.connectionString !== 'string' || request.connectionString.length === 0) {
    throw new NardukPostgresError(
      'CONNECTION_STRING_MISSING',
      'A direct Node connection needs a connection string.',
    )
  }

  const driverOptions =
    request.singleConnection === true
      ? migrationDriverOptions(request.options)
      : nodeDriverOptions(request.options)

  let connection: ManagedConnection
  try {
    connection = await request.connect(request.connectionString, driverOptions)
  } catch (cause) {
    throw new NardukPostgresError(
      'CONNECTION_STRING_MISSING',
      'The driver could not open a direct connection.',
      { connectionString: redactConnectionString(request.connectionString) },
      { cause },
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

/**
 * Read `NNNN_name.sql` files from a directory, in name order.
 *
 * A file that does not match the naming pattern is an error, not a skip: a
 * `0003_thing.sql.bak` left behind by an editor is exactly the case where
 * silently ignoring it means a migration nobody notices is missing.
 */
export async function loadMigrationsFromDirectory(directory: string | URL): Promise<Migration[]> {
  const path = typeof directory === 'string' ? directory : fileURLToPath(directory)
  const entries = await readdir(path, { withFileTypes: true })
  const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name)

  for (const file of files) {
    if (!MIGRATION_NAME_PATTERN.test(file)) {
      throw new NardukPostgresError(
        'MIGRATION_NAME_INVALID',
        `${file} is in the migrations directory but is not a migration. Move it out, or rename it to NNNN_lower_snake_case.sql.`,
        { directory: path, name: file },
      )
    }
  }

  const sources = await Promise.all(
    files
      .sort((left, right) => left.localeCompare(right))
      .map(async (name) => ({ name, sql: await readFile(join(path, name), 'utf8') })),
  )
  return createMigrationSet(sources)
}
