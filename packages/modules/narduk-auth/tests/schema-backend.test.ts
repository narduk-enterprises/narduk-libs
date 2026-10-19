import { describe, expect, it } from 'vitest'

import { usesPostgresSchema } from '../src/schema-backend'

describe('which auth schema follows the core backend', () => {
  it('selects Postgres only when core resolves its schema to pg-schema.ts', () => {
    expect(
      usesPostgresSchema('/app/node_modules/narduk-core/runtime/server/database/pg-schema.ts'),
    ).toBe(true)
    expect(
      usesPostgresSchema('/app/node_modules/narduk-core/runtime/server/database/schema.ts'),
    ).toBe(false)
    expect(usesPostgresSchema('/app/server/database/schema.ts')).toBe(false)
    expect(usesPostgresSchema(undefined)).toBe(false)
  })
})
