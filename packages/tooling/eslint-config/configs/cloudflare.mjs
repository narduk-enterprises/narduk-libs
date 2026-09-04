// @ts-check
/**
 * `cloudflare` capability pack — Worker runtime guardrails.
 *
 * All four v1 rules survive. Their shared gate (`src/rules/utils/cloudflare-runtime.ts`)
 * is rebuilt: no cross-run module-level `WeakMap` cache, worker-runtime
 * detection that is not fooled by a checkout path that merely contains
 * `~/workers/`, and a wider driver map.
 *
 * `no-restricted-imports` is assigned from the one shared constant in
 * `configs/restricted-imports.mjs`. This pack used to own the Node-built-in half
 * and restate nothing else, which made the merged setting depend on where a
 * consumer listed the pack — see that file for the failure and the fix. Its
 * constants are re-exported here so the v1-compatible import path
 * (`@narduk-enterprises/eslint-config/config/cloudflare`) keeps resolving.
 *
 * ## Nesting-safe globs
 *
 * These globs were `server/**` and `workers/**`, anchored at the config's base
 * path, so a tree linted from an outer `cwd` matched *nothing*: the adversarial
 * pass got zero diagnostics from an unwrapped `sql.raw(untrustedSql)` handler
 * in `<nested>/server/api/`, because no Cloudflare or server rule was switched
 * on for it at all. Every glob now carries a leading recursive-wildcard segment
 * so the pack applies at any depth. That is safe because each rule re-derives its own scope from
 * the filename (`isWorkerRuntimeFile`, `analyzeServerRoutePath`) instead of
 * trusting the glob to have been precise.
 */

import narduk from '../dist/index.js'

import { RESTRICTED_IMPORTS_RULE, TEST_TREE_IGNORES } from './restricted-imports.mjs'

/** Files that actually execute on the Workers runtime. */
export const WORKER_RUNTIME_GLOBS = [
  '**/server/**/*.{js,cjs,mjs,jsx,ts,cts,mts,tsx}',
  '**/workers/**/*.{js,cjs,mjs,ts,cts,mts}',
  '**/*.server.{js,cjs,mjs,ts,cts,mts}',
  '**/*.worker.{js,cjs,mjs,ts,cts,mts}',
]

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
const cloudflareConfigs = [
  {
    name: 'narduk/cloudflare',
    files: [...WORKER_RUNTIME_GLOBS],
    plugins: { narduk },
    rules: {
      'narduk/no-process-env-in-worker-runtime': 'error',
      'narduk/no-worker-global-scope-db-clients': 'error',
      'narduk/no-worker-global-scope-operations': 'error',
      'narduk/no-supabase-client-in-global-scope': 'warn',
    },
  },

  {
    // Core `no-restricted-imports` has no internal test-code gate, so the glob
    // gives it one: see TEST_TREE_IGNORES.
    name: 'narduk/cloudflare-imports',
    files: [...WORKER_RUNTIME_GLOBS],
    ignores: [...TEST_TREE_IGNORES],
    rules: {
      'no-restricted-imports': RESTRICTED_IMPORTS_RULE,
    },
  },
]

export { cloudflareConfigs }
export default cloudflareConfigs
