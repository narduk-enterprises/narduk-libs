import { Linter } from 'eslint'
import { describe, expect, it } from 'vitest'

import noProcessEnv from '../../src/rules/cloudflare/no-process-env-in-worker-runtime'
import requireCsrf from '../../src/rules/server/require-csrf-header-on-mutations'

function messages(rule: never, code: string, filename: string) {
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
  )
}

describe('ponytail-5 regressions', () => {
  it('#4 GET-then-fall-through route is still a mutation route (CSRF reported)', () => {
    const code = `export default defineEventHandler(async (event) => {
      if (event.method === 'GET') return list()
      return save(await readBody(event))
    })`
    expect(messages(requireCsrf as never, code, 'server/api/items.ts')).not.toEqual([])
  })

  it('#4b !== GET guard is still a mutation route', () => {
    const code = `export default defineEventHandler(async (event) => {
      if (event.method !== 'GET') return save(await readBody(event))
      return list()
    })`
    expect(messages(requireCsrf as never, code, 'server/api/items.ts')).not.toEqual([])
  })

  it('#5 a callee that merely contains "csrf" must not satisfy the CSRF rule', () => {
    const code = `export default defineEventHandler(async (event) => {
      logCsrfFailure(event)
      return transfer(await readBody(event))
    })`
    expect(messages(requireCsrf as never, code, 'server/api/transfer.post.ts')).not.toEqual([])
  })

  it('#6 routes under server/api/fixtures/ are still served, so the CSRF rule applies', () => {
    const code = `export default defineEventHandler(async (event) => {
      db.execute(sql.raw(String(await readBody(event))))
    })`
    expect(messages(requireCsrf as never, code, 'server/api/fixtures/seed.post.ts')).not.toEqual([])
  })

  it('#6b a .test. infix route under server/api is still Worker runtime', () => {
    const code = `export default defineEventHandler(() => process.env.API_KEY)`
    expect(messages(noProcessEnv as never, code, 'server/api/deploy.test.post.ts')).not.toEqual([])
  })
})
