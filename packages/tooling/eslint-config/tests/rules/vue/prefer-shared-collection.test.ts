import * as tsParser from '@typescript-eslint/parser'
import { RuleTester } from 'eslint'
import vueParser from 'vue-eslint-parser'
import { describe, it } from 'vitest'

import rule from '../../../src/rules/vue/prefer-shared-collection'

RuleTester.describe = describe
RuleTester.it = it

const vue = new RuleTester({
  languageOptions: {
    parser: vueParser,
    parserOptions: { ecmaVersion: 2022, sourceType: 'module', parser: tsParser },
  },
})

vue.run('prefer-shared-collection', rule, {
  valid: [
    {
      filename: 'app/pages/orders.vue',
      code: '<template><NeDataTable :rows="rows" :columns="columns" /></template>',
    },
    {
      // The preset itself wraps UTable.
      filename: '/repo/packages/design/narduk-shell/src/runtime/components/NeDataTable.vue',
      code: '<template><UTable :data="rows" /></template>',
    },
    // A script mention is not a template use.
    {
      filename: 'app/pages/orders.vue',
      code: '<script setup lang="ts">const tag = \'UTable\'</script><template><div /></template>',
    },
    { filename: 'app/utils/table.ts', code: "export const tag = 'UTable'" },
  ],
  invalid: [
    {
      filename: 'app/pages/orders.vue',
      code: '<template><UTable :data="rows" /></template>',
      errors: [{ messageId: 'preferShared', data: { name: 'UTable' } }],
    },
    {
      filename: 'app/components/orders/OrderTable.vue',
      code: '<template><div><u-table :data="rows" /></div></template>',
      errors: [{ messageId: 'preferShared', data: { name: 'u-table' } }],
    },
    {
      // A file merely named like the preset elsewhere is not exempt by folder.
      filename: 'app/components/orders/MyNeDataTable.vue',
      code: '<template><UTable :data="rows" /></template>',
      errors: [{ messageId: 'preferShared' }],
    },
  ],
})
