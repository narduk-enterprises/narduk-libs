import * as tsParser from '@typescript-eslint/parser'
import { RuleTester } from 'eslint'
import vueParser from 'vue-eslint-parser'
import { describe, it } from 'vitest'

import rule from '../../../src/rules/general/pinia-require-defineStore-id'

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

ts.run('pinia-require-defineStore-id', rule, {
  valid: [
    // --- ported from v1 (real store filenames instead of `test.vue`) ------
    {
      filename: 'app/stores/counter.ts',
      code: `import { defineStore } from 'pinia'
export const useStore = defineStore('store-id', () => {
  return {}
})`,
    },
    {
      filename: 'app/stores/user.ts',
      code: `import { defineStore } from 'pinia'
export const useStore = defineStore('my-store', {
  state: () => ({}),
})`,
    },

    // --- new: documented boundaries -------------------------------------
    // Aliased import: the callee is `createStore`, not `defineStore`, so the
    // rule does not fire. The review's repo-wide alias weakness class.
    {
      filename: 'app/stores/aliased.ts',
      code: `import { defineStore as createStore } from 'pinia'
export const useStore = createStore(dynamicId, () => ({}))`,
    },
    // Namespace call: the callee is a MemberExpression, not an Identifier.
    {
      filename: 'app/stores/namespace.ts',
      code: `import * as pinia from 'pinia'
export const useStore = pinia.defineStore(dynamicId, () => ({}))`,
    },
    // A local helper that happens to be named differently is untouched.
    {
      filename: 'app/stores/helper.ts',
      code: `function makeStore(id) { return id }
export const useStore = makeStore(someId)`,
    },
  ],
  invalid: [
    // --- ported from v1 ---
    {
      filename: 'app/stores/empty.ts',
      code: `import { defineStore } from 'pinia'
export const useStore = defineStore()`,
      errors: [{ messageId: 'requireStoreId' }],
    },
    {
      filename: 'app/stores/indirect.ts',
      code: `import { defineStore } from 'pinia'
const id = 'store-id'
export const useStore = defineStore(id, () => {})`,
      errors: [{ messageId: 'requireStoreId' }],
    },

    // --- new: adversarial ------------------------------------------------
    // Interpolated template literal — a genuinely dynamic id, the bug the rule
    // exists to catch.
    {
      filename: 'app/stores/interpolated.ts',
      code: `import { defineStore } from 'pinia'
export const useStore = defineStore(\`user-\${tenant}\`, () => {})`,
      errors: [{ messageId: 'requireStoreId' }],
    },
    // A STATIC template literal is legal Pinia but is indistinguishable at
    // this layer from the interpolated form, so it reports too. Asserted so
    // the behaviour is a decision on the record, not an accident.
    {
      filename: 'app/stores/static-template.ts',
      code: `import { defineStore } from 'pinia'
export const useStore = defineStore(\`user\`, () => {})`,
      errors: [{ messageId: 'requireStoreId' }],
    },
    // Non-string literal.
    {
      filename: 'app/stores/numeric.ts',
      code: `import { defineStore } from 'pinia'
export const useStore = defineStore(42, () => {})`,
      errors: [{ messageId: 'requireStoreId' }],
    },
    // Imported constant id.
    {
      filename: 'app/stores/imported-id.ts',
      code: `import { defineStore } from 'pinia'
import { STORE_ID } from './ids'
export const useStore = defineStore(STORE_ID, () => {})`,
      errors: [{ messageId: 'requireStoreId' }],
    },
  ],
})

vue.run('pinia-require-defineStore-id (vue SFC)', rule, {
  valid: [
    {
      filename: 'app/components/Inline.vue',
      code: `<script setup lang="ts">
import { defineStore } from 'pinia'
const useLocal = defineStore('inline-store', () => ({}))
</script>`,
    },
  ],
  invalid: [
    // --- new: the same defect inside an SFC script block ------------------
    {
      filename: 'app/components/Inline.vue',
      code: `<script setup lang="ts">
import { defineStore } from 'pinia'
const useLocal = defineStore(storeId, () => ({}))
</script>
<template><div /></template>`,
      errors: [{ messageId: 'requireStoreId' }],
    },
  ],
})
