/**
 * The backend seam.
 *
 * narduk-libs #112 charters this package as the "seamless Supabase and
 * non-Supabase backend" library. Logan's round-20 answer on mybo-at-v2#63
 * activated the non-Supabase half -- a self-hosted PostgreSQL reached from
 * Workers through a Hyperdrive binding -- and said nothing about the other. So
 * the Supabase backend is a named shape here and nothing more: no client, no
 * auth, no PostgREST, no dependency.
 *
 * That is deliberate. A half-built Supabase path would be a second connection
 * story every consumer has to read, for a backend no product on this estate has
 * asked for yet. The interface exists so adding one later is an implementation
 * rather than a redesign: everything above this line -- health, migrations,
 * roles, the timeseries builders -- already speaks `SqlExecutor` and does not
 * know which backend produced it.
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

// TODO(#112): implement the Supabase backend (connection, pooler mode, and the
// capability matrix above) when a product on this estate needs it. Until then
// `PostgresBackend` is the whole of the seam and `self-hosted` is the only kind
// any factory here returns.
export const SUPABASE_BACKEND_STATUS =
  'Charter item in narduk-libs#112; not implemented in 0.1.0.' as const
