import * as tsParser from '@typescript-eslint/parser'
import { RuleTester } from 'eslint'
import { describe, it } from 'vitest'

import rule from '../../../src/rules/vue/no-non-serializable-store-state'

RuleTester.describe = describe
RuleTester.it = it

const ts = new RuleTester({
  languageOptions: { parser: tsParser, parserOptions: { ecmaVersion: 2022, sourceType: 'module' } },
})

const STORE = 'app/stores/cart.ts'

ts.run('no-non-serializable-store-state', rule, {
  valid: [
    {
      filename: STORE,
      code: 'export const useCart = defineStore("cart", () => { const items = ref([]); return { items } })',
    },
    {
      filename: STORE,
      code: 'export const useCart = defineStore("cart", { state: () => ({ items: [], total: 0 }) })',
    },
    // Deep-review false positive: v1 flagged ANY `new Map()` in the file,
    // including a module-level lookup constant that is not state.
    {
      filename: STORE,
      code: 'const LABELS = new Map([["a", "A"]])\nexport const useCart = defineStore("cart", () => { const items = ref([]); return { items, LABELS } })',
    },
    // A Date built inside an action is not state.
    {
      filename: STORE,
      code: 'export const useCart = defineStore("cart", () => { const at = ref(""); function touch() { at.value = new Date().toISOString() } return { at, touch } })',
    },
    { filename: 'app/utils/cart.ts', code: 'export const index = new Map()' },
  ],
  invalid: [
    {
      filename: STORE,
      code: 'export const useCart = defineStore("cart", () => { const index = ref(new Map()); return { index } })',
      errors: [{ messageId: 'nonSerializable', data: { name: 'Map' } }],
    },
    // The message promised "Map, Set, Date, or class instances" while v1's
    // matcher only recognised Map and Set.
    {
      filename: STORE,
      code: 'export const useCart = defineStore("cart", { state: () => ({ seen: new Set(), createdAt: new Date() }) })',
      errors: [
        { messageId: 'nonSerializable', data: { name: 'Set' } },
        { messageId: 'nonSerializable', data: { name: 'Date' } },
      ],
    },
    {
      filename: STORE,
      code: 'export const useCart = defineStore("cart", () => { const engine = ref(new PricingEngine()); return { engine } })',
      errors: [{ messageId: 'nonSerializable', data: { name: 'PricingEngine' } }],
    },
    {
      filename: STORE,
      code: 'export const useCart = defineStore("cart", () => { const index = ref<Map<string, number>>(); return { index } })',
      errors: [{ messageId: 'nonSerializableType', data: { name: 'Map' } }],
    },
    {
      filename: STORE,
      code: 'export const useCart = defineStore("cart", () => { const state = reactive({ at: new Date() }); return { state } })',
      errors: [{ messageId: 'nonSerializable', data: { name: 'Date' } }],
    },
  ],
})
