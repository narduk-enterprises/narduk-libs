import * as tsParser from '@typescript-eslint/parser'
import { RuleTester } from 'eslint'
import { describe, it } from 'vitest'

import rule from '../../../src/rules/nuxt/no-fetch-in-watch'

RuleTester.describe = describe
RuleTester.it = it

const ts = new RuleTester({
  languageOptions: { parser: tsParser, parserOptions: { ecmaVersion: 2022, sourceType: 'module' } },
})

const FILE = 'app/composables/useOrders.ts'

ts.run('no-fetch-in-watch', rule, {
  valid: [
    {
      filename: FILE,
      code: 'const { data } = await useAsyncData("orders", () => $fetch("/api/orders"), { watch: [page] })',
    },
    { filename: FILE, code: 'watch(page, () => { refresh() })' },
    // Deep-review defect: v1 matched ANY callee named `watch`.
    {
      filename: 'scripts/dev.ts',
      code: 'chokidar.watch("src").on("change", () => { $fetch("/api/reload") })',
    },
    { filename: 'scripts/dev.ts', code: 'fs.watch("src", () => { $fetch("/api/reload") })' },
    { filename: FILE, code: 'watcher.watch(src, () => { useFetch("/api/orders") })' },
    // Deep-review defect: v1 walked through closure boundaries.
    { filename: FILE, code: 'watch(page, () => { debounce(() => useFetch("/api/orders"), 300) })' },
    {
      filename: 'tests/unit/orders.test.ts',
      code: 'watch(page, () => { useFetch("/api/orders") })',
    },
  ],
  invalid: [
    {
      filename: FILE,
      code: 'watch(page, () => { useFetch("/api/orders") })',
      errors: [{ messageId: 'fetchInWatch', data: { name: 'useFetch', watchName: 'watch' } }],
    },
    {
      filename: FILE,
      code: 'watchEffect(() => { useAsyncData("orders", load) })',
      errors: [
        { messageId: 'fetchInWatch', data: { name: 'useAsyncData', watchName: 'watchEffect' } },
      ],
    },
    {
      filename: FILE,
      code: 'watch(page, { handler() { $fetch("/api/orders") }, immediate: true })',
      errors: [{ messageId: 'fetchInWatch', data: { name: '$fetch', watchName: 'watch' } }],
    },
  ],
})
