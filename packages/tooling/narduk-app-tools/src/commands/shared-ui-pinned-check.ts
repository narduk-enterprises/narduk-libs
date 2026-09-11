/**
 * `narduk-app foundation:check:shared-ui-pinned` -- components-library-plan.md
 * §2 item 6, narduk-libs#253. See
 * `../foundation/evaluate-shared-ui-pinned.js` for why this is a separate
 * command and artefact from `foundation:check` rather than an eighth item
 * folded into that ratified 7-item contract.
 *
 * Exit codes, same convention as `foundation:check` (no warning tier):
 *   0  PASS    every published narduk-shell/-ui/-charts package is an exact pin;
 *              unpublished packages are N/A.
 *   1  FAIL    a published package is missing, or a present pin is a range.
 *   2  UNKNOWN nothing failed, but at least one fact could not be decided
 *              (no package.json, or the registry was unreadable). The app's
 *              own CI should treat this as a failure too.
 */

import { writeFileSync } from 'node:fs'

import type { FoundationCheckFlags } from './foundation-check.js'
import { readOwnVersion } from './own-version.js'
import {
  formatSharedUiPinnedSummary,
  runSharedUiPinnedCheck,
} from '../foundation/evaluate-shared-ui-pinned.js'
import type { SharedUiPinnedArtefact } from '../foundation/evaluate-shared-ui-pinned.js'

export async function runSharedUiPinnedCheckCommand(flags: FoundationCheckFlags): Promise<{
  artefact: SharedUiPinnedArtefact
  exitCode: number
}> {
  const artefact = await runSharedUiPinnedCheck({
    root: flags.checkoutDir,
    toolVersion: readOwnVersion(),
  })
  if (flags.jsonPath) {
    writeFileSync(flags.jsonPath, JSON.stringify(artefact, null, 2) + '\n', 'utf8')
  }
  if (flags.json) {
    console.log(JSON.stringify(artefact, null, 2))
  } else {
    console.log(formatSharedUiPinnedSummary(artefact))
  }
  return { artefact, exitCode: artefact.exitCode }
}
