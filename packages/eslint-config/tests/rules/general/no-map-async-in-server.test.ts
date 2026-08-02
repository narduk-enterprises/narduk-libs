import * as tsParser from '@typescript-eslint/parser'
import { RuleTester } from 'eslint'
import { describe, it } from 'vitest'

import rule from '../../../src/rules/general/no-map-async-in-server'

RuleTester.describe = describe
RuleTester.it = it

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  },
})

ruleTester.run('no-map-async-in-server', rule, {
  valid: [
    // --- ported from v1 ---
    { filename: 'app/pages/x.vue', code: 'ids.map(async (id) => await $fetch(id))' },
    { filename: 'server/api/users.ts', code: 'ids.map((id) => id + 1)' },
    { filename: 'server/api/users.test.ts', code: 'ids.map(async (id) => await $fetch(id))' },
    { filename: 'server/__tests__/users.ts', code: 'ids.map(async (id) => await $fetch(id))' },
    { filename: 'server/e2e/users.ts', code: 'ids.map(async (id) => await $fetch(id))' },

    // --- new: scope boundaries -------------------------------------------
    // Segment-anchored: `server-utils` is not `server`.
    { filename: 'app/server-utils/batch.ts', code: 'ids.map(async (id) => await q(id))' },
    { filename: 'packages/observer/x.ts', code: 'ids.map(async (id) => await q(id))' },
    // `.spec.` is excluded alongside `.test.`.
    { filename: 'server/api/users.spec.ts', code: 'ids.map(async (id) => await q(id))' },
    // A non-`map` member call is untouched.
    { filename: 'server/api/users.ts', code: 'ids.forEach(async (id) => { await q(id) })' },
    // A bare `map(...)` with no receiver is not an array map.
    { filename: 'server/api/users.ts', code: 'map(async (id) => await q(id))' },
    // A passed-by-reference async callback is out of the rule's stated scope
    // (it only inspects inline function literals).
    { filename: 'server/api/users.ts', code: 'ids.map(loadUser)' },
  ],
  invalid: [
    // --- ported from v1 ---
    {
      filename: 'server/api/users.ts',
      code: 'ids.map(async (id) => await $fetch(id))',
      errors: [{ messageId: 'mapAsync' }],
    },
    {
      filename: 'server/utils/batch.ts',
      code: 'rows.map(async function (r) { return await doQuery(r.id) })',
      errors: [{ messageId: 'mapAsync' }],
    },
    {
      filename: 'server/api/users.ts',
      code: 'rows?.map(async (r) => await doQuery(r.id))',
      errors: [{ messageId: 'mapAsync' }],
    },

    // --- new: path-gate coverage ------------------------------------------
    // Absolute filenames must behave identically to relative ones. v1's gate
    // happened to carry a `startsWith('server/')` fallback (the review noted
    // it was the ONLY rule that did), so this pair is the regression lock that
    // keeps both halves working now the gate is shared.
    {
      filename: '/repo/server/api/users.get.ts',
      code: 'ids.map(async (id) => await db.query(id))',
      errors: [{ messageId: 'mapAsync' }],
    },
    {
      filename: 'apps/web/server/routes/webhook.post.ts',
      code: 'events.map(async (e) => await handle(e))',
      errors: [{ messageId: 'mapAsync' }],
    },
    // Windows separators.
    {
      filename: 'C:\\repo\\server\\api\\users.ts',
      code: 'ids.map(async (id) => await q(id))',
      errors: [{ messageId: 'mapAsync' }],
    },
    // Chained after another call — the receiver shape must not matter.
    {
      filename: 'server/api/users.ts',
      code: 'rows.filter(Boolean).map(async (r) => await q(r.id))',
      errors: [{ messageId: 'mapAsync' }],
    },
    // Inside `Promise.all(...)` — the canonical N+1 spelling.
    {
      filename: 'server/api/orders.get.ts',
      code: 'const all = await Promise.all(ids.map(async (id) => await db.get(id)))',
      errors: [{ messageId: 'mapAsync' }],
    },
  ],
})
