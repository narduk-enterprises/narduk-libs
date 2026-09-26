// @ts-check
/**
 * `@narduk-enterprises/eslint-config` — shared composition and the Nuxt app
 * config factory.
 *
 * ```js
 * // app/eslint.config.mjs
 * import withNuxt from './.nuxt/eslint.config.mjs'
 * import { createAppLintConfig } from '@narduk-enterprises/eslint-config/eslint-app-config'
 *
 * export default createAppLintConfig({
 *   withNuxt,
 *   capabilityPacks: ['core', 'design-system', 'nuxt-ui', 'server', 'auth'],
 * })
 * ```
 *
 * v2 drops v1's legacy presets (`recommended`, `nuxt`, `vue`, `vue-strict`,
 * `app`, `all`, …). Capability packs are the only supported composition unit.
 */

import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, join, resolve, win32 } from 'node:path'
import { fileURLToPath } from 'node:url'

import eslintComments from '@eslint-community/eslint-plugin-eslint-comments'
import vitest from '@vitest/eslint-plugin'
import eslintConfigPrettier from 'eslint-config-prettier'
import importX, { createNodeResolver } from 'eslint-plugin-import-x'
import noOnlyTests from 'eslint-plugin-no-only-tests'
import promise from 'eslint-plugin-promise'
import regexp from 'eslint-plugin-regexp'
import security from 'eslint-plugin-security'
import unicorn from 'eslint-plugin-unicorn'
import vuePlugin from 'eslint-plugin-vue'
import tseslint from 'typescript-eslint'
import vueParser from 'vue-eslint-parser'

import a11yConfigs from './configs/a11y.mjs'
import { appDefinedClassesPattern } from './configs/app-defined-classes.mjs'
import authConfigs from './configs/auth.mjs'
import cloudflareConfigs from './configs/cloudflare.mjs'
import complexityConfigs from './configs/complexity.mjs'
import coreConfigs from './configs/core.mjs'
import correctnessConfigs from './configs/correctness.mjs'
import designSystemConfigs from './configs/design-system.mjs'
import e2eConfigs from './configs/e2e.mjs'
import formattingConfigs from './configs/formatting.mjs'
import monorepoConfigs from './configs/monorepo.mjs'
import nuxtUiConfigs from './configs/nuxt-ui.mjs'
import seoConfigs from './configs/seo.mjs'
import serverConfigs from './configs/server.mjs'
import templateConfigs from './configs/template.mjs'

export { default as nardukPlugin } from './dist/index.js'

// ─── Shared constants ───────────────────────────────────────────────────────

/**
 * Components Nuxt registers itself. `vue/no-undef-components` is fail-closed by
 * default: only these are allowed, because broad prefix patterns hide typos
 * like `UButon` or `AuthLognCard`. `createAppLintConfig()` widens the allowlist
 * from the app's generated `.nuxt/components.d.ts`.
 */
export const NUXT_BUILT_IN_COMPONENTS = [
  'ClientOnly',
  'DevOnly',
  'NuxtClientFallback',
  'Teleport',
  'NuxtRouteAnnouncer',
  'NuxtTime',
  'NuxtAnnouncer',
  'NuxtPage',
  'NuxtLayout',
  'NuxtLink',
  'NuxtLoadingIndicator',
  'NuxtErrorBoundary',
  'NuxtWelcome',
  'NuxtIsland',
  'NuxtImg',
  'NuxtPicture',
]

const NUXT_BUILT_IN_COMPONENT_IGNORE_PATTERNS = NUXT_BUILT_IN_COMPONENTS.map((name) => `^${name}$`)

/** Plugins `withNuxt()` already registers; re-registering them is a hard error. */
const NUXT_MANAGED_PLUGIN_KEYS = new Set(['@typescript-eslint', 'vue', 'nuxt'])

const THIS_DIR = dirname(fileURLToPath(import.meta.url))

const ESLINT_CONFIG_FILENAMES = new Set([
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.cjs',
  'eslint.config.ts',
  'eslint.config.mts',
  'eslint.config.cts',
])

const NODE_ONLY_FILE_GLOBS = [
  'scripts/**/*.{js,mjs,cjs,ts,mts,cts}',
  '*.config.{js,ts,mjs,cjs,mts,cts}',
  'server/**/*.{js,mjs,cjs,ts,mts,cts}',
]

const EDGE_RUNTIME_FILE_GLOBS = [
  'server/api/**/*.{js,mjs,cjs,ts,mts,cts}',
  'server/routes/**/*.{js,mjs,cjs,ts,mts,cts}',
  'server/functions/**/*.{js,mjs,cjs,ts,mts,cts}',
]

// ─── Parser layer ───────────────────────────────────────────────────────────

const parserConfigs = [
  {
    name: 'narduk/parser-vue',
    files: ['**/*.vue'],
    plugins: { vue: vuePlugin },
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tseslint.parser,
        sourceType: 'module',
        extraFileExtensions: ['.vue'],
      },
    },
    rules: {
      'vue/multi-word-component-names': 'off',
    },
  },

  {
    name: 'narduk/parser-typescript',
    files: ['**/*.ts', '**/*.mts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        sourceType: 'module',
      },
    },
  },
]

// ─── Shared tail ────────────────────────────────────────────────────────────
//
// Two arrays so `communityLayer: false` can skip the plugin finding wave
// without dropping Nuxt ignores or the typescript/console housekeeping
// (narduk-libs#167, review on #813).

const sharedBaselineTailConfigs = [
  {
    name: 'narduk/ignores',
    ignores: [
      '.agents/**',
      '.nuxt/**',
      '.output/**',
      'dist/**',
      'node_modules/**',
      '**/*.d.ts',
      // Generated test output (vitest --coverage, Playwright). Linting it made
      // a second `quality` run fail on unbudgeted warnings (narduk-libs#902).
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },

  {
    name: 'narduk/typescript-base-off',
    files: ['**/*.ts', '**/*.vue'],
    rules: {
      'no-unused-vars': 'off',
      'no-undef': 'off',
    },
  },

  {
    name: 'narduk/console-hygiene',
    files: ['**/*.ts', '**/*.mts', '**/*.vue'],
    ignores: ['**/server/**'],
    rules: {
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    // Server code logs through the structured logger (`useLogger(event)`), so
    // every console method warns there, `warn`/`error` included (2026-09-18).
    // It lives in this tail rather than the `server` pack because this tail is
    // composed after every pack: a pack-level entry would be overridden by
    // `narduk/console-hygiene` above for the same files.
    name: 'narduk/console-hygiene-server',
    files: ['**/server/**/*.{ts,mts,js,mjs}'],
    rules: {
      'no-console': 'warn',
    },
  },
  {
    name: 'narduk/console-hygiene-exempt',
    files: [
      'scripts/**',
      'tools/**',
      'server/utils/logger*',
      '**/*.test.ts',
      '**/*.spec.ts',
      '**/*.config.{ts,mts,js,mjs,cjs}',
    ],
    rules: {
      'no-console': 'off',
    },
  },

  {
    name: 'narduk/typescript-project-rules',
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      'no-unused-vars': 'off',
      'no-debugger': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/explicit-function-return-type': 'off',
    },
  },

  {
    // Rule implementations work against parser-specific AST nodes; eliminating
    // every `any` there is noisy casting without added correctness.
    name: 'narduk/rule-authoring',
    files: ['src/rules/**/*.{ts,mts}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  {
    name: 'narduk/composable-helpers-bypass',
    files: ['app/composables/helpers/**/*.ts'],
    rules: {
      'narduk/require-use-prefix-for-composables': 'off',
    },
  },
]

const sharedCommunityPluginTailConfigs = [
  {
    name: 'narduk/vue-house-style',
    files: ['**/*.vue'],
    plugins: { vue: vuePlugin },
    rules: {
      'vue/component-name-in-template-casing': [
        'warn',
        'PascalCase',
        { registeredComponentsOnly: false },
      ],
      'vue/prefer-define-options': 'warn',
      'vue/prefer-import-from-vue': 'warn',
      'vue/block-order': ['warn', { order: ['script', 'template', 'style'] }],
      'vue/attributes-order': 'off',
      'vue/no-multiple-template-root': 'off',
      'vue/no-v-for-template-key': 'off',
      'vue/no-v-html': 'warn',
      'vue/define-macros-order': 'warn',
      'vue/define-props-declaration': ['warn', 'type-based'],
      'vue/define-emits-declaration': ['warn', 'type-based'],
      'vue/no-ref-as-operand': 'warn',
      'vue/no-watch-after-await': 'warn',
      // Replaces v1's narduk/no-unknown-nuxt-ui-component. Fail-closed here;
      // createAppLintConfig() replaces it with the app's real component graph.
      'vue/no-undef-components': [
        'warn',
        { ignorePatterns: NUXT_BUILT_IN_COMPONENT_IGNORE_PATTERNS },
      ],
      'vue/no-undef-properties': 'warn',
    },
  },

  {
    // import-x/no-unresolved stays off on purpose: Nuxt auto-imports and its
    // aliases (#imports, ~, @) produce false positives, and Nuxt's own
    // TypeScript integration already resolves them.
    //
    // `import-x/core-modules: ['vue']` was v1's separate
    // `eslint-nuxt-flat-fragments` export; it is inlined here in v2.
    //
    // `import-x/resolver-next` pins the plugin's own Node resolver. With no
    // resolver set, import-x falls back to its legacy `node` probe, which
    // crashes `import-x/no-cycle` on a `vitest.config.ts` ("node with invalid
    // interface loaded as resolver", narduk-libs#562).
    //
    // `import-x/ignore: ['node_modules']` stops `no-cycle`, `named`,
    // `default` and `export` from parsing dependencies' sources and type
    // trees. Walking them held about 3.4 GB of heap in narduk-core (5.2 GB
    // peak RSS against 1.8 GB with it, the same messages either way), which
    // is what pushed its lint past the 3072 MB lifecycle cap (narduk-libs#789).
    // A cycle cannot run through an installed package, and TypeScript already
    // checks named and default imports from one.
    name: 'narduk/imports',
    files: ['**/*.ts', '**/*.mts', '**/*.vue'],
    plugins: { 'import-x': importX },
    settings: {
      'import-x/core-modules': ['vue'],
      'import-x/ignore': ['node_modules'],
      'import-x/resolver-next': [createNodeResolver()],
    },
    rules: {
      'import-x/no-duplicates': 'error',
      'import-x/no-self-import': 'error',
      'import-x/no-useless-path-segments': 'error',
      'import-x/first': 'warn',
      'import-x/newline-after-import': 'warn',
      'import-x/no-mutable-exports': 'error',
      'import-x/named': 'error',
      'import-x/default': 'error',
      'import-x/export': 'error',
      'import-x/no-cycle': 'error',
    },
  },

  {
    // unicorn/prefer-node-protocol is deliberately absent here — it is scoped to
    // Node-only files below, to stay quiet in edge environments.
    name: 'narduk/modern-js',
    files: ['**/*.ts', '**/*.mts', '**/*.vue'],
    plugins: { unicorn },
    rules: {
      // v1's unicorn/no-array-for-each; renamed upstream in unicorn 72.
      'unicorn/no-for-each': 'warn',
      'unicorn/prefer-at': 'warn',
      'unicorn/no-useless-undefined': 'warn',
      'unicorn/prefer-string-replace-all': 'warn',
      'unicorn/prefer-number-properties': 'warn',
      'unicorn/no-lonely-if': 'warn',
      'unicorn/prefer-array-find': 'warn',
      'unicorn/prefer-includes': 'warn',
      // v1's unicorn/no-instanceof-array, which unicorn 72 deprecates.
      'unicorn/no-instanceof-builtins': 'error',
      'unicorn/throw-new-error': 'error',
    },
  },

  {
    name: 'narduk/node-only-files',
    files: NODE_ONLY_FILE_GLOBS,
    ignores: EDGE_RUNTIME_FILE_GLOBS,
    plugins: { unicorn },
    rules: {
      'unicorn/prefer-node-protocol': 'error',
    },
  },

  {
    name: 'narduk/promise-safety',
    files: ['**/*.ts', '**/*.mts', '**/*.vue'],
    plugins: { promise },
    rules: {
      'promise/always-return': 'warn',
      'promise/no-return-wrap': 'error',
      'promise/catch-or-return': 'warn',
    },
  },

  {
    // Unused disable directives are reported (warn, budgeted by narduk-lint)
    // and every disable must say why (`-- reason`).
    name: 'narduk/eslint-directive-hygiene',
    linterOptions: { reportUnusedDisableDirectives: 'warn' },
    plugins: { '@eslint-community/eslint-comments': eslintComments },
    rules: {
      '@eslint-community/eslint-comments/no-unused-disable': 'error',
      '@eslint-community/eslint-comments/require-description': 'warn',
    },
  },

  {
    // v1 used the abandoned eslint-plugin-vitest; v2 uses the Vitest team's
    // @vitest/eslint-plugin under the same `vitest/` rule prefix.
    name: 'narduk/vitest',
    files: ['**/*.test.ts', '**/*.spec.ts', 'tests/**/*.ts'],
    plugins: { vitest, 'no-only-tests': noOnlyTests },
    languageOptions: {
      globals: {
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
      },
    },
    rules: {
      'vitest/no-disabled-tests': 'warn',
      'vitest/no-focused-tests': 'error',
      'vitest/expect-expect': 'warn',
      'no-only-tests/no-only-tests': 'error',
    },
  },

  {
    // Server code only, kept minimal. detect-object-injection stays off: it
    // flags nearly all bracket notation.
    name: 'narduk/security',
    files: ['server/**/*.ts'],
    plugins: { security },
    rules: {
      'security/detect-non-literal-fs-filename': 'warn',
      'security/detect-non-literal-regexp': 'warn',
      'security/detect-object-injection': 'off',
    },
  },

  regexp.configs['flat/recommended'],
]

/**
 * `eslint-config-prettier` turns off only the ESLint rules that fight Prettier's
 * formatting, so it must come AFTER every capability pack and tail config that
 * could re-enable a stylistic rule — otherwise the later config wins and ESLint
 * and Prettier disagree. Do not move this earlier in the composition; the
 * invariant is asserted by `tests/composition/prettier-last.test.ts`.
 *
 * This does NOT disable the `formatting` pack's perfectionist ordering.
 * Perfectionist is ordering, not formatting — see the README.
 */
const prettierDisableConfig = {
  ...eslintConfigPrettier,
  name: 'narduk/prettier-disable',
}

// ─── Capability packs ───────────────────────────────────────────────────────

/** The fourteen capability packs, by their canonical names. */
export const capabilityConfigs = {
  core: [...coreConfigs],
  'design-system': [...designSystemConfigs],
  'nuxt-ui': [...nuxtUiConfigs],
  seo: [...seoConfigs],
  cloudflare: [...cloudflareConfigs],
  server: [...serverConfigs],
  auth: [...authConfigs],
  template: [...templateConfigs],
  correctness: [...correctnessConfigs],
  a11y: [...a11yConfigs],
  complexity: [...complexityConfigs],
  formatting: [...formattingConfigs],
  e2e: [...e2eConfigs],
  monorepo: [...monorepoConfigs],
}

/**
 * v1 spelled two pack names in camelCase. Both spellings resolve so a consumer
 * `eslint.config.mjs` needs only a version bump.
 */
export const capabilityPackAliases = {
  designSystem: 'design-system',
  nuxtUi: 'nuxt-ui',
}

export const defaultCapabilityPresetOrder = [
  'core',
  'design-system',
  'nuxt-ui',
  'seo',
  'server',
  'auth',
  'template',
]

/**
 * Resolve a requested pack name to its canonical name.
 *
 * @param {string} presetName
 */
export function resolveCapabilityPackName(presetName) {
  const key = String(presetName)
  return Object.hasOwn(capabilityPackAliases, key) ? capabilityPackAliases[key] : key
}

/**
 * The pack names a `capabilityPacks` argument actually selects: an empty or
 * omitted list falls through to `defaultCapabilityPresetOrder`, and a nested
 * array flattens. `composeSharedConfigs` and the Tailwind theme guard below both
 * read this, so "which packs did the app select?" cannot answer differently in
 * the two places — a config entry attached for a pack that was never composed is
 * how the `better-tailwindcss` plugin-resolution crash happened.
 *
 * Names are returned as requested, not canonicalised, because
 * `composeSharedConfigs` reports an unknown pack using the caller's spelling.
 *
 * @param {Array<string | string[]>} presetNames
 * @returns {string[]}
 */
function requestedCapabilityPackNames(presetNames) {
  return presetNames.length === 0 ? defaultCapabilityPresetOrder : presetNames.flat()
}

/**
 * @typedef {object} ComposeSharedConfigsOptions
 * @property {string | Array<string | string[]>} [packs]
 * @property {boolean} [communityLayer]
 */

/**
 * True for the single-options-object form of `composeSharedConfigs`. A pack-name
 * string or a pack-name array stays on the existing varargs path, so today's
 * callers do not change meaning (narduk-libs#167).
 *
 * @param {unknown} value
 * @returns {value is ComposeSharedConfigsOptions}
 */
function isComposeSharedConfigsOptions(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    ('packs' in value || 'communityLayer' in value)
  )
}

/**
 * @param {unknown} packs
 * @returns {Array<string | string[]>}
 */
function normalizeComposePacks(packs) {
  if (packs === undefined || packs === null) {
    return []
  }

  if (typeof packs === 'string') {
    return [packs]
  }

  if (Array.isArray(packs)) {
    return packs
  }

  throw new TypeError(
    `composeSharedConfigs packs must be a string or an array of pack names, got ${typeof packs}`,
  )
}

/**
 * @param {unknown[]} args
 * @returns {{ presetNames: Array<string | string[]>, communityLayer: boolean }}
 */
function parseComposeSharedConfigsArgs(args) {
  if (args.length === 1 && isComposeSharedConfigsOptions(args[0])) {
    const options = args[0]

    if (options.communityLayer !== undefined && typeof options.communityLayer !== 'boolean') {
      throw new TypeError('composeSharedConfigs communityLayer must be a boolean')
    }

    return {
      presetNames: normalizeComposePacks(options.packs),
      communityLayer: options.communityLayer !== false,
    }
  }

  if (args.some((arg) => isComposeSharedConfigsOptions(arg))) {
    throw new TypeError(
      'composeSharedConfigs accepts pack names, or a single { packs, communityLayer } object, not both',
    )
  }

  return {
    presetNames: /** @type {Array<string | string[]>} */ (args),
    communityLayer: true,
  }
}

/**
 * Compose the shared parser and community layers with one or more capability
 * packs. Prettier's disable config is always last.
 *
 * Pack-name arguments keep today's composition, including the community plugin
 * tail (`import-x`, `unicorn`, `promise`, `security`, `regexp`,
 * `eslint-comments`, `vitest`, Vue house style). Pass
 * `{ packs, communityLayer: false }` to take those packs without that wave.
 * Parser layer, Prettier, and the baseline tail (`narduk/ignores`,
 * typescript-eslint project rules, console hygiene) stay (narduk-libs#167).
 *
 * @param {...(string | string[] | ComposeSharedConfigsOptions)} args
 * @returns {import('eslint').Linter.Config[]}
 */
export function composeSharedConfigs(...args) {
  const { presetNames, communityLayer } = parseComposeSharedConfigsArgs(args)
  const requestedPresetNames = requestedCapabilityPackNames(presetNames)

  const selectedCapabilityConfigs = requestedPresetNames.flatMap((presetName) => {
    const canonicalName = resolveCapabilityPackName(presetName)
    const presetConfigs = capabilityConfigs[canonicalName]

    if (!presetConfigs) {
      throw new Error(
        `Unknown eslint config preset "${String(presetName)}". Expected one of: ${Object.keys(
          capabilityConfigs,
        ).join(', ')}`,
      )
    }

    return presetConfigs
  })

  return [
    ...parserConfigs,
    ...selectedCapabilityConfigs,
    ...sharedBaselineTailConfigs,
    ...(communityLayer ? sharedCommunityPluginTailConfigs : []),
    prettierDisableConfig,
  ]
}

export const sharedConfigs = composeSharedConfigs()

// ─── App config factory ─────────────────────────────────────────────────────

/**
 * Files whose relaxations the `content` app preset applies.
 *
 * v1 switched off six bespoke rules here. Five of them no longer exist, so the
 * content preset now relaxes their maintained replacements instead.
 */
const CONTENT_RELAXED_RULES_OFF = {
  'vue/no-restricted-html-elements': 'off',
  'better-tailwindcss/no-restricted-classes': 'off',
}

const ADMIN_PRESET_OVERRIDES = [
  {
    name: 'narduk/app-type-admin-dashboard',
    files: ['app/pages/dashboard/**/*.vue'],
    rules: {
      'vue/no-restricted-html-elements': 'off',
    },
  },
  {
    name: 'narduk/app-type-admin-composables',
    files: ['app/composables/**/*.ts'],
    rules: {
      'narduk/no-composable-conditional-hooks': 'off',
    },
  },
]

/** Canonical name of the only pack that registers `better-tailwindcss`. */
const DESIGN_SYSTEM_PACK = 'design-system'

/**
 * Nuxt UI 4 / narduk-template convention, and the entry point
 * `createAppLintConfig` falls back to when the app names none. Mirrors the
 * pack's own placeholder in configs/design-system.mjs.
 */
/** Conventional Nuxt UI 4 / narduk-template Tailwind entry stylesheet. */
export const DEFAULT_TAILWIND_ENTRY_POINT = 'app/assets/css/main.css'

/**
 * Did the app select the pack that registers `better-tailwindcss`?
 *
 * @param {Array<string | string[]>} capabilityPacks
 */
function selectsDesignSystemPack(capabilityPacks) {
  return requestedCapabilityPackNames(capabilityPacks).some(
    (presetName) => resolveCapabilityPackName(presetName) === DESIGN_SYSTEM_PACK,
  )
}

/**
 * Enable the three theme-resolving better-tailwindcss rules only when ALL of
 * these are actually present:
 *
 * 1. **The app selected `design-system`.** It is the only pack that registers
 *    the `better-tailwindcss` plugin (configs/design-system.mjs), and enabling a
 *    plugin's rules without its plugin is not a soft failure: ESLint throws
 *    `Key "rules": Key "better-tailwindcss/no-unknown-classes": Could not find
 *    plugin "better-tailwindcss" in configuration.` while normalising the config,
 *    before it lints a single file. v2 gated on file existence alone, so any app
 *    that skipped the pack while keeping its stylesheet at the conventional
 *    default path crashed out of the box — found by the first consumer
 *    migration. (Only an *enabled* rule resolves its plugin; ESLint skips
 *    validation at severity 0, which is why the content preset's
 *    `better-tailwindcss/no-restricted-classes: 'off'` needs no such gate.)
 * 2. **The app declared Tailwind** by passing `tailwindEntryPoint` (narduk-libs#665).
 *    Inferring from a conventional `app/assets/css/main.css` — or from whether
 *    `tailwindcss` happens to resolve — is how a stale or transitive install
 *    switched the rules on in a non-Tailwind app (operator-portal#431). An
 *    omitted value means the app did not ask for Tailwind linting.
 * 3. **That entry point exists on disk.** Without it the rules do not degrade
 *    quietly; the plugin's shared context reports a misconfiguration banner per
 *    class (see configs/design-system.mjs).
 *
 * No pack means no override, whatever is on disk — an app that never mentioned
 * Tailwind is silently correct. But no pack plus an *explicitly configured*
 * entry point is a contradiction only the app can resolve, so it throws a named
 * configuration error here at compose time rather than letting ESLint die inside
 * plugin resolution with no mention of `capabilityPacks`.
 *
 * Severities match what the pack would have used: the two token gates that
 * replace bespoke v1 rules are errors; `enforce-canonical-classes` (the
 * `prefer-tailwind-var-shorthand` replacement) stays a warning.
 *
 * @param {object}                   options
 * @param {string}                   [options.appRootDir]
 * @param {Array<string | string[]>} options.capabilityPacks    as passed to `createAppLintConfig`
 * @param {unknown}                  options.tailwindEntryPoint `undefined` when the app named none
 */
function buildTailwindThemeOverride({ appRootDir, capabilityPacks, tailwindEntryPoint }) {
  const entryPointWasProvided = tailwindEntryPoint !== undefined
  // A usable entry point is a non-empty string the app named. An omitted value
  // is "Tailwind was not declared" (narduk-libs#665); null, '' and non-strings
  // have always meant "no theme override" and still do. Do not fall back to
  // DEFAULT_TAILWIND_ENTRY_POINT — that inferred Tailwind from a conventional
  // path and from whatever `tailwindcss` the module graph happened to contain.
  const hasUsableEntryPoint =
    typeof tailwindEntryPoint === 'string' && tailwindEntryPoint.length > 0

  if (!selectsDesignSystemPack(capabilityPacks)) {
    // Only a value that asked for theme linting is a contradiction. An explicit
    // null/''/non-string asked for the opposite, and stays silent.
    if (entryPointWasProvided && hasUsableEntryPoint) {
      throw new Error(
        'tailwindEntryPoint requires the design-system capability pack, which registers ' +
          'better-tailwindcss; without it ESLint aborts every run with ' +
          '\'Could not find plugin "better-tailwindcss" in configuration\'. Received ' +
          JSON.stringify(tailwindEntryPoint) +
          ". Add 'design-system' to capabilityPacks, or drop tailwindEntryPoint.",
      )
    }
    return []
  }

  if (!hasUsableEntryPoint) {
    return []
  }
  const resolved = join(appRootDir ?? '.', tailwindEntryPoint)
  if (!existsSync(resolved)) {
    return []
  }
  // Classes the app defines as bare selectors or in SFC <style> blocks are
  // invisible to the plugin's theme lookup (narduk-libs#55).
  const appDefinedClasses = appDefinedClassesPattern({
    appRootDir: resolve(appRootDir ?? '.'),
    entryPoint: resolve(resolved),
  })
  return [
    {
      name: 'narduk/design-system-tailwind-theme',
      files: ['**/*.vue'],
      settings: {
        'better-tailwindcss': { entryPoint: resolved },
      },
      rules: {
        'better-tailwindcss/no-unknown-classes': appDefinedClasses
          ? ['error', { ignore: [appDefinedClasses] }]
          : 'error',
        'better-tailwindcss/no-deprecated-classes': 'error',
        'better-tailwindcss/enforce-canonical-classes': 'warn',
      },
    },
  ]
}

function stripNuxtManagedPlugins(config) {
  if (!config?.plugins) {
    return config
  }

  const filteredPlugins = Object.fromEntries(
    Object.entries(config.plugins).filter(([name]) => !NUXT_MANAGED_PLUGIN_KEYS.has(name)),
  )

  if (Object.keys(filteredPlugins).length === Object.keys(config.plugins).length) {
    return config
  }

  if (Object.keys(filteredPlugins).length === 0) {
    const { plugins: _plugins, ...rest } = config
    return rest
  }

  return { ...config, plugins: filteredPlugins }
}

function normalizeStackPath(maybePath) {
  if (typeof maybePath !== 'string' || maybePath.length === 0) {
    return undefined
  }

  return maybePath.startsWith('file://') ? fileURLToPath(maybePath) : maybePath
}

function extractStackFramePath(line) {
  if (typeof line !== 'string' || line.length === 0) {
    return undefined
  }

  const match = line.trim().match(/\(?(file:\/\/\/.+?|[a-z]:[\\/].+?|\/.+?):\d+:\d+\)?$/i)
  return match?.[1]
}

function isWindowsPath(filePath) {
  return /^[a-z]:[\\/]/i.test(filePath)
}

function stackPathBasename(filePath) {
  return isWindowsPath(filePath) ? win32.basename(filePath) : basename(filePath)
}

function stackPathDirname(filePath) {
  return isWindowsPath(filePath) ? win32.dirname(filePath) : dirname(filePath)
}

/**
 * Infer the app root from the call stack — the directory of the nearest
 * `eslint.config.*` frame outside this package.
 *
 * @param {string} [stack]
 */
export function inferAppRootDirFromStack(stack = new Error().stack) {
  if (typeof stack !== 'string' || stack.length === 0) {
    return undefined
  }

  for (const line of stack.split('\n')) {
    const candidatePath = normalizeStackPath(extractStackFramePath(line))

    if (!candidatePath || candidatePath.startsWith(THIS_DIR)) {
      continue
    }

    const callerFileName = stackPathBasename(candidatePath)

    if (!callerFileName || !ESLINT_CONFIG_FILENAMES.has(callerFileName)) {
      continue
    }

    return stackPathDirname(candidatePath)
  }

  return undefined
}

/** Pack entries that carry type-aware parser wiring for createAppLintConfig to patch. */
const PROJECT_SERVICE_CONFIG_NAMES = new Set([
  'narduk/correctness-type-aware',
  'narduk/server-type-aware',
])

function patchCorrectnessProjectServiceConfig(config, appRootDir) {
  if (!appRootDir || !PROJECT_SERVICE_CONFIG_NAMES.has(config?.name)) {
    return config
  }

  const parserOptions = config.languageOptions?.parserOptions ?? {}
  const existingProjectService =
    parserOptions.projectService && typeof parserOptions.projectService === 'object'
      ? parserOptions.projectService
      : {}

  return {
    ...config,
    languageOptions: {
      ...config.languageOptions,
      parserOptions: {
        ...parserOptions,
        projectService: {
          allowDefaultProject: ['./*.js'],
          ...existingProjectService,
          defaultProject: join(appRootDir, '.nuxt/tsconfig.json'),
        },
        tsconfigRootDir: appRootDir,
      },
    },
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Extract component names from a generated `components.d.ts`.
 *
 * @param {string} componentDeclarations
 */
export function parseNuxtComponentNames(componentDeclarations) {
  if (typeof componentDeclarations !== 'string' || componentDeclarations.length === 0) {
    return []
  }

  const componentNames = new Set()
  let insideGlobalComponents = false

  for (const line of componentDeclarations.split('\n')) {
    const exportMatch = /^\s*export const (\w+)\s*:/.exec(line)
    const exportName = exportMatch?.[1]

    if (exportName && exportName[0] === exportName[0].toUpperCase()) {
      componentNames.add(exportName)
    }

    if (/\binterface\s+_?GlobalComponents\b/.test(line)) {
      insideGlobalComponents = true
      continue
    }

    if (!insideGlobalComponents) {
      continue
    }

    if (line.trim().startsWith('}')) {
      insideGlobalComponents = false
      continue
    }

    const propertyMatch = /^\s*['"]?(\w+)['"]?\s*:/.exec(line)
    const propertyName = propertyMatch?.[1]

    if (propertyName && propertyName[0] === propertyName[0].toUpperCase()) {
      componentNames.add(propertyName)
    }
  }

  return [...componentNames].sort()
}

function readNuxtComponentGraph(appRootDir) {
  if (!appRootDir) {
    return []
  }

  const candidateFiles = [
    join(appRootDir, '.nuxt/components.d.ts'),
    join(appRootDir, '.nuxt/types/components.d.ts'),
  ]

  for (const candidateFile of candidateFiles) {
    if (!existsSync(candidateFile)) {
      continue
    }

    try {
      return parseNuxtComponentNames(readFileSync(candidateFile, 'utf8'))
    } catch {
      continue
    }
  }

  return []
}

/**
 * Build the exact `vue/no-undef-components` allowlist for an app.
 *
 * @param {string[]} [componentNames]
 */
export function buildNuxtAutoImportComponentOverride(componentNames = []) {
  const exactComponentNames = [...new Set([...NUXT_BUILT_IN_COMPONENTS, ...componentNames])]
    .filter((name) => typeof name === 'string' && name.length > 0)
    .sort()

  return {
    name: 'narduk/nuxt-auto-import-components',
    files: ['**/*.vue'],
    rules: {
      'vue/no-undef-components': [
        'warn',
        {
          ignorePatterns: exactComponentNames.map((name) => `^${escapeRegExp(name)}$`),
        },
      ],
    },
  }
}

function buildContentPresetOverrides({ trustedHtmlFiles = [] } = {}) {
  const overrides = []

  if (trustedHtmlFiles.length) {
    overrides.push({
      name: 'narduk/app-type-content-trusted-html',
      files: trustedHtmlFiles,
      rules: { 'vue/no-v-html': 'off' },
    })
  }

  return overrides
}

function buildContentRelaxedOverrides(contentRelaxedFiles) {
  if (!contentRelaxedFiles?.length) {
    return []
  }

  return [
    {
      name: 'narduk/content-relaxed',
      files: contentRelaxedFiles,
      rules: CONTENT_RELAXED_RULES_OFF,
    },
  ]
}

function buildUtilityComposableOverrides(utilityComposableFiles) {
  if (!utilityComposableFiles?.length) {
    return []
  }

  return [
    {
      name: 'narduk/utility-composables',
      files: utilityComposableFiles,
      rules: { 'narduk/no-composable-conditional-hooks': 'off' },
    },
  ]
}

/**
 * Create a fully-composed ESLint flat config for a Nuxt app.
 *
 * Signature-compatible with v1. Two options are accepted but inert in v2
 * because the rules they targeted were dropped by the deep review:
 * `seoMode` / `internalOnlyPageGlobs` (the three SEO rules) and
 * `allowedBrandIconFiles` (`lucide-icons-only`).
 *
 * @param {object}                                options
 * @param {Function}                              options.withNuxt              app-local `withNuxt()` wrapper
 * @param {string[]}                              [options.capabilityPacks]
 * @param {boolean}                               [options.communityLayer=true] set false to omit the
 *   community plugin tail; baseline ignores and housekeeping stay on
 * @param {'required'|'internal-only'|'disabled'} [options.seoMode]             accepted, inert in v2
 * @param {string[]}                              [options.internalOnlyPageGlobs] accepted, inert in v2
 * @param {string[]}                              [options.contentRelaxedFiles]
 * @param {string[]}                              [options.additionalNuxtUiComponents]
 * @param {Array}                                 [options.extraOverrides]
 * @param {'admin'|'content'}                     [options.appType]
 * @param {string[]}                              [options.trustedHtmlFiles]
 * @param {string[]}                              [options.allowedBrandIconFiles] accepted, inert in v2
 * @param {string[]}                              [options.utilityComposableFiles]
 * @param {string}                                [options.appRootDir]
 * @param {string}                                [options.tailwindEntryPoint]  opt in to the
 *   theme-resolving better-tailwindcss rules; requires the `design-system`
 *   capability pack. Omitted means those rules stay off, even if
 *   `app/assets/css/main.css` exists or `tailwindcss` happens to resolve.
 */
export function createAppLintConfig({
  withNuxt,
  capabilityPacks = [],
  communityLayer = true,
  seoMode = 'required',
  internalOnlyPageGlobs = [],
  contentRelaxedFiles = [],
  additionalNuxtUiComponents = [],
  extraOverrides = [],
  appType = undefined,
  trustedHtmlFiles = [],
  allowedBrandIconFiles = [],
  utilityComposableFiles = [],
  appRootDir = inferAppRootDirFromStack(),
  // Deliberately left without a destructuring default. An omitted value means
  // the app did not declare Tailwind (narduk-libs#665). A supplied path is the
  // opt-in. Comparing a supplied value against DEFAULT_TAILWIND_ENTRY_POINT
  // would conflate them: spelling the conventional path out loud is still
  // asking. The factory also has to tell "said nothing" apart from "asked"
  // when `design-system` is missing (silence vs. a named error).
  tailwindEntryPoint,
} = {}) {
  if (typeof withNuxt !== 'function') {
    throw new TypeError('createAppLintConfig requires the app-local withNuxt() wrapper')
  }

  if (typeof communityLayer !== 'boolean') {
    throw new TypeError('createAppLintConfig communityLayer must be a boolean')
  }

  void seoMode
  void internalOnlyPageGlobs
  void allowedBrandIconFiles

  const sharedConfigsForApp = composeSharedConfigs({
    packs: capabilityPacks,
    communityLayer,
  })
  const sanitizedSharedConfigs = sharedConfigsForApp
    .map(stripNuxtManagedPlugins)
    .map((config) => patchCorrectnessProjectServiceConfig(config, appRootDir))

  // Composed here rather than inline below so a misconfiguration throws before
  // the factory starts reading the app's component graph off disk — and after
  // composeSharedConfigs, so an unknown pack name still reports itself first.
  const tailwindThemeOverrides = buildTailwindThemeOverride({
    appRootDir,
    capabilityPacks,
    tailwindEntryPoint,
  })

  let appTypeOverrides = []

  if (appType === 'admin') {
    appTypeOverrides = ADMIN_PRESET_OVERRIDES
  } else if (appType === 'content') {
    appTypeOverrides = buildContentPresetOverrides({ trustedHtmlFiles })
  }

  const composed = withNuxt(
    ...sanitizedSharedConfigs,
    ...buildContentRelaxedOverrides(contentRelaxedFiles),
    // v1's additionalNuxtUiComponents fed narduk/no-unknown-nuxt-ui-component;
    // in v2 they widen the same vue/no-undef-components allowlist as the
    // generated component graph.
    buildNuxtAutoImportComponentOverride([
      ...readNuxtComponentGraph(appRootDir),
      ...additionalNuxtUiComponents,
    ]),
    ...buildUtilityComposableOverrides(utilityComposableFiles),
    ...tailwindThemeOverrides,
    ...appTypeOverrides,
    ...extraOverrides,
  )

  // Type-aware rules read the TypeScript program the parser built, so the
  // rule implementations must come from the same typescript-eslint install as
  // `tseslint.parser` above. withNuxt() registers @nuxt/eslint-config's own
  // copy of the plugin, which can be bound to a different `typescript`: in
  // narduk-libs, TS 5.9's `TypeFlags` were read against a TS 6 program and
  // no-misused-promises crashed (`tsutils.unionConstituents is not a
  // function or its return value is not iterable`). Swap in the plugin that
  // pairs with the parser. The composer API is optional so a plain-array
  // withNuxt (tests, older wrappers) still works.
  return typeof composed?.replacePlugin === 'function'
    ? composed.replacePlugin('@typescript-eslint', tseslint.plugin)
    : composed
}

export const createAppEslintConfig = createAppLintConfig

export default createAppLintConfig
