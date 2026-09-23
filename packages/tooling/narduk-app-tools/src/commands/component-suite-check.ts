/**
 * `narduk-app foundation:check:no-local-copy` (item 13) and
 * `narduk-app foundation:check:list-routes` (item 14) -- narduk-libs#260. See
 * `../foundation/evaluate-component-suite.js`.
 *
 * Exit codes, same convention as `foundation:check`:
 *   0  PASS    nothing failed; an app with no UI (13) or no server routes (14)
 *              is N/A in full.
 *   1  FAIL    13: an app-local component copies a shared package the app
 *              depends on. 14: a GET route reads pagination from its query
 *              without `parseListQuery`.
 *   2  UNKNOWN reserved; neither item has an undecidable state today.
 */

import { writeFileSync } from 'node:fs'

import type { FoundationCheckFlags } from './foundation-check.js'
import { readOwnVersion } from './own-version.js'
import {
  formatComponentSuiteSummary,
  runListRoutesCheck,
  runNoLocalCopyCheck,
  type ComponentSuiteArtefact,
  type RunComponentSuiteCheckOptions,
} from '../foundation/evaluate-component-suite.js'

function report(
  command: string,
  flags: FoundationCheckFlags,
  run: (options: RunComponentSuiteCheckOptions) => ComponentSuiteArtefact,
): { artefact: ComponentSuiteArtefact; exitCode: number } {
  const artefact = run({ root: flags.checkoutDir, toolVersion: readOwnVersion() })
  if (flags.jsonPath) {
    writeFileSync(flags.jsonPath, JSON.stringify(artefact, null, 2) + '\n', 'utf8')
  }
  console.log(
    flags.json ? JSON.stringify(artefact, null, 2) : formatComponentSuiteSummary(command, artefact),
  )
  return { artefact, exitCode: artefact.exitCode }
}

export function runNoLocalCopyCheckCommand(flags: FoundationCheckFlags) {
  return report('foundation:check:no-local-copy', flags, runNoLocalCopyCheck)
}

export function runListRoutesCheckCommand(flags: FoundationCheckFlags) {
  return report('foundation:check:list-routes', flags, runListRoutesCheck)
}
