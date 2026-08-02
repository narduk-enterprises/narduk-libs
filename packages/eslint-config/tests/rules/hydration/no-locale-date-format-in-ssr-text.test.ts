import * as tsParser from '@typescript-eslint/parser'
import { RuleTester } from 'eslint'
import vueParser from 'vue-eslint-parser'
import { describe, it } from 'vitest'

import rule from '../../../src/rules/hydration/no-locale-date-format-in-ssr-text'

RuleTester.describe = describe
RuleTester.it = it

const vue = new RuleTester({
  languageOptions: {
    parser: vueParser,
    parserOptions: { ecmaVersion: 2022, sourceType: 'module', parser: tsParser },
  },
})

const VUE_FILE = 'app/components/orders/OrderRow.vue'

vue.run('no-locale-date-format-in-ssr-text', rule, {
  valid: [
    {
      filename: VUE_FILE,
      code: '<script setup>\nconst d = new Date()\n</script>\n<template><time>{{ d.toISOString() }}</time></template>',
    },
    {
      filename: VUE_FILE,
      code: '<script setup>\nconst d = new Date()\nif (import.meta.client) { const label = d.toLocaleDateString() }\n</script>\n<template><div /></template>',
    },
    // v1 understood only import.meta.*; `process.client` false-positived.
    {
      filename: VUE_FILE,
      code: '<script setup>\nconst d = new Date()\nif (process.client) { const label = d.toLocaleDateString() }\n</script>\n<template><div /></template>',
    },
    // v1 also false-positived on the onMounted idiom.
    {
      filename: VUE_FILE,
      code: '<script setup>\nconst d = new Date()\nonMounted(() => { label.value = d.toLocaleDateString() })\n</script>\n<template><div /></template>',
    },
    // Event handlers run after hydration, so they cannot mismatch.
    {
      filename: VUE_FILE,
      code: '<script setup>\nconst d = new Date()\nfunction show() { alert(d.toLocaleDateString()) }\n</script>\n<template><div @click="show" /></template>',
    },
    // Deep-review false positive: an Intl.NumberFormat bound to a formatter-ish
    // name was flagged by v1's flat, scope-free tainted-name set.
    {
      filename: VUE_FILE,
      code: '<script setup>\nconst formatter = new Intl.NumberFormat("en-GB")\nconst total = formatter.format(12.5)\n</script>\n<template><div>{{ total }}</div></template>',
    },
    // `toLocaleString` on a non-date receiver is number formatting, not a date.
    {
      filename: VUE_FILE,
      code: '<script setup>\nconst total = 5\nconst label = total.toLocaleString()\n</script>\n<template><div /></template>',
    },
    {
      filename: VUE_FILE,
      code: '<template><ClientOnly><time>{{ d.toLocaleDateString() }}</time></ClientOnly></template>',
    },
    {
      filename: 'app/composables/useDateLabel.client.ts',
      code: 'export const label = (d: Date) => d.toLocaleDateString()',
    },
    // Documented boundary: a formatter helper is only a hazard at its call site,
    // which the rule reports there. The helper body itself is not judged, because
    // whether it runs during render is not knowable from this file.
    {
      filename: 'app/composables/useDateLabel.ts',
      code: 'export const label = (d: Date) => d.toLocaleDateString()',
    },
  ],
  invalid: [
    // Deep-review defect: `isInsideTemplateAttribute` exempted every VAttribute,
    // including v-bind, so this exact expression was silently missed.
    {
      filename: VUE_FILE,
      code: '<template><time :title="d.toLocaleDateString()">x</time></template>',
      errors: [{ messageId: 'localeDateFormat' }],
    },
    {
      filename: VUE_FILE,
      code: '<template><time>{{ d.toLocaleDateString() }}</time></template>',
      errors: [{ messageId: 'localeDateFormat' }],
    },
    {
      filename: VUE_FILE,
      code: '<script setup>\nconst d = new Date()\nconst label = d.toLocaleDateString()\n</script>\n<template><div>{{ label }}</div></template>',
      errors: [{ messageId: 'localeDateFormat' }],
    },
    {
      filename: VUE_FILE,
      code: '<script setup>\nconst d = new Date()\nconst label = computed(() => d.toLocaleTimeString())\n</script>\n<template><div>{{ label }}</div></template>',
      errors: [{ messageId: 'localeDateFormat' }],
    },
    // Scope-resolved: this formatter really is an Intl.DateTimeFormat.
    {
      filename: VUE_FILE,
      code: '<script setup>\nconst formatter = new Intl.DateTimeFormat("en-GB")\nconst label = formatter.format(d)\n</script>\n<template><div>{{ label }}</div></template>',
      errors: [{ messageId: 'localeDateFormat' }],
    },
    {
      filename: VUE_FILE,
      code: '<script setup>\nconst label = new Date(iso).toLocaleString()\n</script>\n<template><div>{{ label }}</div></template>',
      errors: [{ messageId: 'localeDateFormat' }],
    },
    {
      filename: 'app/composables/useDateLabel.ts',
      code: 'export const label = new Date(iso).toLocaleDateString()',
      errors: [{ messageId: 'localeDateFormat' }],
    },
  ],
})
