// @ts-check
/**
 * `core` capability pack — hydration safety, Nuxt data-fetching discipline,
 * Vue 3 composition correctness, Pinia hygiene, and client `app/**` perf.
 *
 * v1's `prefer-import-meta-client` / `prefer-import-meta-dev` are replaced by
 * `@nuxt/eslint-plugin`'s `prefer-import-meta`; v1's two bespoke Pinia
 * state-mutation/storeToRefs rules are replaced by `eslint-plugin-pinia`.
 */

import nuxt from '@nuxt/eslint-plugin'
import pinia from 'eslint-plugin-pinia'
import vue from 'eslint-plugin-vue'

import narduk from '../dist/index.js'

const APP_SCRIPT_GLOBS = ['app/**/*.{js,cjs,mjs,jsx,ts,cts,mts,tsx}']

/** @type {import('eslint').Linter.Config[]} */
const coreConfigs = [
  {
    name: 'narduk/core-hydration',
    files: ['**/*.vue'],
    plugins: { narduk },
    rules: {
      'narduk/require-client-only-switch': 'error',
      'narduk/require-client-only-hydration-sensitive': 'warn',
      'narduk/no-ssr-dom-access': 'error',
      'narduk/no-locale-date-format-in-ssr-text': 'warn',
      'narduk/no-attrs-on-fragment': 'error',
      // Error from day one (2026-09-18): buoys PR #202 shipped a hydration
      // mismatch from exactly this. The rule reports only render paths.
      'narduk/no-render-clock': 'error',
    },
  },

  {
    // Only `nuxt.config.*` publishes runtimeConfig; the rule re-checks the
    // filename, the glob just keeps it off every other file.
    name: 'narduk/core-config-secrets',
    files: ['**/nuxt.config.{js,cjs,mjs,ts,cts,mts}'],
    plugins: { narduk },
    rules: {
      'narduk/no-secret-in-public-runtime-config': 'error',
    },
  },

  {
    name: 'narduk/core-hydration-app',
    files: APP_SCRIPT_GLOBS,
    plugins: { narduk },
    rules: {
      'narduk/no-locale-date-format-in-ssr-text': 'warn',
    },
  },

  {
    name: 'narduk/core-nuxt',
    plugins: { narduk, nuxt },
    rules: {
      'narduk/no-legacy-fetch-hook': 'error',
      'narduk/no-raw-fetch': 'error',
      'narduk/no-raw-fetch-in-stores': 'error',
      'narduk/no-map-async-in-server': 'error',
      'narduk/no-fetch-in-onmounted': 'error',
      'narduk/no-fetch-in-watch': 'error',
      'narduk/no-blocking-top-level-io-in-nuxt-plugin': 'error',
      'narduk/no-barrel-auto-imports': 'error',
      // Replaces bespoke prefer-import-meta-client / prefer-import-meta-dev.
      'nuxt/prefer-import-meta': 'warn',
    },
  },

  {
    name: 'narduk/core-vue-official',
    files: ['**/*.vue'],
    plugins: { vue },
    rules: {
      'vue/component-api-style': ['warn', ['script-setup']],
      'vue/no-async-in-computed-properties': 'error',
      'vue/define-props-declaration': ['error', 'type-based'],
      'vue/define-emits-declaration': ['error', 'type-based'],
      'vue/no-ref-object-reactivity-loss': 'error',
      'vue/no-setup-props-reactivity-loss': 'error',
      'vue/valid-v-memo': 'error',
    },
  },

  {
    name: 'narduk/core-composition',
    plugins: { narduk },
    rules: {
      'narduk/no-setup-top-level-side-effects': 'error',
      'narduk/prefer-shallow-watch': 'error',
      'narduk/no-template-complex-expressions': 'warn',
      'narduk/require-use-prefix-for-composables': 'warn',
      'narduk/no-composable-conditional-hooks': 'warn',
    },
  },

  {
    name: 'narduk/core-pinia',
    plugins: { narduk, pinia },
    rules: {
      'narduk/pinia-require-defineStore-id': 'error',
      'pinia/never-export-initialized-store': 'error',
      'pinia/no-duplicate-store-ids': 'error',
      'pinia/no-return-global-properties': 'error',
      'pinia/no-store-to-refs-in-store': 'error',
      'pinia/prefer-use-store-naming-convention': 'warn',
      'pinia/require-setup-store-properties-export': 'warn',
    },
  },

  {
    name: 'narduk/core-app-architecture',
    files: ['app/composables/**/*.ts', 'app/utils/**/*.ts', 'app/stores/**/*.ts'],
    plugins: { narduk },
    rules: {
      'narduk/no-module-scope-ref': 'warn',
      'narduk/no-non-serializable-store-state': 'warn',
    },
  },

  {
    name: 'narduk/core-client-perf',
    files: ['app/**/*.{vue,ts,tsx,js,mjs}'],
    plugins: { narduk },
    rules: {
      'narduk/no-tight-interval': 'warn',
      'narduk/no-static-mermaid-import': 'error',
    },
  },
]

export { coreConfigs }
export default coreConfigs
