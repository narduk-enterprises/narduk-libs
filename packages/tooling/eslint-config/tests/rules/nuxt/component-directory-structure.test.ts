import * as tsParser from '@typescript-eslint/parser'
import { RuleTester } from 'eslint'
import vueParser from 'vue-eslint-parser'
import { describe, it } from 'vitest'

import rule from '../../../src/rules/nuxt/component-directory-structure'

RuleTester.describe = describe
RuleTester.it = it

const vue = new RuleTester({
  languageOptions: {
    parser: vueParser,
    parserOptions: { ecmaVersion: 2022, sourceType: 'module', parser: tsParser },
  },
})

const SFC = '<template><div /></template>'

vue.run('component-directory-structure', rule, {
  valid: [
    { filename: 'app/components/orders/OrderRow.vue', code: SFC },
    { filename: 'app/components/shared/Card.vue', code: SFC },
    { filename: 'app/components/app/AppHeader.vue', code: SFC },
    { filename: 'app/components/orders/parts/Row.vue', code: SFC },
    // Nuxt 3 layout, relative filename — v1's gate was dead here.
    { filename: 'components/orders/OrderRow.vue', code: SFC },
    { filename: '/repo/myapp/app/components/orders/OrderRow.vue', code: SFC },
    // Not a component.
    { filename: 'app/pages/index.vue', code: SFC },
    { filename: 'tests/components/OrderRow.vue', code: SFC },
  ],
  invalid: [
    {
      filename: 'app/components/OrderRow.vue',
      code: SFC,
      errors: [{ messageId: 'rootLevelComponent' }],
    },
    {
      filename: 'components/OrderRow.vue',
      code: SFC,
      errors: [{ messageId: 'rootLevelComponent' }],
    },
    {
      filename: 'app/components/orders/parts/rows/Cell.vue',
      code: SFC,
      errors: [{ messageId: 'componentTreeTooDeep', data: { actualDepth: '3', maxDepth: '2' } }],
    },
    {
      filename: 'app/components/orders/parts/Row.vue',
      code: SFC,
      options: [{ maxDepth: 1 }],
      errors: [{ messageId: 'componentTreeTooDeep', data: { actualDepth: '2', maxDepth: '1' } }],
    },
  ],
})
