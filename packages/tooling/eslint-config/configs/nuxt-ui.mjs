// @ts-check
/**
 * `nuxt-ui` capability pack — Nuxt UI v4 migration guardrails.
 *
 * v1 shipped fifteen rules driven by a frozen `nuxt-ui-v4.json` spec whose
 * `replacedBy` data was prose-scraped and largely wrong; the spec tier and its
 * twelve spec-driven rules are dropped. What survives is the three hand-written
 * legacy-API rules the deep review gave a KEEP verdict.
 *
 * v1's `no-unknown-nuxt-ui-component` is replaced by `vue/no-undef-components`,
 * which `composeSharedConfigs()` wires fail-closed and `createAppLintConfig()`
 * widens from the app's generated `.nuxt/components.d.ts`.
 */

import narduk from '../dist/index.js'

/** @type {import('eslint').Linter.Config[]} */
const nuxtUiConfigs = [
  {
    name: 'narduk/nuxt-ui',
    files: ['**/*.vue'],
    plugins: { narduk },
    rules: {
      'narduk/no-legacy-overlay-model': 'error',
      'narduk/no-legacy-overlay-api': 'error',
      'narduk/no-legacy-options-prop': 'error',
    },
  },

  {
    name: 'narduk/nuxt-ui-script',
    files: ['**/*.{js,cjs,mjs,ts,cts,mts,tsx}'],
    plugins: { narduk },
    rules: {
      'narduk/no-legacy-overlay-api': 'error',
    },
  },
]

export { nuxtUiConfigs }
export default nuxtUiConfigs
