// @ts-check
/**
 * `template` capability pack — starter/layer structural policy.
 *
 * Two v1 rules are replaced by core ESLint here:
 *
 * - `file-size-budget` → core `max-lines`, per surface. v1's version had a
 *   `/app/pages/`-style gate that never matched a relative filename.
 * - `no-direct-layer-source-imports` → core `no-restricted-imports` patterns,
 *   which state the same ban without v1's specifier-rewriting autofixer.
 *
 * `app-structure-consistency` and `no-reactive-in-services` took DROP verdicts.
 *
 * `template` sorts after `server` in the default preset order and its server
 * entry matches the same files. It used to restate the Cloudflare and server
 * import bans alongside its own to survive that ordering; all three packs now
 * assign one shared constant instead, so no order can drop a ban. See
 * `configs/restricted-imports.mjs`.
 */

import narduk from '../dist/index.js'

import { RESTRICTED_IMPORTS_RULE, TEST_TREE_IGNORES } from './restricted-imports.mjs'
import { SERVER_FILE_GLOBS } from './server.mjs'

export {
  LAYER_SOURCE_IMPORT_PATTERNS,
  NODE_BUILTIN_IMPORT_RESTRICTIONS,
  PORTABLE_LAYER_RESTRICTED_IMPORTS_OPTION,
  PORTABLE_LAYER_RESTRICTED_IMPORTS_RULE,
  RESTRICTED_IMPORTS_OPTION,
  RESTRICTED_IMPORTS_RULE,
  SERVER_RELATIVE_IMPORT_PATTERNS,
} from './restricted-imports.mjs'

/** @type {import('eslint').Linter.Config[]} */
const templateConfigs = [
  {
    name: 'narduk/template-project',
    plugins: { narduk },
    rules: {
      'narduk/no-fetch-create-bypass': 'error',
      'narduk/no-barrel-auto-imports': 'error',
      'narduk/component-directory-structure': 'error',
      'narduk/composable-primary-export': 'error',
    },
  },

  {
    name: 'narduk/template-vue',
    files: ['**/*.vue'],
    plugins: { narduk },
    rules: {
      'narduk/no-multi-statement-inline-handler': 'error',
    },
  },

  // Replaces narduk/file-size-budget.
  {
    name: 'narduk/template-size-budget-pages',
    files: ['app/pages/**/*.vue', 'pages/**/*.vue'],
    rules: {
      'max-lines': ['warn', { max: 300, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    name: 'narduk/template-size-budget-components',
    files: ['app/components/**/*.vue', 'components/**/*.vue'],
    rules: {
      'max-lines': ['warn', { max: 250, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    name: 'narduk/template-size-budget-scripts',
    files: [
      'app/composables/**/*.{ts,mts}',
      'app/stores/**/*.{ts,mts}',
      'composables/**/*.{ts,mts}',
      'stores/**/*.{ts,mts}',
    ],
    rules: {
      'max-lines': ['warn', { max: 200, skipBlankLines: true, skipComments: true }],
    },
  },

  {
    name: 'narduk/template-server',
    files: [...SERVER_FILE_GLOBS],
    ignores: [...TEST_TREE_IGNORES],
    rules: {
      'no-restricted-imports': RESTRICTED_IMPORTS_RULE,
    },
  },
]

export { templateConfigs }
export default templateConfigs
