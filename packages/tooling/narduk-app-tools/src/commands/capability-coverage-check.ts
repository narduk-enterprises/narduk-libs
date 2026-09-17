/**
 * `narduk-app foundation:check:coverage` -- item 9, shared-capability coverage.
 *
 * Reports two things about one app checkout:
 *
 *   (a) INVENTORY -- every `@narduk-enterprises/*` dependency the app pins, with
 *       its version and the manifest it came from, beside the catalog of shared
 *       capabilities the estate publishes (derived from narduk-libs'
 *       `pnpm-workspace.yaml` at build time, never hand-typed). The `--json`
 *       artefact carries this as data so the estate roster can consume it.
 *
 *   (b) REIMPLEMENTATION DETECTION -- app-local code doing a shared package's
 *       job: a local logger, a copied narduk-seo helper, a posthog-js wrapper, a
 *       hand-rolled `/api/health` route, or a duplicate error plugin / response
 *       finish listener (narduk-logging adoption guide step 5).
 *
 * See `../foundation/evaluate-capability-coverage.js` for why this is a separate
 * command and artefact rather than a ninth item folded into the ratified 7-item
 * `foundation-check.json`.
 *
 * Exit codes, same convention as `foundation:check` (no warning tier):
 *   0  PASS    the inventory was produced and no reimplementation was found.
 *   1  FAIL    a CONFIRMED reimplementation: the owning shared package is a
 *              dependency and the app has a local twin anyway. The sub-check
 *              names the exact file path and the owning package.
 *   2  UNKNOWN nothing was confirmed, but something is undecided -- a HEURISTIC
 *              match (printed `WARN`), an estate pin the catalog cannot
 *              classify, an unreadable manifest, or a scan that hit its file
 *              ceiling. An app's own CI should treat this as a failure too.
 *
 * No registry credential is required: every verdict is decided from the app's
 * own manifests and source.
 */

import { writeFileSync } from 'node:fs'

import type { FoundationCheckFlags } from './foundation-check.js'
import { readOwnVersion } from './own-version.js'
import {
  formatCapabilityCoverageSummary,
  runCapabilityCoverageCheck,
} from '../foundation/evaluate-capability-coverage.js'
import type { CapabilityCoverageArtefact } from '../foundation/evaluate-capability-coverage.js'

export function runCapabilityCoverageCheckCommand(flags: FoundationCheckFlags): {
  artefact: CapabilityCoverageArtefact
  exitCode: number
} {
  const artefact = runCapabilityCoverageCheck({
    root: flags.checkoutDir,
    toolVersion: readOwnVersion(),
  })
  if (flags.jsonPath) {
    writeFileSync(flags.jsonPath, JSON.stringify(artefact, null, 2) + '\n', 'utf8')
  }
  if (flags.json) {
    console.log(JSON.stringify(artefact, null, 2))
  } else {
    console.log(formatCapabilityCoverageSummary(artefact))
  }
  return { artefact, exitCode: artefact.exitCode }
}
