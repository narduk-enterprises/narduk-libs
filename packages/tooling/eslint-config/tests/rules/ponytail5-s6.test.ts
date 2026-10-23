import { Linter } from 'eslint'
import { describe, expect, it } from 'vitest'

import noProcessEnv from '../../src/rules/cloudflare/no-process-env-in-worker-runtime'
import requireLimit from '../../src/rules/server/require-limit-on-drizzle-list-queries'
import requireFetchTimeout from '../../src/rules/server/require-fetch-timeout'
import requireValidatedQuery from '../../src/rules/server/require-validated-query'

function count(rule: never, code: string, filename: string): number {
  const linter = new Linter()
  return linter.verify(
    code,
    [
      {
        files: ['**/*.ts'],
        languageOptions: { ecmaVersion: 2024, sourceType: 'module' },
        plugins: { p5: { rules: { r: rule } } },
        rules: { 'p5/r': 'error' },
      },
    ],
    { filename },
  ).length
}

describe('ponytail-5 s6 eslint-config', () => {
  const route = 'server/api/things.get.ts'

  it('#12 an imported node:process and global.process are the process object', () => {
    const imported = `import process from 'node:process'
      export default defineEventHandler(() => process.env.API_KEY)`
    expect(count(noProcessEnv as never, imported, route)).toBe(1)
    expect(count(noProcessEnv as never, 'export const k = global.process.env.K', route)).toBe(1)
  })

  it('#13 or() of a primary key is a list; a stored select that is returned is checked', () => {
    const or = `export default defineEventHandler(async () =>
      await db.select().from(users).where(or(eq(users.id, a), eq(users.orgId, b))))`
    expect(count(requireLimit as never, or, route)).toBe(1)
    const pk = `export default defineEventHandler(async () =>
      await db.select().from(users).where(or(eq(users.id, a), eq(users.id, b))))`
    expect(count(requireLimit as never, pk, route)).toBe(0)
    const stored = `export default defineEventHandler(() => {
      const rows = db.select().from(users)
      return rows
    })`
    expect(count(requireLimit as never, stored, route)).toBe(1)
    const bounded = `export default defineEventHandler(() => {
      const rows = db.select().from(users).limit(10)
      return rows
    })`
    expect(count(requireLimit as never, bounded, route)).toBe(0)
  })

  it('#14 one schema.parse does not clear a raw read of the same query', () => {
    const raw = `export default defineEventHandler(async (event) => {
      const query = getQuery(event)
      await db.find(query.name)
      querySchema.parse(query)
    })`
    expect(count(requireValidatedQuery as never, raw, route)).toBe(1)
    const ok = `export default defineEventHandler((event) => {
      const query = getQuery(event)
      return querySchema.parse(query)
    })`
    expect(count(requireValidatedQuery as never, ok, route)).toBe(0)
  })

  it('#15 timeout: undefined / signal: null do not bound a fetch', () => {
    for (const init of ['{ timeout: undefined }', '{ signal: null }', '{ timeout: void 0 }']) {
      expect(
        count(requireFetchTimeout as never, `$fetch('https://x.test/p', ${init})`, route),
      ).toBe(1)
    }
    expect(
      count(requireFetchTimeout as never, `$fetch('https://x.test/p', { timeout: 5000 })`, route),
    ).toBe(0)
  })
})
