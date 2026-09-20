/**
 * `narduk-app doctor --adoption` -- the fifteen-requirement adoption report.
 *
 * WHY A MODE ON `doctor` AND NOT A NEW COMMAND. `doctor` is already the "tell
 * me the state of this app" entry point, and a declaration is that question
 * asked against a standard rather than against a developer's machine. A
 * seventh `foundation:check:*` sibling would also imply this is a thirteenth
 * contract item, which it is not: the contract items are inputs to it.
 *
 * WHAT `doctor` KEEPS. Bare `doctor` is untouched -- same checks, same output,
 * same exit code. `--adoption` replaces it rather than extending it, because
 * the two answer different questions for different readers, and a report that
 * silently changed shape under an existing flag would break the consumers the
 * seven-item artefact was frozen to protect.
 *
 * Exit codes, the same convention as every `foundation:check:*`:
 *   0  PASS     every machine-decidable requirement passes or is N/A.
 *   1  FAIL     at least one is failing.
 *   2  UNKNOWN  none failing, but at least one could not be decided -- which
 *               includes every run given no `--live`, since three requirements
 *               are questions only a deployed origin can answer.
 *
 * A PASS here is not a declaration. Requirements the command cannot decide are
 * reported as `manual` and listed under `manualReview`; a sign-off carries
 * separate evidence for each of those, and this artefact is the record of
 * which half was machine-checked.
 */

import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { readOwnVersion } from './own-version.js'
import {
  formatAdoptionSummary,
  runAdoptionCheck,
  type AdoptionArtefact,
} from '../foundation/evaluate-adoption.js'

export interface AdoptionReportFlags {
  checkoutDir: string
  jsonPath: string | null
  json: boolean
  /** The deployed origin. Without it R5, R8 and R12 stay undecided. */
  liveUrl: string | null
  /** The commit that should be live, compared against `x-build-version`. */
  expectSha: string | null
  /** Routes for the item 10 probe, beyond `/`. */
  paths: string[]
}

export function parseAdoptionReportArgs(args: string[], cwd = process.cwd()): AdoptionReportFlags {
  const flags: AdoptionReportFlags = {
    checkoutDir: cwd,
    expectSha: null,
    json: false,
    jsonPath: null,
    liveUrl: null,
    paths: [],
  }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--adoption') continue
    else if (arg === '--checkout') flags.checkoutDir = args[(index += 1)] ?? flags.checkoutDir
    else if (arg === '--live') flags.liveUrl = args[(index += 1)] ?? null
    else if (arg === '--expect-sha') flags.expectSha = args[(index += 1)] ?? null
    else if (arg === '--path') {
      const next = args[(index += 1)]
      if (next) flags.paths.push(next)
    } else if (arg === '--json') {
      const next = args[index + 1]
      if (next && !next.startsWith('--')) {
        flags.jsonPath = next
        index += 1
      } else {
        flags.json = true
      }
    } else throw new Error(`Unknown doctor --adoption option: ${arg}`)
  }
  if (flags.expectSha && !flags.liveUrl) {
    throw new Error('--expect-sha needs --live: there is no origin to compare the commit against')
  }
  return { ...flags, checkoutDir: resolve(flags.checkoutDir) }
}

export async function runAdoptionReportCommand(flags: AdoptionReportFlags): Promise<{
  artefact: AdoptionArtefact
  exitCode: number
}> {
  const artefact = await runAdoptionCheck({
    expectSha: flags.expectSha ?? undefined,
    headerPaths: flags.paths.length > 0 ? flags.paths : undefined,
    liveUrl: flags.liveUrl ?? undefined,
    root: flags.checkoutDir,
    toolVersion: readOwnVersion(),
  })
  if (flags.jsonPath) {
    writeFileSync(flags.jsonPath, JSON.stringify(artefact, null, 2) + '\n', 'utf8')
  }
  if (flags.json) {
    console.log(JSON.stringify(artefact, null, 2))
  } else {
    console.log(formatAdoptionSummary(artefact))
  }
  return { artefact, exitCode: artefact.exitCode }
}
