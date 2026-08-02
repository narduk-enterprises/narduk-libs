import * as tsParser from '@typescript-eslint/parser'
import { RuleTester } from 'eslint'
import { describe, it } from 'vitest'

import rule from '../../../src/rules/vue/no-module-scope-ref'

RuleTester.describe = describe
RuleTester.it = it

const ts = new RuleTester({
  languageOptions: { parser: tsParser, parserOptions: { ecmaVersion: 2022, sourceType: 'module' } },
})

const COMPOSABLE = 'app/composables/useCounter.ts'

ts.run('no-module-scope-ref', rule, {
  valid: [
    {
      filename: COMPOSABLE,
      code: 'export function useCounter() { const count = ref(0); return { count } }',
    },
    {
      filename: COMPOSABLE,
      code: 'export function useCounter() { return { count: useState("count", () => 0) } }',
    },
    { filename: 'app/stores/counter.ts', code: 'const count = ref(0)' },
    { filename: 'app/components/Counter.vue', code: 'const count = ref(0)' },
  ],
  invalid: [
    {
      filename: COMPOSABLE,
      code: 'const count = ref(0)\nexport function useCounter() { return { count } }',
      errors: [{ messageId: 'moduleScopeRef', data: { name: 'ref' } }],
    },
    // Deep-review miss: v1 only inspected VariableDeclarator.init.
    {
      filename: COMPOSABLE,
      code: 'let count\ncount = ref(0)\nexport function useCounter() { return { count } }',
      errors: [{ messageId: 'moduleScopeRef' }],
    },
    {
      filename: COMPOSABLE,
      code: 'export const store = { count: ref(0) }',
      errors: [{ messageId: 'moduleScopeRef' }],
    },
    {
      filename: 'app/utils/state.ts',
      code: 'export const cached = shallowRef(null)',
      errors: [{ messageId: 'moduleScopeRef', data: { name: 'shallowRef' } }],
    },
  ],
})
