import { describe, expect, it } from 'vitest'

import { createFakeD1Database } from '../../../src/server/handlers/fake-d1'

async function withSchema() {
  const db = createFakeD1Database()
  await db.exec('CREATE TABLE u (email TEXT)')
  return db
}

describe('ponytail-5 regressions', () => {
  it('#7a a CTE-led INSERT reports changes: 1', async () => {
    const db = await withSchema()
    const result = await db
      .prepare("WITH c AS (SELECT 'a@b.c' AS email) INSERT INTO u (email) SELECT email FROM c")
      .run()
    const count = await db.prepare('SELECT COUNT(*) AS n FROM u').first<{ n: number }>()
    expect(count?.n).toBe(1)
    expect(result.meta.changes).toBe(1)
  })

  it('#7b a prepared multi-statement string is rejected, as D1 does', () => {
    const run = async () => {
      const db = await withSchema()
      await db
        .prepare("INSERT INTO u (email) VALUES ('1'); INSERT INTO u (email) VALUES ('2')")
        .run()
    }
    return expect(run()).rejects.toThrow()
  })
})
