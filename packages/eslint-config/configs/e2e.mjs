// @ts-check
/**
 * `e2e` capability pack.
 *
 * `eslint-plugin-playwright`'s `flat/recommended` config, scoped to Playwright
 * test files and downgraded to `warn`.
 */

import playwright from 'eslint-plugin-playwright'

const E2E_FILES = [
  'tests/e2e/**/*.{ts,mts,js,mjs}',
  '**/playwright.config.{ts,mts,js,mjs}',
  'e2e/**/*.{ts,mts,js,mjs}',
]

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
]

export { e2eConfigs }
export default e2eConfigs
