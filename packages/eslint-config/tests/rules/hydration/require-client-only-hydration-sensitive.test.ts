import * as tsParser from '@typescript-eslint/parser'
import { RuleTester } from 'eslint'
import vueParser from 'vue-eslint-parser'
import { describe, it } from 'vitest'

import rule from '../../../src/rules/hydration/require-client-only-hydration-sensitive'

RuleTester.describe = describe
RuleTester.it = it

const vue = new RuleTester({
  languageOptions: {
    parser: vueParser,
    parserOptions: { ecmaVersion: 2022, sourceType: 'module', parser: tsParser },
  },
})

const VUE_FILE = 'app/components/app/AppHeader.vue'

vue.run('require-client-only-hydration-sensitive', rule, {
  valid: [
    // Deep-review proof 1, case E: v1 reported this correct code as an error.
    {
      filename: VUE_FILE,
      code: '<template><ClientOnly><u-navigation-menu /></ClientOnly></template>',
    },
    {
      filename: VUE_FILE,
      code: '<template><ClientOnly><UNavigationMenu :items="items" /></ClientOnly></template>',
    },
    {
      filename: VUE_FILE,
      code: '<template><client-only><UColorModeButton /></client-only></template>',
    },
    {
      filename: VUE_FILE,
      code: '<template><ClientOnly><nav><UColorModeSelect /></nav></ClientOnly></template>',
    },
    { filename: VUE_FILE, code: '<template><UButton label="Menu" /></template>' },
    { filename: 'app/utils/nav.ts', code: 'export const items = []' },
  ],
  invalid: [
    // Deep-review proof 1, case D: the actual bug, which v1 missed entirely.
    {
      filename: VUE_FILE,
      code: '<template><UNavigationMenu :items="items" /></template>',
      errors: [{ messageId: 'requireClientOnly' }],
    },
    {
      filename: VUE_FILE,
      code: '<template><u-navigation-menu /></template>',
      errors: [{ messageId: 'requireClientOnly' }],
    },
    {
      filename: VUE_FILE,
      code: '<template><UColorModeButton /></template>',
      errors: [{ messageId: 'requireClientOnly' }],
    },
    {
      filename: VUE_FILE,
      code: '<template><div><u-color-mode-select /></div></template>',
      errors: [{ messageId: 'requireClientOnly' }],
    },
  ],
})
