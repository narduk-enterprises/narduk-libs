/**
 * The backend seam.
 *
 * narduk-libs #112 charters this package as the "seamless Supabase and
 * non-Supabase backend" library. Logan's round-20 answer on mybo-at-v2#63
 * activated the non-Supabase half -- a self-hosted PostgreSQL reached from
 * Workers through a Hyperdrive binding -- and his 2026-09-25 answer on #112
 * ("Build Supabase half") activated the other, which lives in `./supabase`.
 *
 * Both halves speak `SqlExecutor` through the consumer's own driver, so
 * everything above this line -- health, migrations, roles, the timeseries
 * builders -- does not know which backend produced the executor. The
 * capability matrix is what differs, and callers that need DDL, `SET ROLE` or
 * TimescaleDB read it instead of the kind.
 */

import type { SqlExecutor } from './types.js'

export type PostgresBackendKind = 'self-hosted' | 'supabase'

export interface PostgresBackendCapabilities {
  /** Whether the backend admits the DDL a migration runner needs. */
  ddl: boolean
  /** Whether `SET ROLE` to the three estate roles is available. */
  roleSwitching: boolean
  /** Whether TimescaleDB hypertables are available. */
  timescale: boolean
}

export interface PostgresBackend {
  readonly capabilities: PostgresBackendCapabilities
  readonly kind: PostgresBackendKind
  withConnection<T>(use: (executor: SqlExecutor) => Promise<T>): Promise<T>
}

export const SELF_HOSTED_CAPABILITIES: PostgresBackendCapabilities = {
  ddl: true,
  roleSwitching: true,
  timescale: true,
}

/**
 * @deprecated The Supabase backend is implemented: see `createSupabaseBackend`
 * and `SUPABASE_CAPABILITIES`. Kept so existing imports still compile.
 */
export const SUPABASE_BACKEND_STATUS =
  'Implemented: createSupabaseBackend (narduk-libs#112).' as const
