/**
 * `narduk-app foundation:check` -- spec:
 * company-hq `docs/WEB-FOUNDATION-CHECK.md` §4, §5 (D-WEBFOUND-2 Q9 (a)).
 *
 * Exit codes (spec §5, no warning tier):
 *   0  PASS    every applicable item passed; nothing is unknown.
 *   1  FAIL    at least one item is fail.
 *   2  UNKNOWN nothing failed, but at least one item could not be decided.
 *              The app's own CI must treat this as a failure too.
 */

import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { runFoundationCheck } from '../foundation/evaluate.js'
import { evaluateDependabotStackingShape } from '../foundation/items/item-5-shared-ci.js'
import { formatArtefactSummary } from '../foundation/schema.js'
import { AppRepo } from '../foundation/source.js'
import type { FoundationCheckArtefact } from '../foundation/types.js'
import { readOwnVersion } from './own-version.js'

export interface FoundationCheckFlags {
  checkoutDir: string
  jsonPath: string | null
  json: boolean
}

export function parseFoundationCheckArgs(
  args: string[],
  commandName = 'foundation:check',
): FoundationCheckFlags {
  let checkoutDir = process.cwd()
  let jsonPath: string | null = null
  let json = false
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--checkout') checkoutDir = args[(index += 1)] ?? checkoutDir
    else if (arg === '--json') {
      const next = args[index + 1]
      if (next && !next.startsWith('--')) {
        jsonPath = next
        index += 1
      } else {
        json = true
      }
    } else throw new Error(`Unknown ${commandName} option: ${arg}`)
  }
  return { checkoutDir: resolve(checkoutDir), jsonPath, json }
}

export async function runFoundationCheckCommand(flags: FoundationCheckFlags): Promise<{
  artefact: FoundationCheckArtefact
  exitCode: number
}> {
  const artefact = await runFoundationCheck({
    root: flags.checkoutDir,
    toolVersion: readOwnVersion(),
  })
  if (flags.jsonPath) {
    writeFileSync(flags.jsonPath, JSON.stringify(artefact, null, 2) + '\n', 'utf8')
  }
  if (flags.json) {
    console.log(JSON.stringify(artefact, null, 2))
  } else {
    console.log(formatArtefactSummary(artefact))
  }
  // Advisory only (narduk-libs#U2): the dependabot-stacking-shape check has
  // no `FoundationSubCheck` of its own on purpose -- see
  // `evaluateDependabotStackingShape`'s doc comment for why folding it into
  // item 5 would fail CI on every unmigrated app instead of warning it. This
  // print never touches `artefact` or `exitCode`.
  const stackingWarning = evaluateDependabotStackingShape(new AppRepo(flags.checkoutDir))
  if (stackingWarning) {
    console.warn(`::warning::${stackingWarning}`)
  }
  return { artefact, exitCode: artefact.exitCode }
}
