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
  /** Tables the role may UPDATE or DELETE. */
  mutate: readonly string[]
  /** Sequences whose nextval the role needs (identity columns). */
  sequences: readonly string[]
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
 * UPDATE, DELETE or TRUNCATE on a hypertable, so a compromised ingest path can
 * add wrong history but cannot erase the right history; `history_reader` gets
 * SELECT and nothing else; only `ops` runs DDL.
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
  for (const table of spec.mutate) {
    statements.push(
      `GRANT UPDATE, DELETE ON ${quotedSchema}.${quoteIdentifier(table)} TO ${quotedRole};`,
    )
  }
  for (const sequence of spec.sequences) {
    statements.push(
      `GRANT USAGE, SELECT ON SEQUENCE ${quotedSchema}.${quoteIdentifier(sequence)} TO ${quotedRole};`,
    )
  }
  return statements
}

/**
 * `CREATE ROLE ... NOLOGIN`, idempotently.
 *
 * These are group roles with no password and no login. An operator creates the
 * login user that Hyperdrive or the deploy job authenticates as, then grants it
 * membership -- so no migration file, and nothing in this repository, ever holds
 * a credential.
 */
export function createRoleStatement(role: PostgresRoleName, statementTimeout?: string): string {
  assertPostgresRole(role)
  const lines = [
    'DO $$',
    'BEGIN',
    `  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN`,
    `    CREATE ROLE "${role}" NOLOGIN;`,
    '  END IF;',
    'END',
    '$$;',
  ]
  if (statementTimeout) {
    // An interval literal, not a parameter: validate its exact shape rather
    // than trusting a caller-supplied string into DDL.
    if (!/^\d+(?:ms|s|min)$/u.test(statementTimeout)) {
      throw new NardukPostgresError(
        'TUNING_INVALID',
        'statementTimeout must look like 15000ms, 15s or 5min.',
        { statementTimeout },
      )
    }
    lines.push(`ALTER ROLE "${role}" SET statement_timeout = '${statementTimeout}';`)
  }
  return lines.join('\n')
}
