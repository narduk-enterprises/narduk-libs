import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import * as schema from '../server/database/tenancy-schema'
import { TENANCY_ROLES } from '../shared/utils/roles'

import { createTestHarness, MIGRATION_PATH } from './support/database'

const migration = readFileSync(MIGRATION_PATH, 'utf8')
const statements = migration
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n')

const ROLE_COLUMNS = [
  ['tenancy_memberships', schema.tenancyMemberships.role],
  ['tenancy_resource_role_overrides', schema.tenancyResourceRoleOverrides.role],
  ['tenancy_invites', schema.tenancyInvites.role],
] as const

describe('tenancy schema/migration parity', () => {
  it('narrows every role column to exactly the values the CHECK constraints enforce', () => {
    const checks = [...statements.matchAll(/role TEXT NOT NULL CHECK \(role IN \(([^)]+)\)\)/gu)]
    expect(checks).toHaveLength(ROLE_COLUMNS.length)

    for (const check of checks) {
      const migrationValues = [...(check[1] ?? '').matchAll(/'([^']+)'/gu)].map((match) => match[1])
      expect(migrationValues).toEqual([...TENANCY_ROLES])
    }

    for (const [, column] of ROLE_COLUMNS) {
      expect(column.enumValues).toEqual([...TENANCY_ROLES])
    }
  })

  it('creates exactly the tables the drizzle schema declares', () => {
    const created = [...statements.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/gu)].map(
      (match) => match[1],
    )
    const declared = [
      'tenancy_orgs',
      'tenancy_memberships',
      'tenancy_resource_role_overrides',
      'tenancy_invites',
      'tenancy_support_grants',
      'tenancy_audit_events',
    ]
    expect([...created].sort()).toEqual([...declared].sort())
  })

  it('stays additive and D1-only', () => {
    expect(statements.match(/CREATE TABLE IF NOT EXISTS/gu)).toHaveLength(6)
    expect(statements).not.toMatch(/DROP TABLE/iu)
    expect(statements).not.toMatch(/ALTER TABLE/iu)
    expect(statements).not.toMatch(/\bSERIAL\b|\bJSONB\b|\bBOOLEAN\b|\bTIMESTAMPTZ\b/iu)
    // Every CREATE INDEX is guarded too, so re-running the migration is safe.
    const indexes = statements.match(/CREATE (?:UNIQUE )?INDEX/gu) ?? []
    const guarded = statements.match(/CREATE (?:UNIQUE )?INDEX IF NOT EXISTS/gu) ?? []
    expect(guarded).toHaveLength(indexes.length)
  })

  it('declares no foreign key outside this package', () => {
    const references = [...statements.matchAll(/REFERENCES (\w+)\(/gu)].map((match) => match[1])
    expect(new Set(references)).toEqual(new Set(['tenancy_orgs']))
    expect(statements).not.toMatch(/REFERENCES users\(/iu)
  })

  it('applies cleanly twice against real SQLite', () => {
    const { sqlite } = createTestHarness()
    expect(() => sqlite.exec(migration)).not.toThrow()

    const tables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'tenancy_%'")
      .all() as Array<{ name: string }>
    expect(tables).toHaveLength(6)
  })

  it('rejects a role the CHECK constraint does not allow', () => {
    const { sqlite } = createTestHarness()
    sqlite
      .prepare('INSERT INTO tenancy_orgs VALUES (?, ?, ?, ?, ?, ?)')
      .run('org-x', 'acme', 'Acme', 'user-1', 1, 1)
    expect(() =>
      sqlite
        .prepare('INSERT INTO tenancy_memberships VALUES (?, ?, ?, ?, ?, ?)')
        .run('m-1', 'org-x', 'user-1', 'support', 1, 1),
    ).toThrow(/CHECK constraint failed/u)
  })
})
