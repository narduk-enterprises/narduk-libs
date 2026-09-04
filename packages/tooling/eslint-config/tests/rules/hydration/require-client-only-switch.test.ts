import * as tsParser from '@typescript-eslint/parser'
import { RuleTester } from 'eslint'
import vueParser from 'vue-eslint-parser'
import { describe, it } from 'vitest'

import rule from '../../../src/rules/hydration/require-client-only-switch'

RuleTester.describe = describe
RuleTester.it = it

const vue = new RuleTester({
  languageOptions: {
    parser: vueParser,
    parserOptions: { ecmaVersion: 2022, sourceType: 'module', parser: tsParser },
  },
})

const VUE_FILE = 'app/components/settings/PreferencesPanel.vue'

vue.run('require-client-only-switch', rule, {
  valid: [
    // Deep-review proof 1, case B: v1 reported this CORRECT code as an error,
    // because `parent.name === 'ClientOnly'` can never be true (name is lowercased).
    {
      filename: VUE_FILE,
      code: '<template><ClientOnly><u-switch v-model="x" /></ClientOnly></template>',
    },
    {
      filename: VUE_FILE,
      code: '<template><ClientOnly><USwitch v-model="x" /></ClientOnly></template>',
    },
    { filename: VUE_FILE, code: '<template><client-only><USwitch /></client-only></template>' },
    {
      filename: VUE_FILE,
      code: '<template><LazyClientOnly><USwitch /></LazyClientOnly></template>',
    },
    {
      filename: VUE_FILE,
      code: '<template><div><ClientOnly><section><USwitch /></section></ClientOnly></div></template>',
    },
    { filename: VUE_FILE, code: '<template><UButton label="Save" /></template>' },
    // Not an SFC: no visitor is installed at all.
    { filename: 'app/utils/toggle.ts', code: 'export const on = true' },
  ],
  invalid: [
    // Deep-review proof 1, case A: the actual bug, which v1 missed entirely.
    {
      filename: VUE_FILE,
      code: '<template><USwitch v-model="x" /></template>',
      errors: [{ messageId: 'requireClientOnly' }],
    },
    // kebab spelling of the same component
    {
      filename: VUE_FILE,
      code: '<template><u-switch v-model="x" /></template>',
      errors: [{ messageId: 'requireClientOnly' }],
    },
    {
      filename: VUE_FILE,
      code: '<template><div class="row"><USwitch /></div></template>',
      errors: [{ messageId: 'requireClientOnly' }],
    },
    {
      filename: VUE_FILE,
      code: '<template><div><USwitch /><u-switch /></div></template>',
      errors: [{ messageId: 'requireClientOnly' }, { messageId: 'requireClientOnly' }],
    },
  ],
})
