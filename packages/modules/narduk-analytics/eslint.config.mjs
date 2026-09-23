// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs'
import { createAppLintConfig } from '@narduk-enterprises/eslint-config/eslint-app-config'
import { nardukTemplateStrictCapabilityPacks } from '@narduk-enterprises/narduk-core/eslint-capability-packs'
import {
  importXVueCoreModuleFragment,
  redundantNuxtAutoImportFlatConfig,
} from '@narduk-enterprises/narduk-core/eslint-nuxt-flat-fragments'

// The sanctioned composition path: createAppLintConfig strips the
// Nuxt-managed plugin registrations (@typescript-eslint, vue, nuxt) from the
// shared packs so withNuxt's own instances stay the only ones. Hand-rolling
// withNuxt(...composeSharedConfigs(...)) double-registers them under v2.
// `narduk/prefer-shared-collection` is an app-tier rule. This module sits below
// narduk-shell, so its admin panels keep plain <UTable>s rather than depend on
// the app-tier, 0.x shell (narduk-libs#744, Logan 2026-09-22).
const tablesStayBare = {
  name: 'narduk-analytics/tables-stay-bare',
  files: ['app/**/*.vue'],
  rules: { 'narduk/prefer-shared-collection': 'off' },
}

export default createAppLintConfig({
  withNuxt,
  capabilityPacks: [...nardukTemplateStrictCapabilityPacks],
  extraOverrides: [redundantNuxtAutoImportFlatConfig, importXVueCoreModuleFragment, tablesStayBare],
})
