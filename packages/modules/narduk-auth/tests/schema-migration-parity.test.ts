import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import * as sqliteSchema from '../server/database/auth-bridge-schema'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

describe('auth bridge schema migration parity', () => {
  it('narrows auth_email_links.purpose to the values the migration CHECK enforces', () => {
    const migration = readFileSync(join(packageRoot, 'drizzle/0002_local_email_auth.sql'), 'utf8')
    const check = /CHECK \(purpose IN \(([^)]+)\)\)/u.exec(migration)
    expect(check).not.toBeNull()
    const migrationValues = [...(check?.[1] ?? '').matchAll(/'([^']+)'/gu)].map((match) => match[1])

    expect(migrationValues).toEqual(['setup', 'reset'])
    expect(sqliteSchema.authEmailLinks.purpose.enumValues).toEqual(migrationValues)
  })

  it('narrows auth_webauthn_challenges.purpose to the values the migration CHECK enforces', () => {
    const migration = readFileSync(
      join(packageRoot, 'drizzle/0003_webauthn_credentials.sql'),
      'utf8',
    )
    const check = /purpose TEXT NOT NULL CHECK \(purpose IN \(([^)]+)\)\)/u.exec(migration)
    expect(check).not.toBeNull()
    const migrationValues = [...(check?.[1] ?? '').matchAll(/'([^']+)'/gu)].map((match) => match[1])

    expect(migrationValues).toEqual(['registration', 'authentication'])
    expect(sqliteSchema.authWebauthnChallenges.purpose.enumValues).toEqual(migrationValues)
  })

  it('narrows auth_webauthn_credentials.device_type to the values the migration CHECK enforces', () => {
    const migration = readFileSync(
      join(packageRoot, 'drizzle/0003_webauthn_credentials.sql'),
      'utf8',
    )
    const check = /device_type IN \(([^)]+)\)/u.exec(migration)
    expect(check).not.toBeNull()
    const migrationValues = [...(check?.[1] ?? '').matchAll(/'([^']+)'/gu)].map((match) => match[1])

    expect(migrationValues).toEqual(['singleDevice', 'multiDevice'])
    expect(sqliteSchema.authWebauthnCredentials.deviceType.enumValues).toEqual(migrationValues)
  })

  it('keeps the passkey migration additive and D1-only (narduk-libs#94)', () => {
    const migration = readFileSync(
      join(packageRoot, 'drizzle/0003_webauthn_credentials.sql'),
      'utf8',
    )
    // Comments in the file describe these constructs, so assert against the
    // statements only.
    const statements = migration
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n')
    // Additive: a rolled-back Worker must be able to ignore these tables, and
    // re-running the migration must be safe.
    expect(statements.match(/CREATE TABLE IF NOT EXISTS/gu)).toHaveLength(2)
    expect(statements).not.toMatch(/DROP TABLE/iu)
    expect(statements).not.toMatch(/ALTER TABLE/iu)
    // D1/SQLite dialect only — no Postgres-only construct may creep in.
    expect(statements).not.toMatch(/\bSERIAL\b|\bJSONB\b|\bBOOLEAN\b|\bTIMESTAMPTZ\b/iu)
  })
})
