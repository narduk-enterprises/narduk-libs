import * as tsParser from '@typescript-eslint/parser'
import { RuleTester } from 'eslint'
import vueParser from 'vue-eslint-parser'
import { describe, expect, it } from 'vitest'

import rule from '../../../src/rules/general/no-legacy-overlay-model'

RuleTester.describe = describe
RuleTester.it = it

const ruleTester = new RuleTester({
  languageOptions: {
    parser: vueParser,
    parserOptions: { ecmaVersion: 2022, sourceType: 'module', parser: tsParser },
  },
})

ruleTester.run('no-legacy-overlay-model', rule, {
  valid: [
    // --- ported from v1 ---
    {
      filename: 'app/components/A.vue',
      code: '<template><UModal v-model:open="open" /></template>',
    },
    {
      filename: 'app/components/B.vue',
      code: '<template><UDrawer :open="open" @update:open="onOpen" /></template>',
    },
    {
      filename: 'app/components/C.vue',
      code: '<template><USelect v-model="value" :items="items" /></template>',
    },

    // --- new: the corrupting-fixer guard ---------------------------------
    // A dynamic argument cannot be read statically. v1 fell through
    // `getDirectiveArgument()`'s null return into the "bare v-model" branch,
    // reported, and then rewrote the whole key range to `v-model:open` —
    // DELETING `[key]`. Skipping the attribute is what keeps the fixer in the
    // output-safe class the review demanded.
    {
      filename: 'app/components/Dynamic.vue',
      code: '<template><UModal v-model:[key]="open" /></template>',
    },
    {
      filename: 'app/components/DynamicBind.vue',
      code: '<template><UDrawer v-bind:[prop]="open" /></template>',
    },
    {
      filename: 'app/components/DynamicOn.vue',
      code: '<template><UPopover @[evt]="onOpen" /></template>',
    },

    // --- new: scope boundaries -------------------------------------------
    // An app component that merely starts with `U` is not an overlay.
    {
      filename: 'app/components/UserModal.vue',
      code: '<template><UserModal v-model="open" /></template>',
    },
    // Already-correct modifier spelling.
    {
      filename: 'app/components/Modifier.vue',
      code: '<template><UModal v-model:open.lazy="open" /></template>',
    },
    // A native element is never a Nuxt UI overlay.
    {
      filename: 'app/components/Native.vue',
      code: '<template><dialog :model-value="open" /></template>',
    },
  ],
  invalid: [
    // --- ported from v1 ---
    {
      filename: 'app/components/A.vue',
      code: '<template><UModal v-model="open" /></template>',
      errors: [{ messageId: 'preferOpenModel', data: { componentName: 'UModal' } }],
      output: '<template><UModal v-model:open="open" /></template>',
    },
    {
      filename: 'app/components/B.vue',
      code: '<template><UModal v-model.lazy="open" /></template>',
      errors: [{ messageId: 'preferOpenModel', data: { componentName: 'UModal' } }],
      output: '<template><UModal v-model:open.lazy="open" /></template>',
    },
    {
      filename: 'app/components/C.vue',
      code: '<template><UDrawer :model-value="open" /></template>',
      errors: [
        {
          messageId: 'preferOpenProp',
          data: { componentName: 'UDrawer', propName: 'model-value' },
        },
      ],
      output: '<template><UDrawer :open="open" /></template>',
    },
    {
      filename: 'app/components/D.vue',
      code: '<template><UPopover @update:model-value="onOpen" /></template>',
      errors: [
        {
          messageId: 'preferOpenUpdate',
          data: { componentName: 'UPopover', eventName: 'update:model-value' },
        },
      ],
      output: '<template><UPopover @update:open="onOpen" /></template>',
    },

    // --- new: adversarial --------------------------------------------------
    // camelCase event spelling. The message must echo the spelling the author
    // WROTE: `VIdentifier.name` is case-folded, so before the rawName fix this
    // told them to replace `"update:modelvalue"`, a string not in their file.
    {
      filename: 'app/components/Camel.vue',
      code: '<template><UDrawer @update:modelValue="onOpen" /></template>',
      errors: [
        {
          messageId: 'preferOpenUpdate',
          data: { componentName: 'UDrawer', eventName: 'update:modelValue' },
        },
      ],
      output: '<template><UDrawer @update:open="onOpen" /></template>',
    },

    /* ---- camelCase prop spellings: the half of the rule that was blind ----
     * `modelValue` arrives as `modelvalue`, and `normalizePropName('modelvalue')`
     * is `'modelvalue'` — never equal to `'modelValue'`. Every camelCase binding
     * below went unreported until the attribute checks read `rawName`. This is
     * the spelling the older Nuxt UI docs used, so it is the likelier one in
     * real code than the kebab-case form the rule did catch. */
    {
      filename: 'app/components/CamelModel.vue',
      code: '<template><UModal v-model:modelValue="open" /></template>',
      errors: [
        {
          messageId: 'preferOpenProp',
          data: { componentName: 'UModal', propName: 'modelValue' },
        },
      ],
      output: '<template><UModal v-model:open="open" /></template>',
    },
    {
      filename: 'app/components/CamelBind.vue',
      code: '<template><UDrawer :modelValue="open" /></template>',
      errors: [
        {
          messageId: 'preferOpenProp',
          data: { componentName: 'UDrawer', propName: 'modelValue' },
        },
      ],
      output: '<template><UDrawer :open="open" /></template>',
    },
    {
      filename: 'app/components/CamelStatic.vue',
      code: '<template><UPopover modelValue="true" /></template>',
      errors: [
        {
          messageId: 'preferOpenProp',
          data: { componentName: 'UPopover', propName: 'modelValue' },
        },
      ],
      output: '<template><UPopover open="true" /></template>',
    },
    {
      filename: 'app/components/CamelBindLong.vue',
      code: '<template><USlideover v-bind:modelValue="open" /></template>',
      errors: [
        {
          messageId: 'preferOpenProp',
          data: { componentName: 'USlideover', propName: 'modelValue' },
        },
      ],
      output: '<template><USlideover v-bind:open="open" /></template>',
    },
    {
      filename: 'app/components/CamelBoth.vue',
      code: '<template><UDrawer :modelValue="open" @update:modelValue="onOpen" /></template>',
      errors: [{ messageId: 'preferOpenProp' }, { messageId: 'preferOpenUpdate' }],
      output: '<template><UDrawer :open="open" @update:open="onOpen" /></template>',
    },
    // Static (non-directive) attribute spelling.
    {
      filename: 'app/components/Static.vue',
      code: '<template><USlideover model-value="true" /></template>',
      errors: [
        {
          messageId: 'preferOpenProp',
          data: { componentName: 'USlideover', propName: 'model-value' },
        },
      ],
      output: '<template><USlideover open="true" /></template>',
    },
    // Kebab-case component spelling normalizes back to `UModal`.
    {
      filename: 'app/components/Kebab.vue',
      code: '<template><u-modal v-model="open" /></template>',
      errors: [{ messageId: 'preferOpenModel', data: { componentName: 'UModal' } }],
      output: '<template><u-modal v-model:open="open" /></template>',
    },
    // Realistic SFC: `<script setup lang="ts">`, several sibling attributes,
    // and a multi-line tag. The fix must touch only the directive key.
    {
      filename: 'app/components/ConfirmDialog.vue',
      code: '<script setup lang="ts">\nconst open = ref(false)\n</script>\n<template>\n  <UModal\n    v-model="open"\n    title="Confirm"\n    :ui="{ width: \'sm\' }"\n  />\n</template>',
      errors: [{ messageId: 'preferOpenModel' }],
      output:
        '<script setup lang="ts">\nconst open = ref(false)\n</script>\n<template>\n  <UModal\n    v-model:open="open"\n    title="Confirm"\n    :ui="{ width: \'sm\' }"\n  />\n</template>',
    },
    // Two legacy spellings on one element produce two independent,
    // non-overlapping fixes.
    {
      filename: 'app/components/Both.vue',
      code: '<template><UDrawer :model-value="open" @update:model-value="onOpen" /></template>',
      errors: [{ messageId: 'preferOpenProp' }, { messageId: 'preferOpenUpdate' }],
      output: '<template><UDrawer :open="open" @update:open="onOpen" /></template>',
    },
  ],
})

describe('no-legacy-overlay-model meta', () => {
  it('keeps its autofixer (proven output-safe by the `output:` assertions above)', () => {
    expect(rule.meta.fixable).toBe('code')
  })
})
