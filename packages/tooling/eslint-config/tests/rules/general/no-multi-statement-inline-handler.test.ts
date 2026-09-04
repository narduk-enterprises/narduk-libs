/**
 * v1 shipped this rule with ZERO tests (deep review: "45 LOC / **none**").
 * Every case below is new.
 */

import * as tsParser from '@typescript-eslint/parser'
import { RuleTester } from 'eslint'
import vueParser from 'vue-eslint-parser'
import { describe, expect, it } from 'vitest'

import rule from '../../../src/rules/general/no-multi-statement-inline-handler'

RuleTester.describe = describe
RuleTester.it = it

const vue = new RuleTester({
  languageOptions: {
    parser: vueParser,
    parserOptions: { ecmaVersion: 2022, sourceType: 'module', parser: tsParser },
  },
})

const ts = new RuleTester({
  languageOptions: {
    parser: tsParser,
    parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  },
})

vue.run('no-multi-statement-inline-handler', rule, {
  valid: [
    { filename: 'app/components/A.vue', code: '<template><button @click="submit()" /></template>' },
    // A single statement with a trailing semicolon is still one statement.
    {
      filename: 'app/components/B.vue',
      code: '<template><button @click="submit();" /></template>',
    },
    { filename: 'app/components/C.vue', code: '<template><button @click="count++" /></template>' },
    // Method reference, not a statement list.
    { filename: 'app/components/D.vue', code: '<template><button @click="submit" /></template>' },
    // Documented boundary: an explicit arrow function parses as an
    // ArrowFunctionExpression inside a VExpressionContainer, not a
    // VOnExpression, so it is not reported. That form is already the
    // "extract it" shape the rule asks for.
    {
      filename: 'app/components/E.vue',
      code: '<template><button @click="() => { a(); b() }" /></template>',
    },
    // Non-`on` directives are out of scope.
    {
      filename: 'app/components/F.vue',
      code: '<template><input :value="a" :placeholder="b" /></template>',
    },
    // Inline conditional is one statement.
    {
      filename: 'app/components/G.vue',
      code: '<template><button @click="ok ? save() : cancel()" /></template>',
    },
    // Sequence expression is a single ExpressionStatement, not two statements.
    {
      filename: 'app/components/H.vue',
      code: '<template><button @click="(a(), b())" /></template>',
    },
  ],
  invalid: [
    {
      filename: 'app/components/Bad.vue',
      code: '<template><button @click="a(); b()" /></template>',
      errors: [{ messageId: 'noMultiStatement' }],
    },
    // Three statements still produce exactly one report.
    {
      filename: 'app/components/Bad3.vue',
      code: '<template><button @click="a();b();c()" /></template>',
      errors: [{ messageId: 'noMultiStatement' }],
    },
    // Longhand `v-on:` spelling.
    {
      filename: 'app/components/Longhand.vue',
      code: '<template><form v-on:submit="validate(); send()" /></template>',
      errors: [{ messageId: 'noMultiStatement' }],
    },
    // Newline-separated statements (no semicolons) — ASI still yields two.
    {
      filename: 'app/components/Newlines.vue',
      code: '<template>\n  <button @click="\n    open = true\n    track()\n  " />\n</template>',
      errors: [{ messageId: 'noMultiStatement' }],
    },
    // Event modifiers must not disturb the directive-name match.
    {
      filename: 'app/components/Modifiers.vue',
      code: '<template><form @submit.prevent="validate(); send()" /></template>',
      errors: [{ messageId: 'noMultiStatement' }],
    },
    // Dynamic event name: `@[evt]` — still a `v-on` directive.
    {
      filename: 'app/components/Dynamic.vue',
      code: '<template><button @[evt]="a(); b()" /></template>',
      errors: [{ messageId: 'noMultiStatement' }],
    },
    // Two offending handlers on one element report twice.
    {
      filename: 'app/components/Two.vue',
      code: '<template><button @click="a(); b()" @blur="c(); d()" /></template>',
      errors: [{ messageId: 'noMultiStatement' }, { messageId: 'noMultiStatement' }],
    },
    // Nuxt UI component, `<script setup lang="ts">` present — the realistic
    // shape, exercised through a relative SFC filename.
    {
      filename: 'app/components/Toolbar.vue',
      code: '<script setup lang="ts">\nconst open = ref(false)\n</script>\n<template><UButton @click="open = true; emit(\'opened\')" /></template>',
      errors: [{ messageId: 'noMultiStatement' }],
    },
  ],
})

// The `.vue` filename gate: a non-SFC file returns an empty visitor even when
// vue-eslint-parser is not in play at all.
ts.run('no-multi-statement-inline-handler (non-SFC files are skipped)', rule, {
  valid: [{ filename: 'app/composables/useThing.ts', code: 'const on = () => { a(); b() }' }],
  invalid: [],
})

describe('no-multi-statement-inline-handler meta', () => {
  it('declares no options and no fixer', () => {
    expect(rule.meta.schema).toEqual([])
    expect(rule.meta).not.toHaveProperty('fixable')
  })
})
