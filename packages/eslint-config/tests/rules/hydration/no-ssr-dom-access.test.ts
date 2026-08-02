import * as tsParser from '@typescript-eslint/parser'
import { RuleTester } from 'eslint'
import vueParser from 'vue-eslint-parser'
import { describe, it } from 'vitest'

import rule from '../../../src/rules/hydration/no-ssr-dom-access'

RuleTester.describe = describe
RuleTester.it = it

/**
 * The whole point of this suite: v1's tests ran under espree, so its Vue branch —
 * the branch containing the `type.startsWith('V')` bug — never executed in CI.
 * Every case here runs under vue-eslint-parser against a real `.vue` filename.
 */
const vue = new RuleTester({
  languageOptions: {
    parser: vueParser,
    parserOptions: { ecmaVersion: 2022, sourceType: 'module', parser: tsParser },
  },
})

const ts = new RuleTester({
  languageOptions: { parser: tsParser, parserOptions: { ecmaVersion: 2022, sourceType: 'module' } },
})

const VUE_FILE = 'app/components/layout/ViewportBanner.vue'

const sfc = (script: string) => `<script setup>\n${script}\n</script>\n<template><div /></template>`

vue.run('no-ssr-dom-access (vue SFC)', rule, {
  valid: [
    { filename: VUE_FILE, code: sfc('if (import.meta.client) { const w = window.innerWidth }') },
    { filename: VUE_FILE, code: sfc('if (process.client) { const w = window.innerWidth }') },
    {
      filename: VUE_FILE,
      code: sfc('if (typeof window !== "undefined") { const w = window.innerWidth }'),
    },
    { filename: VUE_FILE, code: sfc('onMounted(() => { const w = window.innerWidth })') },
    {
      filename: VUE_FILE,
      code: sfc('const theme = import.meta.client && localStorage.getItem("theme")'),
    },
    {
      filename: VUE_FILE,
      code: sfc('function read() { if (!import.meta.client) return; return window.innerWidth }'),
    },
    {
      filename: VUE_FILE,
      code: sfc('function read() { if (import.meta.server) return null; return document.title }'),
    },
    {
      filename: VUE_FILE,
      code: sfc('const w = import.meta.client ? window.innerWidth : 0'),
    },
    {
      filename: VUE_FILE,
      code: sfc('if (import.meta.server) { useLog() } else { const w = window.innerWidth }'),
    },
    {
      filename: VUE_FILE,
      code: sfc(
        'const nuxtApp = useNuxtApp()\nnuxtApp.hook("app:mounted", () => { document.title = "x" })',
      ),
    },
    // A local binding named `window` is not the DOM global.
    { filename: VUE_FILE, code: sfc('function f(window) { return window.innerWidth }') },
    // Client-only and test files are out of scope.
    {
      filename: 'app/composables/useViewport.client.ts',
      code: 'export const w = window.innerWidth',
    },
    { filename: 'tests/unit/viewport.test.ts', code: 'const w = window.innerWidth' },
  ],
  invalid: [
    // Deep-review proof 11: v1 skipped all three of these in `.vue` files because
    // its ancestor guard `type.startsWith('V')` matched `VariableDeclarator`.
    {
      filename: VUE_FILE,
      code: sfc('const width = window.innerWidth'),
      errors: [{ messageId: 'unguardedDomAccess', data: { name: 'window' } }],
    },
    {
      filename: VUE_FILE,
      code: sfc('const theme = localStorage.getItem("theme")'),
      errors: [{ messageId: 'unguardedDomAccess', data: { name: 'localStorage' } }],
    },
    {
      filename: VUE_FILE,
      code: sfc('const title = document.title'),
      errors: [{ messageId: 'unguardedDomAccess', data: { name: 'document' } }],
    },
    // Evasion case: v1 accepted the ELSE branch of a client guard.
    {
      filename: VUE_FILE,
      code: sfc('if (import.meta.client) { useLog() } else { const w = window.innerWidth }'),
      errors: [{ messageId: 'unguardedDomAccess' }],
    },
    // Evasion case: v1 accepted `x || import.meta.client` as a guard.
    {
      filename: VUE_FILE,
      code: sfc('if (isReady || import.meta.client) { const w = window.innerWidth }'),
      errors: [{ messageId: 'unguardedDomAccess' }],
    },
    // Evasion case: an early return that only fires on the CLIENT guards nothing.
    {
      filename: VUE_FILE,
      code: sfc('function read() { if (import.meta.client) return 0; return window.innerWidth }'),
      errors: [{ messageId: 'unguardedDomAccess' }],
    },
    // A chained read reports exactly once.
    {
      filename: VUE_FILE,
      code: sfc('const lang = navigator.languages[0]'),
      errors: [{ messageId: 'unguardedDomAccess', data: { name: 'navigator' } }],
    },
    {
      filename: VUE_FILE,
      code: sfc('const w = globalThis.window.innerWidth'),
      errors: [{ messageId: 'unguardedDomAccess', data: { name: 'globalThis.window' } }],
    },
  ],
})

ts.run('no-ssr-dom-access (script)', rule, {
  valid: [
    {
      filename: 'app/composables/useTheme.ts',
      code: 'export const read = () => (import.meta.client ? localStorage.getItem("t") : null)',
    },
  ],
  invalid: [
    {
      filename: 'app/composables/useTheme.ts',
      code: 'export const read = () => localStorage.getItem("t")',
      errors: [{ messageId: 'unguardedDomAccess' }],
    },
  ],
})
