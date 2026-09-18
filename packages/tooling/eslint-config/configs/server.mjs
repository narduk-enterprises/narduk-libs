// @ts-check
/**
 * `server` capability pack — Nitro handler data discipline, the Cloudflare
 * runtime guardrails, and server import hygiene.
 *
 * Two v1 rules are replaced by core ESLint here:
 *
 * - `no-await-in-loop-in-server` → core `no-await-in-loop`, scoped to `server/**`.
 * - `no-relative-server-imports` → core `no-restricted-imports`. v1's version
 *   resolved each relative specifier and only flagged the ones landing back in
 *   `server/`; inside `server/**` that is nearly all of them, so the pattern
 *   form says the same thing without a bespoke resolver, and without v1's
 *   autofixer rewriting specifiers.
 *
 * ## `no-restricted-imports` is not spelled out here any more
 *
 * It used to be. Flat config merges *configs*, not rule options — the last
 * entry matching a file replaces the whole `no-restricted-imports` setting —
 * so each pack restated the bans of the packs it expected to sort before it.
 * That is order-dependent by construction, and the adversarial pass broke it
 * with a legal pack order (`core, server, auth, template, cloudflare`). All
 * three packs now assign the same constant; see `configs/restricted-imports.mjs`
 * for the full account, and `tests/composition/no-restricted-imports.test.ts`
 * for the proof across both orders.
 *
 * ## Nesting-safe globs
 *
 * `SERVER_FILE_GLOBS` was `server/**`, which ESLint anchors at the config's
 * base path: linting a repository from an outer `cwd` matched nothing, and an
 * unwrapped mutation handler in `<nested>/server/api/` drew no diagnostics at
 * all in the adversarial pass. A leading recursive-wildcard segment makes the
 * pack apply at any depth; every rule re-derives its own scope from the filename through
 * `analyzeServerRoutePath()`, so matching a wider set of files does not widen
 * what any rule actually reports on.
 */

import sonarjs from 'eslint-plugin-sonarjs'
import tseslint from 'typescript-eslint'

import narduk from '../dist/index.js'

import cloudflareConfigs from './cloudflare.mjs'
import { TYPE_AWARE_IGNORES } from './correctness.mjs'
import { RESTRICTED_IMPORTS_RULE, TEST_TREE_IGNORES } from './restricted-imports.mjs'

/** Nitro server sources, at any nesting depth. */
export const SERVER_FILE_GLOBS = ['**/server/**/*.{js,cjs,mjs,jsx,ts,cts,mts,tsx}']

/** TypeScript server sources — the ones a project service can type. */
export const SERVER_TS_FILE_GLOBS = ['**/server/**/*.{ts,cts,mts,tsx}']

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
const serverConfigs = [
  {
    name: 'narduk/server-data',
    files: [...SERVER_FILE_GLOBS],
    plugins: { narduk },
    rules: {
      'narduk/prefer-safe-parse-in-event-handlers': 'error',
      'narduk/no-raw-define-event-handler-in-mutation-routes': 'error',
      'narduk/require-immediate-mutation-body-validation': 'error',
      // DESIGN.md let the server lane drop `require-validated-body` and
      // `prefer-drizzle-operators` if they could not be hardened in scope, and
      // record which. Neither shipped, so neither is referenced here.
      'narduk/require-validated-query': 'error',
      'narduk/no-raw-sql-with-variable-input': 'error',
      'narduk/require-limit-on-drizzle-list-queries': 'error',
      'narduk/no-sequential-awaited-io-in-event-handler': 'error',
      'narduk/no-blocking-io-in-server-plugin': 'error',
      // Warn, budgeted by narduk-lint (2026-09-18).
      'narduk/require-fetch-timeout': 'warn',
      'narduk/prefer-db-batch': 'warn',
    },
  },

  {
    // SonarJS S2077: dynamically formatted SQL. Complements
    // no-raw-sql-with-variable-input (drizzle `sql.raw`) by catching string-built
    // queries handed to any driver. Warn, budgeted.
    name: 'narduk/server-sql',
    files: [...SERVER_FILE_GLOBS],
    ignores: [...TEST_TREE_IGNORES],
    plugins: { sonarjs },
    rules: {
      'sonarjs/sql-queries': 'warn',
    },
  },

  {
    // A floating promise in a Nitro handler is work the response does not wait
    // for — on Workers it is cancelled when the response returns, and its
    // rejection is unhandled. Error from day one (2026-09-18). Type-aware, so
    // this entry carries its own project-service wiring and does not depend on
    // the `correctness` pack being selected; createAppLintConfig() points it at
    // the app's generated tsconfig exactly as it does correctness's entry.
    name: 'narduk/server-type-aware',
    files: [...SERVER_TS_FILE_GLOBS],
    ignores: [...TYPE_AWARE_IGNORES, ...TEST_TREE_IGNORES],
    plugins: { '@typescript-eslint': tseslint.plugin },
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
    },
  },

  ...cloudflareConfigs,

  {
    // The two CORE rules in this pack. Every bespoke rule above derives its own
    // test exemption from the filename; these two cannot, so the glob supplies
    // it — otherwise a nesting-safe `server/**` turns a suite's relative import
    // of the module under test, and a deliberately sequential fixture loop,
    // into errors. See TEST_TREE_IGNORES.
    name: 'narduk/server-runtime',
    files: [...SERVER_FILE_GLOBS],
    ignores: [...TEST_TREE_IGNORES],
    rules: {
      'no-restricted-imports': RESTRICTED_IMPORTS_RULE,
      // Replaces narduk/no-await-in-loop-in-server.
      'no-await-in-loop': 'error',
    },
  },
]

export { serverConfigs }
export default serverConfigs
