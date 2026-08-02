// @ts-check
/**
 * `auth` capability pack — CSRF and rate-limit gates on mutation routes.
 *
 * All three rules are rebuilt on the repaired `mutation-route` gate
 * (`src/rules/utils/mutation-route.ts`), which covers `server/api/**` *and*
 * `server/routes/**`, method-suffix filenames *and* handlers that declare their
 * method, so a route rename can no longer silently switch four security rules
 * off. `require-csrf-header-on-mutations` is additionally rewired onto file
 * globs that exist, and `no-csrf-exempt-route-misuse` now inspects the header it
 * claims to.
 */

import narduk from '../dist/index.js'

import { SERVER_FILE_GLOBS } from './server.mjs'

/** @type {import('eslint').Linter.Config[]} */
const authConfigs = [
  {
    name: 'narduk/auth',
    files: [...SERVER_FILE_GLOBS],
    plugins: { narduk },
    rules: {
      'narduk/require-csrf-header-on-mutations': 'error',
      'narduk/no-csrf-exempt-route-misuse': 'warn',
      'narduk/require-enforce-rate-limit-on-mutations': 'error',
    },
  },
]

export { authConfigs }
export default authConfigs
