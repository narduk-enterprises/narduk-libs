import * as tsParser from '@typescript-eslint/parser'
import { RuleTester } from 'eslint'
import { describe, it } from 'vitest'

import rule from '../../../src/rules/nuxt/require-use-prefix-for-composables'

RuleTester.describe = describe
RuleTester.it = it

const ts = new RuleTester({
  languageOptions: { parser: tsParser, parserOptions: { ecmaVersion: 2022, sourceType: 'module' } },
})

const FILE = 'app/composables/useCart.ts'

ts.run('require-use-prefix-for-composables', rule, {
  valid: [
    {
      filename: FILE,
      code: 'export function useCart() { const items = ref([]); return { items } }',
    },
    // A pure helper exported beside a composable is not a composable.
    {
      filename: FILE,
      code: 'export function useCart() { const items = ref([]); return { items } }\nexport function formatTotal(n) { return n.toFixed(2) }',
    },
    {
      filename: 'app/utils/cart.ts',
      code: 'export function buildCart() { const items = ref([]); return items }',
    },
    {
      filename: 'tests/composables/cart.test.ts',
      code: 'export function buildCart() { return ref([]) }',
    },
    // #885: a use-prefixed alias of a reactive helper is correctly named.
    {
      filename: FILE,
      code: 'function cartState() { const items = ref([]); return { items } }\nexport { cartState as useCartState }',
    },
  ],
  invalid: [
    // Deep-review defect: v1 returned early if ANY export was use-prefixed, so a
    // second, genuinely reactive export was exempted by its neighbour.
    {
      filename: FILE,
      code: 'export function useCart() { const items = ref([]); return { items } }\nexport function createCart() { const items = ref([]); return { items } }',
      errors: [
        { messageId: 'requireUsePrefix', data: { name: 'createCart', suggested: 'CreateCart' } },
      ],
    },
    {
      filename: FILE,
      code: 'export function cartState() { const items = ref([]); onMounted(() => {}); return { items } }',
      errors: [
        { messageId: 'requireUsePrefix', data: { name: 'cartState', suggested: 'CartState' } },
      ],
    },
    {
      filename: 'composables/useCart.ts',
      code: 'const cartState = () => { const items = ref([]); return { items } }\nexport { cartState }',
      errors: [
        { messageId: 'requireUsePrefix', data: { name: 'cartState', suggested: 'CartState' } },
      ],
    },
    // #885: the alias was looked up instead of the declaration it names.
    {
      filename: FILE,
      code: 'function cartState() { const items = ref([]); onMounted(() => {}); return { items } }\nexport { cartState as cartStatePublic }',
      errors: [
        {
          messageId: 'requireUsePrefix',
          data: { name: 'cartStatePublic', suggested: 'CartStatePublic' },
        },
      ],
    },
  ],
})
