import * as tsParser from '@typescript-eslint/parser'
import { RuleTester } from 'eslint'
import { describe, it } from 'vitest'

import rule from '../../../src/rules/nuxt/no-raw-fetch-in-stores'

RuleTester.describe = describe
RuleTester.it = it

const ts = new RuleTester({
  languageOptions: { parser: tsParser, parserOptions: { ecmaVersion: 2022, sourceType: 'module' } },
})

const STORE = 'app/stores/orders.ts'

ts.run('no-raw-fetch-in-stores', rule, {
  valid: [
    {
      filename: STORE,
      code: 'export const useOrders = defineStore("orders", () => { const load = () => useRequestFetch()("/api/orders"); return { load } })',
    },
    {
      filename: STORE,
      code: 'export const useOrders = defineStore("orders", () => { const load = (fetchFn) => fetchFn("/api/orders"); return { load } })',
    },
    // Nuxt 3 layout, relative filename.
    { filename: 'stores/orders.ts', code: 'export const load = () => useAppFetch("/api/orders")' },
    {
      filename: 'app/composables/useOrders.ts',
      code: 'export const load = () => $fetch("/api/orders")',
    },
    { filename: 'tests/stores/orders.test.ts', code: 'const data = await $fetch("/api/orders")' },
  ],
  invalid: [
    {
      filename: STORE,
      code: 'export const useOrders = defineStore("orders", () => { const load = () => $fetch("/api/orders"); return { load } })',
      errors: [{ messageId: 'rawFetchInStore', data: { name: '$fetch' } }],
    },
    {
      filename: STORE,
      code: 'export const useOrders = defineStore("orders", () => useFetch("/api/orders"))',
      errors: [{ messageId: 'rawFetchInStore', data: { name: 'useFetch' } }],
    },
    // Nuxt 3 layout, relative filename — v1 only worked here by accident.
    {
      filename: 'stores/orders.ts',
      code: 'export const load = () => useLazyFetch("/api/orders")',
      errors: [{ messageId: 'rawFetchInStore', data: { name: 'useLazyFetch' } }],
    },
    {
      filename: '/repo/myapp/app/stores/orders.ts',
      code: 'export const load = () => $fetch("/api/orders")',
      errors: [{ messageId: 'rawFetchInStore' }],
    },
  ],
})
