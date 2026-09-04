import * as tsParser from '@typescript-eslint/parser'
import { RuleTester } from 'eslint'
import { describe, it } from 'vitest'

import rule from '../../../src/rules/vue/no-composable-conditional-hooks'

RuleTester.describe = describe
RuleTester.it = it

const ts = new RuleTester({
  languageOptions: { parser: tsParser, parserOptions: { ecmaVersion: 2022, sourceType: 'module' } },
})

const COMPOSABLE = 'app/composables/useThing.ts'

ts.run('no-composable-conditional-hooks', rule, {
  valid: [
    // Deep-review false positive: v1 listed `isRef`/`unref`/`toValue` as
    // order-sensitive hooks, so this canonical normalization reported.
    {
      filename: COMPOSABLE,
      code: 'export function useThing(src) { return isRef(src) ? src.value : src }',
    },
    {
      filename: COMPOSABLE,
      code: 'export function useThing(src) { return unref(src) ?? toValue(src) }',
    },
    {
      filename: COMPOSABLE,
      code: 'export function useThing() { const a = ref(0); watch(a, () => {}); return { a } }',
    },
    // Nested function boundary: the callback is not the composable's own body.
    {
      filename: COMPOSABLE,
      code: 'export function useThing(items) { return items.map(() => ref(0)) }',
    },
    // Out of scope: not a composables file.
    {
      filename: 'app/utils/build.ts',
      code: 'export function build(o) { if (o.enabled) { const a = ref(0); return a } }',
    },
  ],
  invalid: [
    {
      filename: COMPOSABLE,
      code: 'export function useThing(o) { if (o.enabled) { const a = ref(0); return a } }',
      errors: [{ messageId: 'conditionalHook' }],
    },
    // Deep-review miss: v1 covered `for`/`while` but not for-of — the loop form
    // that actually leaks watchers.
    {
      filename: COMPOSABLE,
      code: 'export function useThing(keys) { for (const k of keys) { watch(k, () => {}) } }',
      errors: [{ messageId: 'conditionalHook' }],
    },
    {
      filename: COMPOSABLE,
      code: 'export function useThing(map) { for (const k in map) { watchEffect(() => map[k]) } }',
      errors: [{ messageId: 'conditionalHook' }],
    },
    {
      filename: COMPOSABLE,
      code: 'export function useThing(o) { const a = o.enabled && computed(() => 1); return a }',
      errors: [{ messageId: 'conditionalHook' }],
    },
    {
      filename: COMPOSABLE,
      code: 'export function useThing(o) { const a = o.flag ? ref(1) : ref(2); return a }',
      errors: [{ messageId: 'conditionalHook' }, { messageId: 'conditionalHook' }],
    },
    {
      filename: COMPOSABLE,
      code: 'export function useThing(o) { switch (o.kind) { case "a": { onMounted(() => {}); break } } }',
      errors: [{ messageId: 'conditionalHook' }],
    },
  ],
})
