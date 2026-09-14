import * as tsParser from '@typescript-eslint/parser'
import { RuleTester } from 'eslint'
import vueParser from 'vue-eslint-parser'
import { describe, it } from 'vitest'

import rule from '../../../src/rules/vue/no-setup-top-level-side-effects'

RuleTester.describe = describe
RuleTester.it = it

const vue = new RuleTester({
  languageOptions: {
    parser: vueParser,
    parserOptions: { ecmaVersion: 2022, sourceType: 'module', parser: tsParser },
  },
})

const VUE_FILE = 'app/components/layout/AppShell.vue'
const sfc = (script: string) => `<script setup>\n${script}\n</script>\n<template><div /></template>`

vue.run('no-setup-top-level-side-effects', rule, {
  valid: [
    {
      filename: VUE_FILE,
      code: sfc('onMounted(() => window.addEventListener("resize", onResize))'),
    },
    {
      filename: VUE_FILE,
      code: sfc('if (import.meta.client) { window.addEventListener("resize", onResize) }'),
    },
    { filename: VUE_FILE, code: sfc('function onClick() { window.scrollTo(0, 0) }') },
    { filename: VUE_FILE, code: sfc('const { data } = await useFetch("/api/orders")') },
    { filename: VUE_FILE, code: sfc('const state = useState("count", () => 0)') },
    { filename: 'app/utils/shell.ts', code: 'window.addEventListener("resize", onResize)' },
  ],
  invalid: [
    // Deep-review defect: v1 registered CallExpression, MemberExpression AND
    // Identifier visitors over the same predicate, so this reported TWICE.
    {
      filename: VUE_FILE,
      code: sfc('window.addEventListener("resize", onResize)'),
      errors: [{ messageId: 'noTopLevelSideEffect' }],
    },
    {
      filename: VUE_FILE,
      code: sfc('setInterval(tick, 1000)'),
      errors: [{ messageId: 'noTopLevelSideEffect' }],
    },
    {
      filename: VUE_FILE,
      code: sfc('const res = await fetch("/api/orders")'),
      errors: [{ messageId: 'useNuxtComposable' }],
    },
    {
      filename: VUE_FILE,
      code: sfc('const title = document.title'),
      errors: [{ messageId: 'noTopLevelSideEffect' }],
    },
    {
      filename: VUE_FILE,
      code: sfc('const theme = localStorage.getItem("theme")'),
      errors: [{ messageId: 'noTopLevelSideEffect' }],
    },
  ],
})
