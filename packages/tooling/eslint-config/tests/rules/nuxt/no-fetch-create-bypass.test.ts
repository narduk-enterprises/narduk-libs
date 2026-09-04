import * as tsParser from '@typescript-eslint/parser'
import { RuleTester } from 'eslint'
import { describe, it } from 'vitest'

import rule from '../../../src/rules/nuxt/no-fetch-create-bypass'

RuleTester.describe = describe
RuleTester.it = it

const ts = new RuleTester({
  languageOptions: { parser: tsParser, parserOptions: { ecmaVersion: 2022, sourceType: 'module' } },
})

ts.run('no-fetch-create-bypass', rule, {
  valid: [
    {
      filename: 'app/composables/useOrders.ts',
      code: 'export const load = () => useNuxtApp().$csrfFetch("/api/orders")',
    },
    // The allowlist branch: v1's suite never reached it (all cases used testMode).
    {
      filename: 'app/plugins/fetch.client.ts',
      code: 'export default defineNuxtPlugin(() => { const api = $fetch.create({ retry: 1 }); return { provide: { api } } })',
    },
    {
      filename: 'app/composables/useCsrfFetch.ts',
      code: 'export const useCsrfFetch = () => $fetch.create({ headers: {} })',
    },
    { filename: 'tests/unit/fetch.test.ts', code: 'const api = $fetch.create({})' },
    // Not app runtime code.
    { filename: 'scripts/seed.ts', code: 'const api = $fetch.create({})' },
    { filename: 'app/composables/useOrders.ts', code: 'const api = ofetch.create({})' },
  ],
  invalid: [
    {
      filename: 'app/composables/useOrders.ts',
      code: 'const api = $fetch.create({ baseURL: "/api" })',
      errors: [{ messageId: 'fetchCreateBypass' }],
    },
    // Nuxt 3 layout, relative filename.
    {
      filename: 'composables/useOrders.ts',
      code: 'const api = $fetch.create({})',
      errors: [{ messageId: 'fetchCreateBypass' }],
    },
    {
      filename: 'app/plugins/analytics.ts',
      code: 'const api = $fetch.create({})',
      errors: [{ messageId: 'fetchCreateBypass' }],
    },
  ],
})
