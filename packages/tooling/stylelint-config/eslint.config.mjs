import { composeSharedConfigs } from '@narduk-enterprises/eslint-config/eslint-app-config'

export default [
  ...composeSharedConfigs('core', 'correctness', 'complexity', 'formatting'),
  {
    files: ['**/*.{ts,mts,mjs}'],
    rules: {
      'import-x/extensions': 'off',
      'no-console': 'off',
    },
  },
  {
    ignores: ['tests/fixtures/**', 'node_modules/**'],
  },
]
