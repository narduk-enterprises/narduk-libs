import * as tsParser from '@typescript-eslint/parser'
import { RuleTester } from 'eslint'
import vueParser from 'vue-eslint-parser'
import { describe, expect, it } from 'vitest'

import rule from '../../../src/rules/general/no-legacy-options-prop'

RuleTester.describe = describe
RuleTester.it = it

const ruleTester = new RuleTester({
  languageOptions: {
    parser: vueParser,
    parserOptions: { ecmaVersion: 2022, sourceType: 'module', parser: tsParser },
  },
})

ruleTester.run('no-legacy-options-prop', rule, {
  valid: [
    // --- ported from v1 ---
    { filename: 'app/components/A.vue', code: '<template><USelect :items="items" /></template>' },
    {
      filename: 'app/components/B.vue',
      code: '<template><USelectMenu items="users" /></template>',
    },
    {
      filename: 'app/components/C.vue',
      code: '<template><UCheckboxGroup :items="items" /></template>',
    },

    // --- new: adversarial --------------------------------------------------
    // An app component whose name merely starts with `U` must not be swept up.
    // (The review proved v1's separate `isNuxtUIComponent` catalog check did
    // exactly that to `UserCard` / `UploadDropzone`; this rule's fixed
    // component set is what keeps it clean, and this locks that in.)
    {
      filename: 'app/components/UserSelect.vue',
      code: '<template><UserSelect :options="items" /></template>',
    },
    {
      filename: 'app/components/Upload.vue',
      code: '<template><UploadDropzone :options="items" /></template>',
    },
    // Casing matters: `USelectmenu` is not the component.
    {
      filename: 'app/components/Cased.vue',
      code: '<template><USelectmenu :options="items" /></template>',
    },
    // Dynamic argument — unreadable statically, so skipped BEFORE any report,
    // which is also what stops the fixer from deleting it.
    {
      filename: 'app/components/Dynamic.vue',
      code: '<template><UInputMenu v-bind:[prop]="items" /></template>',
    },
    // Object spread binding has no argument at all.
    {
      filename: 'app/components/Spread.vue',
      code: '<template><USelect v-bind="attrs" /></template>',
    },
    // A native element is not a Nuxt UI component.
    {
      filename: 'app/components/Native.vue',
      code: '<template><select :options="items" /></template>',
    },
  ],
  invalid: [
    // --- ported from v1 ---
    {
      filename: 'app/components/A.vue',
      code: '<template><USelect :options="items" /></template>',
      errors: [
        { messageId: 'preferItems', data: { componentName: 'USelect', propName: 'options' } },
      ],
      output: '<template><USelect :items="items" /></template>',
    },
    {
      filename: 'app/components/B.vue',
      code: '<template><USelectMenu options="users" /></template>',
      errors: [
        { messageId: 'preferItems', data: { componentName: 'USelectMenu', propName: 'options' } },
      ],
      output: '<template><USelectMenu items="users" /></template>',
    },
    {
      filename: 'app/components/C.vue',
      code: '<template><UInputMenu v-bind:options="items" /></template>',
      errors: [
        { messageId: 'preferItems', data: { componentName: 'UInputMenu', propName: 'options' } },
      ],
      output: '<template><UInputMenu v-bind:items="items" /></template>',
    },

    // --- new: the `rawName` proof ------------------------------------------
    // `VElement.name` is lowercased by vue-eslint-parser, so a multi-word
    // component name normalizes to `USelectmenu` and never matches the set.
    // Matching `rawName` is what makes `<USelectMenu>` reachable at all — the
    // same lowercase-name trap the review proved had inverted the two
    // `require-client-only-*` hydration rules.
    {
      filename: 'app/components/Menu.vue',
      code: '<script setup lang="ts">\nconst items = []\n</script>\n<template><USelectMenu :options="items" multiple /></template>',
      errors: [
        { messageId: 'preferItems', data: { componentName: 'USelectMenu', propName: 'options' } },
      ],
      output:
        '<script setup lang="ts">\nconst items = []\n</script>\n<template><USelectMenu :items="items" multiple /></template>',
    },
    // Kebab-case spelling normalizes back to the PascalCase component.
    {
      filename: 'app/components/Kebab.vue',
      code: '<template><u-select :options="items" /></template>',
      errors: [
        { messageId: 'preferItems', data: { componentName: 'USelect', propName: 'options' } },
      ],
      output: '<template><u-select :items="items" /></template>',
    },
    // The fix replaces the key/argument range only, so a multi-line binding
    // and every neighbouring attribute survive untouched.
    {
      filename: 'app/components/Multi.vue',
      code: '<template>\n  <USelect\n    v-model="value"\n    :options="items.filter(Boolean)"\n    class="w-full"\n  />\n</template>',
      errors: [{ messageId: 'preferItems' }],
      output:
        '<template>\n  <USelect\n    v-model="value"\n    :items="items.filter(Boolean)"\n    class="w-full"\n  />\n</template>',
    },
  ],
})

describe('no-legacy-options-prop meta', () => {
  it('keeps its autofixer (proven output-safe by the `output:` assertions above)', () => {
    expect(rule.meta.fixable).toBe('code')
  })
})
