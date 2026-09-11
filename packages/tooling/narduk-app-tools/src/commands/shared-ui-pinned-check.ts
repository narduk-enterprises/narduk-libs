/**
 * `narduk-app foundation:check:shared-ui-pinned` -- components-library-plan.md
 * §2 item 6, narduk-libs#253. See
 * `../foundation/evaluate-shared-ui-pinned.js` for why this is a separate
 * command and artefact shape from `foundation:check` rather than an eighth
 * item folded into that ratified contract.
 *
 * Exit codes, same convention as `foundation:check` (no warning tier):
 *   0  PASS    narduk-shell/-ui/-charts are pinned per the rule table; nothing unknown.
 *   1  FAIL    a required or present-but-loose pin failed.
 *   2  UNKNOWN nothing failed, but at least one fact (e.g. narduk-shell's
 *              publication status) could not be decided from here. The
 *              app's own CI should treat this as a failure too.
 */

import { writeFileSync } from 'node:fs'

import { readOwnVersion } from './foundation-check.js'
import type { FoundationCheckFlags } from './foundation-check.js'
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
