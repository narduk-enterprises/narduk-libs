/**
 * The three database roles docs/09 fixes for this estate's Postgres:
 * `ingest_writer`, `history_reader`, `ops`.
 *
 * `SET ROLE` takes an identifier, not a parameter -- there is no `$1` form of
 * it -- so the only safe construction is one that never sees caller input in
 * the first place. `setRoleStatement` accepts nothing but a member of the
 * frozen tuple below, and `assertPostgresRole` is the single gate; a value that
 * arrived from a request body, a JWT claim or a config file fails there rather
 * than reaching the statement text.
 *
 * **Creating the roles is not this library's job.** The target instance's own
 * provisioning creates `ingest_writer` / `history_reader` / `ops` and sets their
 * role-level `statement_timeout` (narduk-infrastructure#155), which needs
 * superuser; a migration that re-issued `CREATE ROLE` or `ALTER ROLE ... SET
 * statement_timeout` would either fail for lack of privilege or quietly
 * override the deployment's timeout with a library default. What this module
 * owns is the GRANT matrix -- which is also what generates
 * `0003_history_roles.sql` in narduk-timeseries, asserted there by a test, so
 * the two can never drift.
 */

import { NardukPostgresError } from './errors.js'

export const POSTGRES_ROLES = ['ingest_writer', 'history_reader', 'ops'] as const

export type PostgresRoleName = (typeof POSTGRES_ROLES)[number]

export function isPostgresRole(value: unknown): value is PostgresRoleName {
  return typeof value === 'string' && (POSTGRES_ROLES as readonly string[]).includes(value)
}

export function assertPostgresRole(value: unknown): PostgresRoleName {
  if (!isPostgresRole(value)) {
    throw new NardukPostgresError(
      'ROLE_UNKNOWN',
      `Unknown database role. Expected one of: ${POSTGRES_ROLES.join(', ')}.`,
      { known: [...POSTGRES_ROLES] },
    )
  }
  return value
}

export function setRoleStatement(role: PostgresRoleName): string {
  return `SET ROLE "${assertPostgresRole(role)}"`
}

export function resetRoleStatement(): string {
  return 'RESET ROLE'
}

export interface RolePrivilegeSpec {
  /** Tables and hypertables the role may read. */
  read: readonly string[]
  /** Tables the role may INSERT into. */
  insert: readonly string[]
  /**
   * Tables the role may UPDATE but NOT delete from.
   *
   * This shape exists because `INSERT ... ON CONFLICT ... DO UPDATE` needs the
   * UPDATE privilege at parse time, unconditionally -- the planner does not
   * wait to see whether a conflict occurs. A writer that upserts a dimension
   * row therefore needs UPDATE on that one table, and giving it DELETE as well
   * (the `mutate` shape) would hand it the ability to erase the history it is
   * only supposed to append to.
   */
  update: readonly string[]
  /** Tables the role may UPDATE or DELETE. */
  mutate: readonly string[]
  /** True only for a role that runs DDL: migrations, retention, compression. */
  ddl: boolean
}

export type RolePrivileges = Readonly<Record<PostgresRoleName, RolePrivilegeSpec>>

function quoteIdentifier(identifier: string): string {
  if (!/^[a-z_][a-z0-9_]*$/u.test(identifier)) {
    throw new NardukPostgresError(
      'ROLE_UNKNOWN',
      'Identifiers in a grant specification must be lowercase snake_case.',
      { identifier },
    )
  }
  return `"${identifier}"`
}

/**
 * The GRANT statements for one role, in a fixed order so a migration file built
 * from them is byte-stable and a snapshot test means something.
 *
 * Least privilege is expressed by what is absent: `ingest_writer` never gets
 * DELETE or TRUNCATE anywhere and never gets UPDATE on a hypertable, so a
 * compromised ingest path can add wrong history but cannot erase the right
 * history; `history_reader` gets SELECT and nothing else; only `ops` runs DDL.
 * `update` and `mutate` are separate lists precisely so an upserting writer can
 * be given UPDATE on one dimension table without also being given DELETE.
 */
export function roleGrantStatements(
  role: PostgresRoleName,
  spec: RolePrivilegeSpec,
  schema = 'public',
): string[] {
  assertPostgresRole(role)
  const quotedRole = quoteIdentifier(role)
  const quotedSchema = quoteIdentifier(schema)
  const statements: string[] = [`GRANT USAGE ON SCHEMA ${quotedSchema} TO ${quotedRole};`]

  if (spec.ddl) statements.push(`GRANT CREATE ON SCHEMA ${quotedSchema} TO ${quotedRole};`)

  for (const table of spec.read) {
    statements.push(`GRANT SELECT ON ${quotedSchema}.${quoteIdentifier(table)} TO ${quotedRole};`)
  }
  for (const table of spec.insert) {
    statements.push(`GRANT INSERT ON ${quotedSchema}.${quoteIdentifier(table)} TO ${quotedRole};`)
  }
  for (const table of spec.update) {
    statements.push(`GRANT UPDATE ON ${quotedSchema}.${quoteIdentifier(table)} TO ${quotedRole};`)
  }
  for (const table of spec.mutate) {
    statements.push(
      `GRANT UPDATE, DELETE ON ${quotedSchema}.${quoteIdentifier(table)} TO ${quotedRole};`,
    )
  }
  return statements
}
