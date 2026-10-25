import { readFileSync } from 'node:fs'

import { drizzle } from 'drizzle-orm/d1'
import { Miniflare } from 'miniflare'
import { afterAll, describe, expect, it } from 'vitest'

import { createD1KvNamespace } from '../server/lib/mcp-oauth/d1-kv'

/**
 * Ponytail-5 s8 repro for #2003 auth-tenancy-pg #10: the token request's
 * `purgeExpired()` deleted the whole expired set in one statement.
 */
describe('auth_oauth_kv purgeExpired', { timeout: 20_000 }, () => {
  const runtime = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("ok") } }',
    compatibilityDate: '2026-07-01',
    d1Databases: ['DB'],
  })
  afterAll(() => runtime.dispose())

  it('deletes a bounded batch per call, oldest first', async () => {
    const binding = await runtime.getD1Database('DB')
    const migration = readFileSync(
      new URL('../drizzle/0005_mcp_oauth.sql', import.meta.url),
      'utf8',
    )
    for (const statement of migration
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n')
      .split(';')
      .map((item) => item.trim())
      .filter(Boolean)) {
      await binding.prepare(statement).run()
    }
    await binding.batch(
      Array.from({ length: 60 }, (_, i) =>
        binding
          .prepare('INSERT INTO auth_oauth_kv (key, value, expires_at) VALUES (?, ?, ?)')
          .bind(`grant:${i}`, '1', 100 + i),
      ),
    )
    const kv = createD1KvNamespace(drizzle(binding), () => 1_000)

    await kv.purgeExpired()

    const left = await binding
      .prepare('SELECT COUNT(*) AS n, MIN(expires_at) AS oldest FROM auth_oauth_kv')
      .first<{ n: number; oldest: number }>()
    expect(left).toEqual({ n: 10, oldest: 150 })
  })
})
