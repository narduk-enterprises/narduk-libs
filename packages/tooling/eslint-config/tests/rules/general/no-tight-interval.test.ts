import * as tsParser from '@typescript-eslint/parser'
import { RuleTester } from 'eslint'
import vueParser from 'vue-eslint-parser'
import { describe, it } from 'vitest'

import rule from '../../../src/rules/general/no-tight-interval'

RuleTester.describe = describe
RuleTester.it = it

const ts = new RuleTester({
  languageOptions: {
    parser: tsParser,
    parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  },
})

const vue = new RuleTester({
  languageOptions: {
    parser: vueParser,
    parserOptions: { ecmaVersion: 2022, sourceType: 'module', parser: tsParser },
  },
})

ts.run('no-tight-interval (ts)', rule, {
  valid: [
    // --- ported from v1 ---
    { filename: 'app/utils/t.ts', code: 'setInterval(() => {}, 5000)' },
    { filename: 'app/utils/custom.ts', code: 'scheduler.setInterval(() => {}, 100)' },

    // --- new: documented boundaries -------------------------------------
    // The receiver allow-list is literal. A timer reached through an alias is
    // NOT reported — the review's repo-wide alias/namespace weakness class.
    {
      filename: 'app/utils/alias.ts',
      code: 'const g = globalThis\ng.setInterval(() => {}, 100)',
    },
    // Computed member access is excluded by the `callee.computed` guard.
    { filename: 'app/utils/computed.ts', code: "window['setInterval'](() => {}, 100)" },
    // Non-literal delays are out of scope (no constant folding).
    { filename: 'app/utils/const.ts', code: 'const DELAY = 100\nsetInterval(() => {}, DELAY)' },
    // setTimeout is opt-in.
    { filename: 'app/utils/timeout.ts', code: 'window.setTimeout(() => {}, 100)' },
    // One-argument form has no delay to judge.
    { filename: 'app/utils/onearg.ts', code: 'setInterval(tick)' },
    // Exactly at the boundary is allowed.
    { filename: 'app/utils/edge.ts', code: 'setInterval(() => {}, 1000)' },
  ],
  invalid: [
    // --- ported from v1 ---
    {
      filename: 'app/utils/bad.ts',
      code: 'setInterval(() => {}, 200)',
      errors: [{ messageId: 'tooTight' }],
    },
    {
      filename: 'app/utils/window.ts',
      code: 'window.setInterval(() => {}, 200)',
      errors: [{ messageId: 'tooTight' }],
    },
    {
      filename: 'app/utils/global.ts',
      code: 'globalThis.setInterval(() => {}, 200)',
      errors: [{ messageId: 'tooTight' }],
    },
    {
      filename: 'app/utils/self.ts',
      code: 'self.setInterval(() => {}, 200)',
      errors: [{ messageId: 'tooTight' }],
    },
    {
      filename: 'app/utils/timeout.ts',
      code: 'window.setTimeout(() => {}, 200)',
      options: [{ includeSetTimeout: true }],
      errors: [{ messageId: 'tooTight' }],
    },

    // --- new: adversarial ------------------------------------------------
    // Optional chaining wraps the callee in a ChainExpression; the rule must
    // unwrap it before matching the receiver.
    {
      filename: 'app/utils/chain.ts',
      code: 'window?.setInterval(() => {}, 100)',
      errors: [{ messageId: 'tooTight' }],
    },
    // Custom threshold, exercised through the real schema (no testMode).
    {
      filename: 'app/utils/threshold.ts',
      code: 'setInterval(() => {}, 2000)',
      options: [{ minIntervalMs: 5000 }],
      errors: [{ messageId: 'tooTight', data: { ms: '2000', min: '5000' } }],
    },
  ],
})

vue.run('no-tight-interval (vue SFC)', rule, {
  valid: [
    // --- ported from v1 ---
    { filename: 'app/c.vue', code: '<script setup>\nsetInterval(() => {}, 2000)\n</script>' },
  ],
  invalid: [
    // --- ported from v1 ---
    {
      filename: 'app/c.vue',
      code: '<script setup>\nsetInterval(() => {}, 100)\n</script>',
      errors: [{ messageId: 'tooTight' }],
    },
    {
      filename: 'app/window.vue',
      code: '<script setup>\nwindow.setInterval(() => {}, 100)\n</script>',
      errors: [{ messageId: 'tooTight' }],
    },

    // --- new: SFC with lang="ts" and a relative component filename --------
    {
      filename: 'app/components/Ticker.vue',
      code: '<script setup lang="ts">\nimport { onMounted } from \'vue\'\nonMounted(() => { self.setInterval(() => {}, 250) })\n</script>\n<template><span /></template>',
      errors: [{ messageId: 'tooTight' }],
    },
  ],
})
