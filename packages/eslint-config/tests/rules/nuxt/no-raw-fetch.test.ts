import * as tsParser from '@typescript-eslint/parser'
import { RuleTester } from 'eslint'
import vueParser from 'vue-eslint-parser'
import { describe, it } from 'vitest'

import rule from '../../../src/rules/nuxt/no-raw-fetch'

RuleTester.describe = describe
RuleTester.it = it

const vue = new RuleTester({
  languageOptions: {
    parser: vueParser,
    parserOptions: { ecmaVersion: 2022, sourceType: 'module', parser: tsParser },
  },
})

/**
 * Deep-review proof 12: v1's gate was `'app/pages/index.vue'.includes('/app/pages/')`,
 * which is FALSE, so all seven of its "valid" cases executed no rule logic. Every
 * case below uses the same relative filename shape, and the invalid cases prove
 * the rule is actually installed at that filename.
 */
const PAGE = 'app/pages/index.vue'
const sfc = (script: string) => `<script setup>\n${script}\n</script>\n<template><div /></template>`

vue.run('no-raw-fetch', rule, {
  valid: [
    // The canonical Nuxt composition — v1 reported this as an error.
    {
      filename: PAGE,
      code: sfc('const { data } = await useAsyncData("users", () => $fetch("/api/users"))'),
    },
    {
      filename: PAGE,
      code: sfc('const { data } = useLazyAsyncData("users", () => $fetch("/api/users"))'),
    },
    { filename: PAGE, code: sfc('const { data } = await useFetch("/api/users")') },
    // Inside an event handler `$fetch` is the correct API.
    {
      filename: PAGE,
      code: sfc(
        'async function save(body) { await $fetch("/api/save", { method: "POST", body }) }',
      ),
    },
    {
      filename: 'app/components/orders/OrderForm.vue',
      code: sfc('const submit = async () => { await $fetch("/api/orders", { method: "POST" }) }'),
    },
    // Out of the page/component scope.
    {
      filename: 'app/composables/useOrders.ts',
      code: 'export const load = async () => $fetch("/api/orders")',
    },
    // Test files are exempt.
    { filename: 'tests/pages/index.test.ts', code: 'const data = await $fetch("/api/users")' },
  ],
  invalid: [
    {
      filename: PAGE,
      code: sfc('const users = await $fetch("/api/users")'),
      errors: [{ messageId: 'rawFetch' }],
    },
    {
      filename: 'app/components/orders/OrderList.vue',
      code: sfc('const orders = await $fetch("/api/orders")'),
      errors: [{ messageId: 'rawFetch' }],
    },
    // Absolute filenames must behave identically to relative ones.
    {
      filename: '/repo/myapp/app/pages/orders.vue',
      code: sfc('const orders = await $fetch("/api/orders")'),
      errors: [{ messageId: 'rawFetch' }],
    },
  ],
})
