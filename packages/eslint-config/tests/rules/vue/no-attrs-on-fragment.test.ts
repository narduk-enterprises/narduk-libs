import * as tsParser from '@typescript-eslint/parser'
import { RuleTester } from 'eslint'
import vueParser from 'vue-eslint-parser'
import { describe, it } from 'vitest'

import rule from '../../../src/rules/vue/no-attrs-on-fragment'

RuleTester.describe = describe
RuleTester.it = it

const vue = new RuleTester({
  languageOptions: {
    parser: vueParser,
    parserOptions: { ecmaVersion: 2022, sourceType: 'module', parser: tsParser },
  },
})

const VUE_FILE = 'app/components/shared/Card.vue'

vue.run('no-attrs-on-fragment', rule, {
  valid: [
    { filename: VUE_FILE, code: '<template><div><slot /></div></template>' },
    // Deep-review false positive: a v-if / v-else chain renders ONE root.
    { filename: VUE_FILE, code: '<template><div v-if="ok" /><span v-else /></template>' },
    {
      filename: VUE_FILE,
      code: '<template><div v-if="a" /><div v-else-if="b" /><span v-else /></template>',
    },
    {
      filename: VUE_FILE,
      code: '<script setup>\ndefineOptions({ inheritAttrs: false })\n</script>\n<template><div /><span /></template>',
    },
    // Deep-review miss: defineComponent did not suppress the report in v1.
    {
      filename: VUE_FILE,
      code: '<script>\nexport default defineComponent({ inheritAttrs: false })\n</script>\n<template><div /><span /></template>',
    },
    {
      filename: VUE_FILE,
      code: '<script>\nexport default { inheritAttrs: false }\n</script>\n<template><div /><span /></template>',
    },
    { filename: 'app/utils/card.ts', code: 'export const card = 1' },
  ],
  invalid: [
    {
      filename: VUE_FILE,
      code: '<template><div /><span /></template>',
      errors: [{ messageId: 'fragmentNeedsInheritAttrs' }],
    },
    // Only one branch of the chain carries v-if, the other is unconditional.
    {
      filename: VUE_FILE,
      code: '<template><div v-if="ok" /><span /></template>',
      errors: [{ messageId: 'fragmentNeedsInheritAttrs' }],
    },
    {
      filename: VUE_FILE,
      code: '<template><Teleport to="body"><div /></Teleport></template>',
      errors: [{ messageId: 'teleportRootNeedsInheritAttrs' }],
    },
    {
      filename: VUE_FILE,
      code: '<template>just text</template>',
      errors: [{ messageId: 'textOnlyRootNeedsInheritAttrs' }],
    },
  ],
})
