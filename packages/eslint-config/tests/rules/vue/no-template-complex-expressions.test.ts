import * as tsParser from '@typescript-eslint/parser'
import { RuleTester } from 'eslint'
import vueParser from 'vue-eslint-parser'
import { describe, it } from 'vitest'

import rule from '../../../src/rules/vue/no-template-complex-expressions'

RuleTester.describe = describe
RuleTester.it = it

const vue = new RuleTester({
  languageOptions: {
    parser: vueParser,
    parserOptions: { ecmaVersion: 2022, sourceType: 'module', parser: tsParser },
  },
})

const VUE_FILE = 'app/components/orders/OrderRow.vue'

vue.run('no-template-complex-expressions', rule, {
  valid: [
    { filename: VUE_FILE, code: '<template><div>{{ label }}</div></template>' },
    // Exactly at the default maxLogicalOps of 5 (six operands, five operators).
    {
      filename: VUE_FILE,
      code: '<template><div>{{ a && b && c && d && e && f }}</div></template>',
    },
    // Deep-review defect: the toFixed/toString/toLocaleString whitelist entries
    // were dead because only Identifier callees ever resolved a name.
    { filename: VUE_FILE, code: '<template><div>{{ price.toFixed(2) }}</div></template>' },
    {
      filename: VUE_FILE,
      code: '<template><div>{{ count.toLocaleString("en") }}</div></template>',
    },
    { filename: VUE_FILE, code: '<template><div>{{ a ? b : c }}</div></template>' },
    { filename: VUE_FILE, code: '<template><div>{{ fn(a, b, c) }}</div></template>' },
  ],
  invalid: [
    // Deep-review defect: countLogicalOps combined its recursive results with
    // Math.max, so it measured nesting DEPTH (1 for this left-associative chain)
    // instead of operator count (6), making maxLogicalOps: 5 unreachable.
    {
      filename: VUE_FILE,
      code: '<template><div>{{ a && b && c && d && e && f && g }}</div></template>',
      errors: [{ messageId: 'complexExpression' }],
    },
    {
      filename: VUE_FILE,
      code: '<template><div>{{ a && b || c && d || e && f || g }}</div></template>',
      errors: [{ messageId: 'complexExpression' }],
    },
    {
      filename: VUE_FILE,
      code: '<template><div>{{ a ? (b ? (c ? d : e) : f) : g }}</div></template>',
      errors: [{ messageId: 'complexExpression' }],
    },
    {
      filename: VUE_FILE,
      code: '<template><div>{{ fn(a, b, c, d) }}</div></template>',
      errors: [{ messageId: 'complexExpression' }],
    },
    {
      filename: VUE_FILE,
      code: '<template><div :title="fn(a ? b : c)">x</div></template>',
      errors: [{ messageId: 'complexExpression' }],
    },
    {
      filename: VUE_FILE,
      code: '<template><div>{{ a && b && c }}</div></template>',
      options: [{ maxLogicalOps: 1 }],
      errors: [{ messageId: 'complexExpression' }],
    },
  ],
})
