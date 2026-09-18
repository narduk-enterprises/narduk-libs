// @ts-check
/**
 * `correctness` capability pack — TypeScript hygiene, warn-only.
 *
 * Two slices:
 *
 * - `narduk/correctness-hygiene` — non-typed rules, always on for TS/Vue.
 * - `narduk/correctness-type-aware-rules` / `-promises` — the type-aware rules
 *   (warn; see below).
 * - `narduk/correctness-type-aware` — parser wiring only. It exists so an app
 *   can switch type-aware rules on locally without re-deriving the project
 *   service setup, and so `createAppLintConfig()` can point `projectService` at
 *   the app's generated `.nuxt/tsconfig.json`. The name is load-bearing: the app
 *   config finds this entry by `name`.
 */

import tseslint from 'typescript-eslint'

const correctnessHygiene = {
  name: 'narduk/correctness-hygiene',
  files: ['**/*.ts', '**/*.mts', '**/*.vue'],
  plugins: {
    '@typescript-eslint': tseslint.plugin,
  },
  rules: {
    '@typescript-eslint/consistent-type-imports': [
      'warn',
      {
        prefer: 'type-imports',
        fixStyle: 'separate-type-imports',
      },
    ],
    '@typescript-eslint/no-import-type-side-effects': 'warn',
    '@typescript-eslint/array-type': ['warn', { default: 'array-simple' }],
    '@typescript-eslint/consistent-type-definitions': ['warn', 'interface'],
    '@typescript-eslint/ban-ts-comment': [
      'warn',
      {
        'ts-expect-error': 'allow-with-description',
        'ts-ignore': 'allow-with-description',
        'ts-nocheck': 'allow-with-description',
        'ts-check': false,
        minimumDescriptionLength: 10,
      },
    ],
  },
}

const correctnessTypeAware = {
  name: 'narduk/correctness-type-aware',
  files: ['**/*.ts', '**/*.mts', '**/*.vue'],
  // Type-aware rules require every matched file to belong to a TypeScript
  // project. Paths Nuxt's prepare step does not wire into a generated tsconfig
  // must be ignored here or ESLint reports "was not found by the project
  // service" parse errors. Apps extend this list in their own overrides.
  ignores: [
    '**/*.d.ts',
    '**/*.config.js',
    '**/*.config.ts',
    '**/*.config.mjs',
    '**/*.config.cjs',
    '**/*.config.mts',
    '**/*.config.cts',
    'scripts/**',
    'tools/**',
    'tests/**/*.ts',
    'types/**/*.ts',
    'dev/**/*.ts',
    'auth-environment.ts',
  ],
  plugins: {
    '@typescript-eslint': tseslint.plugin,
  },
  languageOptions: {
    parserOptions: {
      projectService: true,
    },
  },
  rules: {},
}

/**
 * Type-aware checks, warn-only, budgeted by `narduk-lint` (2026-09-18).
 *
 * The two promise rules skip `server/**`: the `server` pack enforces them there
 * at `error`, and excluding them here keeps that true whatever order the app
 * lists its packs in. The files and ignores match `narduk/correctness-type-aware`
 * exactly, so every file these rules see has a project service.
 */
const correctnessTypeAwareRules = {
  name: 'narduk/correctness-type-aware-rules',
  files: correctnessTypeAware.files,
  ignores: correctnessTypeAware.ignores,
  plugins: {
    '@typescript-eslint': tseslint.plugin,
  },
  rules: {
    '@typescript-eslint/await-thenable': 'warn',
    '@typescript-eslint/switch-exhaustiveness-check': 'warn',
  },
}

const correctnessTypeAwareClientPromises = {
  name: 'narduk/correctness-type-aware-promises',
  files: correctnessTypeAware.files,
  ignores: [...correctnessTypeAware.ignores, '**/server/**'],
  plugins: {
    '@typescript-eslint': tseslint.plugin,
  },
  rules: {
    '@typescript-eslint/no-floating-promises': 'warn',
    '@typescript-eslint/no-misused-promises': 'warn',
  },
}

/** Files the type-aware entries skip; reused by the `server` pack. */
export const TYPE_AWARE_IGNORES = correctnessTypeAware.ignores

/** @type {import('eslint').Linter.Config[]} */
const correctnessConfigs = [
  correctnessHygiene,
  correctnessTypeAware,
  correctnessTypeAwareRules,
  correctnessTypeAwareClientPromises,
]

export { correctnessConfigs }
export default correctnessConfigs
