/**
 * The history schema's GRANT matrix, as data.
 *
 * `0003_history_roles.sql` is generated from this constant, and
 * `tests/migrations.test.ts` asserts that the file's executable lines are
 * exactly what `historyRoleGrantStatements()` emits. That assertion is the
 * whole point: before it existed the library exported a grant builder and the
 * migration carried a hand-written copy of the same matrix, with nothing
 * reporting a disagreement between them.
 *
 * **Role creation and role-level timeouts are not here, and not in 0003.** The
 * target instance's own provisioning creates `ingest_writer`,
 * `history_reader` and `ops` WITH LOGIN and sets their `statement_timeout`
 * (narduk-infrastructure#155); both need superuser, and a migration that
 * re-issued them would either fail for lack of privilege or silently replace
 * the deployment's timeout with a library default.
 */

import {
  POSTGRES_ROLES,
  roleGrantStatements,
  type PostgresRoleName,
  type RolePrivilegeSpec,
} from '@narduk-enterprises/narduk-postgres'

import { ROLLUP_BUCKETS } from '../types.js'
import {
  AIS_CONTACT_TABLE,
  AIS_ENCOUNTER_OPEN_TABLE,
  AIS_ENCOUNTER_TABLE,
  NUMERIC_TABLE,
  SERIES_TABLE,
  STATE_TABLE,
  TIME_WEIGHTED_TABLE,
  TRACK_TABLE,
  rollupTable,
} from './tables.js'

const ROLLUP_VIEWS: readonly string[] = ROLLUP_BUCKETS.map((bucket) => rollupTable(bucket))

/**
 * Least privilege expressed by what is absent.
 *
 *  - `ingest_writer` gets INSERT everywhere it writes, UPDATE on `series`
 *    alone, and no DELETE or TRUNCATE anywhere -- so a compromised ingest path
 *    can add wrong history but cannot erase the right history. The `series`
 *    UPDATE is not optional: `resolveSeries` upserts the descriptor with
 *    `INSERT ... ON CONFLICT (vessel_id, path) DO UPDATE`, and PostgreSQL
 *    requires the UPDATE privilege to PARSE that statement whether or not a
 *    row ever conflicts. Without it every resolve -- and therefore every
 *    numeric write -- fails with `permission denied for table series`.
 *    `series` is a dimension table: the worst an UPDATE there can do is
 *    rewrite a unit string, which is why the conflict action is
 *    `unit = COALESCE(EXCLUDED.unit, series.unit)` and touches nothing else.
 *    No hypertable gets UPDATE.
 *  - `history_reader` gets SELECT on the tables and the four rollup views and
 *    nothing else. The read path in a Worker uses this role.
 *  - `ops` runs migrations and retention: DDL plus row mutation on the three
 *    base tables. It gets SELECT but *not* DELETE on the continuous
 *    aggregates -- rollup retention is a time-based `drop_chunks` on the
 *    materialization hypertable, which is an owner operation, and a DELETE
 *    grant on the view would only have looked like the thing doing the work.
 */
export const HISTORY_ROLE_PRIVILEGES: Readonly<Record<PostgresRoleName, RolePrivilegeSpec>> =
  Object.freeze({
    history_reader: {
      ddl: false,
      insert: [],
      mutate: [],
      read: [SERIES_TABLE, NUMERIC_TABLE, TRACK_TABLE, ...ROLLUP_VIEWS],
      update: [],
    },
    ingest_writer: {
      ddl: false,
      insert: [SERIES_TABLE, NUMERIC_TABLE, TRACK_TABLE],
      mutate: [],
      read: [SERIES_TABLE],
      update: [SERIES_TABLE],
    },
    ops: {
      ddl: true,
      insert: [SERIES_TABLE, NUMERIC_TABLE, TRACK_TABLE],
      mutate: [SERIES_TABLE, NUMERIC_TABLE, TRACK_TABLE],
      read: [SERIES_TABLE, NUMERIC_TABLE, TRACK_TABLE, ...ROLLUP_VIEWS],
      update: [],
    },
  })

/**
 * The grants for the tables migrations 0004-0006 add, as data.
 *
 * `0007_history_roles_additions.sql` is generated from this constant the way
 * 0003 is from `HISTORY_ROLE_PRIVILEGES`, and `tests/migrations.test.ts`
 * asserts the two agree. It is a second matrix, not an edit of the first,
 * because 0003 is applied and immutable: its bytes are what its checksum says.
 *
 *  - `ingest_writer` INSERTs `telemetry_state` and nothing more there -- no
 *    UPDATE and no DELETE on a captured change, as on the other hypertables.
 *    The AIS tables are DERIVED by the encounter builder in the consumer, so
 *    it may upsert `ais_contact` and `ais_encounter` (UPDATE, no DELETE) and
 *    fully mutate `ais_encounter_open`, a working table whose rows are deleted
 *    when an encounter closes and which holds no captured change. It reads
 *    the three AIS tables because an upsert's `DO UPDATE` reads the row it
 *    updates. It gets nothing on `telemetry_numeric_tw`: the time-weighted
 *    refresh reads raw, which the writer cannot, and runs as `ops`.
 *  - `history_reader` gets SELECT on every new table.
 *  - `ops` gets SELECT, INSERT, UPDATE and DELETE on every new table: it runs
 *    the time-weighted refresh (an upsert) and any repair.
 */
const ADDED_TABLES: readonly string[] = [
  STATE_TABLE,
  TIME_WEIGHTED_TABLE,
  AIS_CONTACT_TABLE,
  AIS_ENCOUNTER_TABLE,
  AIS_ENCOUNTER_OPEN_TABLE,
]

export const HISTORY_ROLE_PRIVILEGE_ADDITIONS: Readonly<
  Record<PostgresRoleName, RolePrivilegeSpec>
> = Object.freeze({
  history_reader: {
    ddl: false,
    insert: [],
    mutate: [],
    read: ADDED_TABLES,
    update: [],
  },
  ingest_writer: {
    ddl: false,
    insert: [STATE_TABLE, AIS_CONTACT_TABLE, AIS_ENCOUNTER_TABLE, AIS_ENCOUNTER_OPEN_TABLE],
    mutate: [AIS_ENCOUNTER_OPEN_TABLE],
    read: [AIS_CONTACT_TABLE, AIS_ENCOUNTER_TABLE, AIS_ENCOUNTER_OPEN_TABLE],
    update: [AIS_CONTACT_TABLE, AIS_ENCOUNTER_TABLE],
  },
  ops: {
    ddl: true,
    insert: ADDED_TABLES,
    mutate: ADDED_TABLES,
    read: ADDED_TABLES,
    update: [],
  },
})

/** Every GRANT `0007_history_roles_additions.sql` contains, in file order. */
export function historyRoleAdditionGrantStatements(schema = 'public'): string[] {
  return POSTGRES_ROLES.flatMap((role) =>
    roleGrantStatements(role, HISTORY_ROLE_PRIVILEGE_ADDITIONS[role], schema),
  )
}

/**
 * Every GRANT `0003_history_roles.sql` contains, in file order.
 *
 * Role order is `POSTGRES_ROLES` and statement order is
 * `roleGrantStatements`, so the output is byte-stable and the migration
 * generated from it has a stable checksum.
 */
export function historyRoleGrantStatements(schema = 'public'): string[] {
  return POSTGRES_ROLES.flatMap((role) =>
    roleGrantStatements(role, HISTORY_ROLE_PRIVILEGES[role], schema),
  )
}
