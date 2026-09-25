import * as tsParser from '@typescript-eslint/parser'
import { RuleTester } from 'eslint'
import { describe, it } from 'vitest'

import rule from '../../../src/rules/nuxt/composable-primary-export'

RuleTester.describe = describe
RuleTester.it = it

const ts = new RuleTester({
  languageOptions: { parser: tsParser, parserOptions: { ecmaVersion: 2022, sourceType: 'module' } },
})

ts.run('composable-primary-export', rule, {
  valid: [
    {
      filename: 'app/composables/useCart.ts',
      code: 'export function useCart() { return {} }',
    },
    // Deep-review defect: function declarations hoist, so `export default useCart`
    // written ABOVE the declaration was invisible to v1's during-traversal lookup
    // and produced a spurious report.
    {
      filename: 'app/composables/useCart.ts',
      code: 'export default useCart\n\nfunction useCart() { return {} }',
    },
    {
      filename: 'app/composables/useCart.ts',
      code: 'const useCart = () => ({})\nexport { useCart }',
    },
    // Deep-review defect: v1 demanded index.ts rename its export to `index`.
    {
      filename: 'app/composables/index.ts',
      code: 'export { useCart } from "./useCart"\nexport function useOrders() { return {} }',
    },
    // Nuxt 3 layout, relative filename.
    { filename: 'composables/useCart.ts', code: 'export function useCart() { return {} }' },
    // Non-composable helpers are not primary exports.
    {
      filename: 'app/composables/useCart.ts',
      code: 'export function useCart() { return {} }\nexport function formatTotal(n) { return n }',
    },
    {
      filename: 'tests/composables/useCart.test.ts',
      code: 'export function useOther() { return {} }',
    },    // #885: an aliased export resolves through its local declaration.
    {
      filename: 'app/composables/useCart.ts',
      code: 'function cartImpl() { return {} }\nexport { cartImpl as useCart }',
    },
    // An aliased non-function is not a composable candidate.
    {
      filename: 'app/composables/useCart.ts',
      code: 'export function useCart() { return {} }\nconst settings = {}\nexport { settings as useCartSettings }',
    },
  ],
  invalid: [
    {
      filename: 'app/composables/useCart.ts',
      code: 'export function useBasket() { return {} }',
      errors: [{ messageId: 'composableNameMatchesFile', data: { expectedName: 'useCart' } }],
    },
    {
      filename: 'app/composables/useCart.ts',
      code: 'export function useCart() { return {} }\nexport function useCartTotals() { return {} }',
      errors: [{ messageId: 'singlePrimaryExport', data: { name: 'useCartTotals' } }],
    },
    {
      filename: '/repo/myapp/app/composables/useCart.ts',
      code: 'export default useBasket\n\nfunction useBasket() { return {} }',
      errors: [{ messageId: 'composableNameMatchesFile', data: { expectedName: 'useCart' } }],
    },
    // #885: the aliased second export was looked up by its alias and dropped.
    {
      filename: 'app/composables/useCart.ts',
      code: 'export function useCart() { return {} }\nfunction helper() { const items = ref([]); return items }\nexport { helper as useCartHelper }',
      errors: [{ messageId: 'singlePrimaryExport', data: { name: 'useCartHelper' } }],
    },
    {
      filename: 'app/composables/useCart.ts',
      code: 'const basket = () => ({})\nexport { basket as useBasket }',
      errors: [{ messageId: 'composableNameMatchesFile', data: { expectedName: 'useCart' } }],
    },
  ],
})
