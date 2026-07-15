import { composeSharedConfigs } from '@narduk-enterprises/eslint-config/config'

export default [
  ...composeSharedConfigs('core', 'correctness', 'complexity', 'formatting'),
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
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
