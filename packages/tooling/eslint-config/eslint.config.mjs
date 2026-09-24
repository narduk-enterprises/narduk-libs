// @ts-check
/**
 * This package needs its own flat config for the same reason
 * `create-narduk-app` does: a flat config's relative `files` globs resolve
 * against the directory of the config file that declares them. Linted from the
 * workspace root, the baseline tail's `narduk/rule-authoring` entry
 * (`src/rules/**`, where rule implementations legitimately traffic in
 * parser-specific `any` nodes) can never match `packages/eslint-config/src/…`,
 * so its documented exemption was inert and the package reported ~420 warnings
 * it is explicitly exempt from. Basing the config here restores the intended
 * scope without changing what any consumer receives.
 *
 * The relaxations below are copied verbatim from the workspace root's
 * `packages/**` override so the effective ruleset for this package's sources is
 * unchanged by the move.
 */
import { composeSharedConfigs } from './eslint-app-config.mjs'

export default [
  ...composeSharedConfigs('core', 'correctness', 'complexity', 'formatting'),
  {
    files: ['**/*.{ts,mts,mjs}'],
    rules: {
      'import-x/extensions': 'off',
      'import-x/named': 'off',
      'no-console': 'off',
      '@typescript-eslint/consistent-type-definitions': 'off',
      'sonarjs/cognitive-complexity': 'off',
      'sonarjs/no-duplicate-string': 'off',
      'perfectionist/sort-imports': 'off',
      'perfectionist/sort-interfaces': 'off',
      'perfectionist/sort-named-imports': 'off',
      'perfectionist/sort-object-types': 'off',
      'unicorn/prefer-at': 'off',
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
]
