import * as tsParser from '@typescript-eslint/parser'
import { RuleTester } from 'eslint'
import vueParser from 'vue-eslint-parser'
import { describe, it } from 'vitest'

import rule from '../../../src/rules/nuxt/no-shadowed-shared-component'

RuleTester.describe = describe
RuleTester.it = it

const vue = new RuleTester({
  languageOptions: {
    parser: vueParser,
    parserOptions: { ecmaVersion: 2022, sourceType: 'module', parser: tsParser },
  },
})

const SFC = '<template><div /></template>'

vue.run('no-shadowed-shared-component', rule, {
  valid: [
    { filename: 'app/components/orders/OrderRow.vue', code: SFC },
    // `SharedTabs` is not `AppTabs`.
    { filename: 'app/components/shared/Tabs.vue', code: SFC },
    // Not a component directory.
    { filename: 'app/pages/AppTabs.vue', code: SFC },
    { filename: 'tests/components/AppTabs.vue', code: SFC },
    // Nuxt registers this as MyComponentsAppTabs; `lastIndexOf('components/')`
    // cut the path at `my-components/` and compared `AppTabs` (#777).
    { filename: 'app/components/my-components/app/Tabs.vue', code: SFC },
    // The owners' own sources are the shared component, not a copy of it.
    {
      filename: '/repo/packages/modules/narduk-core/runtime/app/components/shared/AppTabs.vue',
      code: SFC,
    },
    {
      filename: '/repo/packages/design/narduk-shell/src/runtime/components/NeStatePanel.vue',
      code: SFC,
    },
    { filename: '/repo/packages/modules/narduk-auth/app/components/AuthLoginCard.vue', code: SFC },
    // A narduk-ui design card is not the instrument.
    { filename: '/repo/packages/design/narduk-ui/components/NsLevelWell.card.vue', code: SFC },
  ],
  invalid: [
    {
      // Same file name, different folder: still a copy of narduk-core's AppTabs.
      filename: 'app/components/shared/AppTabs.vue',
      code: SFC,
      errors: [{ messageId: 'shadowed', data: { name: 'AppTabs', pkg: 'narduk-core' } }],
    },
    {
      filename: '/repo/apps/web/app/components/app/AppUserMenu.vue',
      code: SFC,
      errors: [{ messageId: 'shadowed', data: { name: 'AppUserMenu', pkg: 'narduk-auth' } }],
    },
    {
      // Nuxt registers `ne/StatePanel.vue` as NeStatePanel.
      filename: 'app/components/ne/StatePanel.vue',
      code: SFC,
      errors: [{ messageId: 'shadowed', data: { name: 'NeStatePanel', pkg: 'narduk-shell' } }],
    },
    {
      filename: 'components/charts/NardukLineChart.vue',
      code: SFC,
      errors: [{ messageId: 'shadowed', data: { name: 'NardukLineChart', pkg: 'narduk-charts' } }],
    },
    {
      filename: 'app/components/status/NsFreshnessChip.vue',
      code: SFC,
      errors: [{ messageId: 'shadowed', data: { name: 'NsFreshnessChip', pkg: 'narduk-ui' } }],
    },
  ],
})
