import { describe, expect, it } from 'vitest'

import {
  POSTGRES_ROLES,
  assertPostgresRole,
  isPostgresRole,
  resetRoleStatement,
  roleGrantStatements,
  setRoleStatement,
} from '../src/roles.js'

describe('the three estate roles', () => {
  it('is exactly the set docs/09 fixes', () => {
    expect([...POSTGRES_ROLES]).toEqual(['ingest_writer', 'history_reader', 'ops'])
  })

  it('rejects anything that is not one of them', () => {
    expect(isPostgresRole('postgres')).toBe(false)
    expect(isPostgresRole('ops')).toBe(true)
    expect(() => assertPostgresRole('superuser')).toThrow(/ROLE_UNKNOWN/u)
    expect(() => assertPostgresRole(undefined)).toThrow(/ROLE_UNKNOWN/u)
  })

  // `SET ROLE` has no parameterized form, so the only defence is that caller
  // input can never reach the statement text.
  it('never builds a SET ROLE from unvalidated input', () => {
    expect(setRoleStatement('ingest_writer')).toBe('SET ROLE "ingest_writer"')
    expect(resetRoleStatement()).toBe('RESET ROLE')
    for (const attack of [
      'ops; DROP TABLE telemetry_numeric',
      'ops" ; --',
      'ingest_writer\nSET ROLE postgres',
    ]) {
      expect(() => setRoleStatement(attack as never)).toThrow(/ROLE_UNKNOWN/u)
    }
  })
})

describe('least-privilege grants', () => {
  const spec = {
    ddl: false,
    insert: ['telemetry_numeric', 'series'],
    mutate: [],
    read: ['series'],
  }

  it('gives the ingest writer insert and nothing that erases history', () => {
    const statements = roleGrantStatements('ingest_writer', spec)
    expect(statements).toEqual([
      'GRANT USAGE ON SCHEMA "public" TO "ingest_writer";',
      'GRANT SELECT ON "public"."series" TO "ingest_writer";',
      'GRANT INSERT ON "public"."telemetry_numeric" TO "ingest_writer";',
      'GRANT INSERT ON "public"."series" TO "ingest_writer";',
    ])
    expect(statements.join('\n')).not.toMatch(/DELETE|UPDATE|TRUNCATE|CREATE/u)
  })

  it('gives only the DDL role CREATE on the schema', () => {
    const opsStatements = roleGrantStatements('ops', { ...spec, ddl: true, mutate: ['series'] })
    expect(opsStatements[1]).toBe('GRANT CREATE ON SCHEMA "public" TO "ops";')
    expect(opsStatements.join('\n')).toContain('GRANT UPDATE, DELETE ON "public"."series"')
  })

  it('refuses an identifier that is not plain snake_case', () => {
    expect(() =>
      roleGrantStatements('ops', { ...spec, read: ['series"; DROP TABLE series; --'] }),
    ).toThrow(/ROLE_UNKNOWN/u)
  })
})

describe("role creation is not this library's", () => {
  // narduk-infrastructure#155: the target instance's own provisioning creates
  // the three roles WITH LOGIN and sets their statement_timeout, which needs
  // superuser. A CREATE ROLE / ALTER ROLE helper here would either fail for
  // lack of privilege or silently override the deployment's 60 s with a
  // library default -- so the module exports no such helper.
  it('exports no role-creation or timeout helper', async () => {
    const roles: Record<string, unknown> = await import('../src/roles.js')
    expect(Object.keys(roles)).not.toContain('createRoleStatement')
    expect(Object.keys(roles).filter((key) => /timeout/iu.test(key))).toEqual([])
  })
})
