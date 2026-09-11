/**
 * `narduk-app foundation:check:shared-ui-pinned` -- components-library-plan.md
 * §2 item 6, narduk-libs#253. See
 * `../foundation/evaluate-shared-ui-pinned.js` for why this is a separate
 * command and artefact from `foundation:check` rather than an eighth item
 * folded into that ratified 7-item contract.
 *
 * Exit codes, same convention as `foundation:check` (no warning tier):
 *   0  PASS    every narduk-shell/-ui/-charts package this app depends on is
 *              an exact pin; one it does not depend on is N/A, and an app with
 *              no UI surface is N/A in full.
 *   1  FAIL    a depended-on shared-UI package is pinned as a range or a
 *              `workspace:` / `file:` specifier (or one listed in
 *              `PRESENCE_REQUIRED` is absent -- that list is empty today).
 *   2  UNKNOWN nothing failed, but no `package.json` was readable at a known
 *              monorepo path. The app's own CI should treat this as a failure
 *              too.
 *
 * A registry credential is NOT required: every verdict above is decided from
 * the app's own manifests, and the registry is consulted only to annotate a
 * passing pin with the latest published version (narduk-libs#282 review). That
 * is what lets the generated CI run this after its install step has dropped the
 * GitHub Packages token.
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
