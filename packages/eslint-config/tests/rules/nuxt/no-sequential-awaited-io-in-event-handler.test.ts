import * as tsParser from '@typescript-eslint/parser'
import { RuleTester } from 'eslint'
import { describe, it } from 'vitest'

import rule from '../../../src/rules/nuxt/no-sequential-awaited-io-in-event-handler'

RuleTester.describe = describe
RuleTester.it = it

const ts = new RuleTester({
  languageOptions: { parser: tsParser, parserOptions: { ecmaVersion: 2022, sourceType: 'module' } },
})

const HANDLER = 'server/api/orders.get.ts'

ts.run('no-sequential-awaited-io-in-event-handler', rule, {
  valid: [
    {
      filename: HANDLER,
      code: 'export default defineEventHandler(async () => { const [a, b] = await Promise.all([$fetch("/a"), $fetch("/b")]); return { a, b } })',
    },
    // Data dependency: the second read needs the first result.
    {
      filename: HANDLER,
      code: 'export default defineEventHandler(async () => { const user = await $fetch("/api/user"); const orders = await $fetch(`/api/orders/${user.id}`); return orders })',
    },
    // Deep-review defect: the v1 sibling rule recommended Promise.all for two
    // ORDERED mutations, which introduces a race. Mutations are not reported.
    {
      filename: HANDLER,
      code: 'export default defineEventHandler(async () => { await $fetch("/cart/lock", { method: "POST" }); await $fetch("/cart/submit", { method: "POST" }); return true })',
    },
    {
      filename: HANDLER,
      code: 'export default defineEventHandler(async () => { await db.insert(carts).values(a); await db.insert(items).values(b); return true })',
    },
    // Not a server file.
    {
      filename: 'app/composables/useOrders.ts',
      code: 'export default defineEventHandler(async () => { const a = await $fetch("/a"); const b = await $fetch("/b"); return [a, b] })',
    },
  ],
  invalid: [
    {
      filename: HANDLER,
      code: 'export default defineEventHandler(async () => { const user = await $fetch("/api/user"); const config = await $fetch("/api/config"); return { user, config } })',
      errors: [{ messageId: 'sequentialReads' }],
    },
    {
      filename: 'server/routes/report.ts',
      code: 'export default defineEventHandler(async () => { const rows = await db.select().from(orders); const meta = await useStorage("cache").getItem("meta"); return { rows, meta } })',
      errors: [{ messageId: 'sequentialReads' }],
    },
    // The handler is an object-form property.
    {
      filename: HANDLER,
      code: 'export default defineEventHandler({ async handler() { const a = await $fetch("/a"); const b = await $fetch("/b"); return [a, b] } })',
      errors: [{ messageId: 'sequentialReads' }],
    },
    // The handler is declared AFTER the call — hoisting must not hide it.
    {
      filename: HANDLER,
      code: 'export default defineEventHandler(handler)\n\nasync function handler() { const a = await $fetch("/a"); const b = await $fetch("/b"); return [a, b] }',
      errors: [{ messageId: 'sequentialReads' }],
    },
  ],
})
