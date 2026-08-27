import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { getTableColumns } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import * as pgSchema from '../server/database/auth-bridge-pg-schema'
import * as sqliteSchema from '../server/database/auth-bridge-schema'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

const TABLE_KEYS = [
  'authUserLinks',
  'authSessions',
  'authEmailLinks',
  'authLocalEmailAttempts',
] as const

describe('auth bridge schema parity', () => {
  it('keeps the sqlite and postgres table definitions column-identical', () => {
    for (const tableKey of TABLE_KEYS) {
      const sqliteColumns = getTableColumns(sqliteSchema[tableKey])
      const pgColumns = getTableColumns(pgSchema[tableKey])

      expect(Object.keys(pgColumns).sort(), tableKey).toEqual(Object.keys(sqliteColumns).sort())
      for (const [key, column] of Object.entries(sqliteColumns)) {
        expect(pgColumns[key as keyof typeof pgColumns]?.name, `${tableKey}.${key}`).toBe(
          column.name,
        )
      }
    }
  })

  it('narrows auth_email_links.purpose to the values the migration CHECK enforces', () => {
    const migration = readFileSync(join(packageRoot, 'drizzle/0002_local_email_auth.sql'), 'utf8')
    const check = /CHECK \(purpose IN \(([^)]+)\)\)/u.exec(migration)
    expect(check).not.toBeNull()
    const migrationValues = [...(check?.[1] ?? '').matchAll(/'([^']+)'/gu)].map((match) => match[1])

    expect(migrationValues).toEqual(['setup', 'reset'])
    expect(sqliteSchema.authEmailLinks.purpose.enumValues).toEqual(migrationValues)
    expect(pgSchema.authEmailLinks.purpose.enumValues).toEqual(migrationValues)
  })
})
