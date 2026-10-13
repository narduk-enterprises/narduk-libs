// @ts-check
/**
 * `e2e` capability pack.
 *
 * `eslint-plugin-playwright`'s `flat/recommended` config, scoped to Playwright
 * test files and downgraded to `warn`, plus `narduk/e2e-timeout-ceiling`
 * (spec and helper files only; `playwright.config.*` legitimately carries
 * `webServer.timeout` and `globalTimeout` above the ceilings).
 *
 * An app with a spec that really waits out a server window turns the ceiling
 * off for that file in its own flat config, and keeps that list shrink-only:
 *
 *     { files: ['tests/e2e/board-write-windows.spec.ts'],
 *       rules: { 'narduk/e2e-timeout-ceiling': 'off' } }
 *
 * Other ceilings: `['warn', { testTimeoutMs: 90_000, waitTimeoutMs: 45_000 }]`.
 */

import playwright from 'eslint-plugin-playwright'

import narduk from '../dist/index.js'

const E2E_FILES = [
  'tests/e2e/**/*.{ts,mts,js,mjs}',
  '**/playwright.config.{ts,mts,js,mjs}',
  'e2e/**/*.{ts,mts,js,mjs}',
]

/** Specs and their helpers; the time-budget rule never reads the config file. */
export const E2E_SPEC_FILES = ['tests/e2e/**/*.{ts,mts,js,mjs}', 'e2e/**/*.{ts,mts,js,mjs}']

const flatRecommended = playwright.configs?.['flat/recommended'] ?? {}

/**
 * Force every enabled severity in a rules map down to `warn`, preserving options.
 *
 * @param {Record<string, unknown> | undefined} rulesMap
 */
function warnify(rulesMap) {
  if (!rulesMap) return {}

  /** @type {Record<string, unknown>} */
  const result = {}

  for (const [ruleName, setting] of Object.entries(rulesMap)) {
    if (setting === 'off' || setting === 0) {
      result[ruleName] = setting
      continue
    }

    result[ruleName] = Array.isArray(setting) ? ['warn', ...setting.slice(1)] : 'warn'
  }

  return result
}

/** @type {import('eslint').Linter.Config[]} */
const e2eConfigs = [
  {
    name: 'narduk/e2e',
    files: E2E_FILES,
    plugins: flatRecommended.plugins ?? { playwright },
    languageOptions: flatRecommended.languageOptions,
    rules: warnify(flatRecommended.rules),
  },
  {
    name: 'narduk/e2e-budget',
    files: E2E_SPEC_FILES,
    plugins: { narduk },
    rules: { 'narduk/e2e-timeout-ceiling': 'warn' },
  },
]

export { e2eConfigs }
export default e2eConfigs
