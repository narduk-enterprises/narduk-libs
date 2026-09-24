/**
 * Statement ceiling for `GET /api/admin/system-prompts` (narduk-libs#257).
 *
 * What is counted: every SQL statement the route prepares against a real
 * Miniflare D1 database created from narduk-core's own `system_prompts`
 * migration by narduk-testkit's D1 query harness. The binding drizzle receives
 * records each `prepare()`, so the count is of statements the ORM actually
 * emits — not of helper calls. The route does not count rows, so its ceiling is
 * one statement per page.
 */
import { fileURLToPath } from 'node:url'

import { drizzle } from 'drizzle-orm/d1'
import { createApp, defineEventHandler, toWebHandler } from 'h3'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { createD1QueryHarness, expectStatementBudget } from '../../../tooling/narduk-testkit/src/d1'

import type { D1QueryHarness } from '../../../tooling/narduk-testkit/src/d1'
import type { H3Event } from 'h3'

const harness = vi.hoisted(() => ({
  database: null as unknown,
}))

vi.mock('@narduk-enterprises/narduk-core/server/utils/database', () => ({
  executeDatabaseQuery: async (query: unknown) => await (query as Promise<unknown>),
  getDatabaseRows: async (query: unknown) => await (query as Promise<unknown[]>),
  useDatabase: () => harness.database,
}))

// The admin wrapper is not what this test measures; the query parsing and the
// statements underneath it are, so both stay real.
vi.mock('@narduk-enterprises/narduk-core/server/utils/mutation', () => ({
  defineAdminQuery: (
    options: { parseQuery: (event: H3Event) => unknown },
    handler: (context: Record<string, unknown>) => unknown,
  ) =>
    defineEventHandler(async (event) =>
      handler({ admin: { id: 'admin' }, event, query: await options.parseQuery(event) }),
    ),
}))

vi.mock('@narduk-enterprises/narduk-core/server/utils/rateLimit', () => ({
  RATE_LIMIT_POLICIES: { adminSystemPrompts: { namespace: 'admin-system-prompts' } },
}))

vi.mock('nitropack/runtime', () => ({ useRuntimeConfig: () => ({}) }))

const PROMPT_COUNT = 9
const MIGRATION = fileURLToPath(
  new URL('../../narduk-core/runtime/drizzle/0005_system_prompts.sql', import.meta.url),
)

async function call(url: string) {
  const handler = (await import('../server/api/admin/system-prompts/index.get')).default
  const response = await toWebHandler(createApp().use(handler))(
    new Request(`http://prompts.test${url}`),
  )

  return { body: (await response.json()) as Record<string, unknown>, status: response.status }
}

describe('GET /api/admin/system-prompts holds a one-statement-per-page ceiling', () => {
  let d1: D1QueryHarness

  beforeAll(async () => {
    d1 = await createD1QueryHarness({ migrations: [MIGRATION] })
    const binding = d1.raw
    await binding.batch(
      Array.from({ length: PROMPT_COUNT }, (_row, index) =>
        binding
          .prepare(
            'INSERT INTO system_prompts (name, content, description, updated_at) VALUES (?, ?, ?, ?)',
          )
          .bind(
            `prompt-${index}`,
            `content ${index}`,
            `description ${index}`,
            `2026-03-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
          ),
      ),
    )

    harness.database = drizzle(d1.db)
  })

  afterAll(() => d1.dispose())

  beforeEach(() => {
    d1.reset()
  })

  it('serves any page in exactly one statement, with total null', async () => {
    for (const query of ['/', '/?limit=3', '/?limit=3&offset=6', '/?sort=updatedAt:desc']) {
      const {
        result: { body, status },
        statements,
      } = await expectStatementBudget(d1, () => call(query), { max: 1 })

      expect(status).toBe(200)
      expect(body.total).toBeNull()
      expect(statements).toHaveLength(1)
    }
  })

  it('answers the list-query contract shape and clamps the page to 500', async () => {
    const { body } = await call('/?limit=9999')

    expect(body).toMatchObject({ limit: 500, offset: 0, q: null, sort: 'name:asc', total: null })
    expect(body.items).toHaveLength(PROMPT_COUNT)
  })

  it('pages by offset and sorts by the allowlisted keys only', async () => {
    const names = (body: Record<string, unknown>) =>
      (body.items as Array<{ name: string }>).map((row) => row.name)

    const first = await call('/?limit=3&offset=0')
    const second = await call('/?limit=3&offset=3')
    const descending = await call('/?sort=name:desc&limit=3')

    expect(names(first.body)).toEqual(['prompt-0', 'prompt-1', 'prompt-2'])
    expect(names(second.body)).toEqual(['prompt-3', 'prompt-4', 'prompt-5'])
    expect(names(descending.body)).toEqual(['prompt-8', 'prompt-7', 'prompt-6'])

    expect((await call('/?sort=content:asc')).status).toBe(400)
    // `page` is not a filter this route declares. Tolerate-and-warn (Logan,
    // 2026-09-11) answers 200 with the unknown key ignored and logged rather
    // than a 400, for one release; see
    // `.changeset/list-query-tolerate-unknown-keys.md`.
    expect((await call('/?page=2')).status).toBe(200)
    // The route does not search, so `q` is rejected rather than ignored.
    expect((await call('/?q=prompt-1')).status).toBe(400)
  })
})
