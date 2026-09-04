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
})
