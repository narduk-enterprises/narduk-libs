// @ts-check
/**
 * `formatting` capability pack — import/type *ordering* only.
 *
 * Prettier owns whitespace; this pack owns ordering. `eslint-config-prettier`
 * (applied last by `composeSharedConfigs()`) deliberately does not disable
 * perfectionist, because ordering is not formatting. See the README's
 * "Prettier vs Perfectionist" note for the fix order.
 */

import perfectionist from 'eslint-plugin-perfectionist'

/** @type {import('eslint').Linter.Config[]} */
const formattingConfigs = [
  {
    name: 'narduk/formatting',
    files: ['**/*.ts', '**/*.mts', '**/*.vue'],
    plugins: { perfectionist },
    rules: {
      'perfectionist/sort-imports': [
        'warn',
        {
          type: 'natural',
          order: 'asc',
          groups: [
            'builtin',
            'external',
            'internal-nuxt',
            'internal',
            'parent',
            'sibling',
            'index',
            'type',
            'style',
          ],
          customGroups: [
            {
              groupName: 'internal-nuxt',
              anyOf: [
                { elementNamePattern: '^#imports$' },
                { elementNamePattern: '^#app' },
                { elementNamePattern: '^#nuxt-ui' },
                { elementNamePattern: '^~/' },
                { elementNamePattern: '^@/' },
              ],
            },
          ],
        },
      ],
      'perfectionist/sort-named-imports': 'warn',
      'perfectionist/sort-object-types': 'warn',
      'perfectionist/sort-interfaces': 'warn',
    },
  },
]

export { formattingConfigs }
export default formattingConfigs
