// @ts-check
/**
 * `complexity` capability pack.
 *
 * A handful of high-signal `sonarjs` rules as `warn`. Deliberately not the
 * `recommended` bundle — it is too noisy for these codebases and duplicates
 * rules shipped elsewhere in this config.
 */

import sonarjs from 'eslint-plugin-sonarjs'

/** @type {import('eslint').Linter.Config[]} */
const complexityConfigs = [
  {
    name: 'narduk/complexity',
    files: ['**/*.ts', '**/*.mts', '**/*.vue'],
    plugins: { sonarjs },
    rules: {
      'sonarjs/cognitive-complexity': ['warn', 20],
      'sonarjs/no-duplicate-string': ['warn', { threshold: 5 }],
      'sonarjs/no-identical-functions': 'warn',
      'sonarjs/no-collapsible-if': 'warn',
      'sonarjs/no-redundant-boolean': 'warn',
    },
  },
]

export { complexityConfigs }
export default complexityConfigs
