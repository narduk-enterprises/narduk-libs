import * as tsParser from '@typescript-eslint/parser'
import { RuleTester } from 'eslint'
import { describe, it } from 'vitest'

import rule from '../../../src/rules/nuxt/no-fetch-in-onmounted'

RuleTester.describe = describe
RuleTester.it = it

const ts = new RuleTester({
  languageOptions: { parser: tsParser, parserOptions: { ecmaVersion: 2022, sourceType: 'module' } },
})

const FILE = 'app/composables/useOrders.ts'

ts.run('no-fetch-in-onmounted', rule, {
  valid: [
    { filename: FILE, code: 'const { data } = await useFetch("/api/orders")' },
    { filename: FILE, code: 'onMounted(() => { start() })' },
    // Receiver-aware: only a bare `onMounted` identifier is the Vue hook.
    { filename: FILE, code: 'emitter.onMounted(() => { useFetch("/api/orders") })' },
    // A deferred action created inside the hook is not the hook's own fetch.
    {
      filename: FILE,
      code: 'onMounted(() => { el.addEventListener("click", () => { useFetch("/api/orders") }) })',
    },
    { filename: FILE, code: 'onMounted(() => { $fetch("/api/track", { method: "POST" }) })' },
    { filename: 'tests/unit/orders.test.ts', code: 'onMounted(() => { useFetch("/api/orders") })' },
  ],
  invalid: [
    {
      filename: FILE,
      code: 'onMounted(async () => { const { data } = await useFetch("/api/orders") })',
      errors: [{ messageId: 'fetchInOnMounted', data: { name: 'useFetch', hook: 'onMounted' } }],
    },
    {
      filename: FILE,
      code: 'onMounted(async () => { await useAsyncData("orders", () => load()) })',
      errors: [
        { messageId: 'fetchInOnMounted', data: { name: 'useAsyncData', hook: 'onMounted' } },
      ],
    },
    {
      filename: FILE,
      code: 'onBeforeMount(() => { useLazyFetch("/api/orders") })',
      errors: [
        { messageId: 'fetchInOnMounted', data: { name: 'useLazyFetch', hook: 'onBeforeMount' } },
      ],
    },
  ],
})
