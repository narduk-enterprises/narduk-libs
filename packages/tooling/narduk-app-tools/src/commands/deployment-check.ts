/**
 * `narduk-app foundation:check:deployment` -- item 12, the Narduk deployment
 * standard (design §2.2 tier 1). See `../foundation/evaluate-deployment.js` for
 * why this is a separate command and artefact from `foundation:check` rather
 * than a twelfth item folded into that ratified 7-item contract.
 *
 * Exit codes, same convention as `foundation:check` (no warning tier):
 *   0  PASS    the app declares the standard correctly -- or, in the default
 *              rollout mode, has not adopted it yet and says so.
 *   1  FAIL    the block claims the standard and does not satisfy it; or the
 *              §3.2 refusal fired (non-production branch builds against
 *              production D1/KV/R2); or --strict was passed and no block exists.
 *   2  UNKNOWN the block is valid but something it depends on could not be read.
 *
 * `--strict` is the rollout lever. Shipping this command turns no app's CI red:
 * an app with no `deployment` block exits 0 with a NOT ADOPTED banner. Once the
 * estate has adopted (§7.2), CI passes `--strict` and a missing block fails.
 *
 * No credential is required -- and that is also the limit of what it proves:
 * the artefact's `limitations` are printed with every verdict.
 */

import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { readOwnVersion } from './own-version.js'
import {
  formatDeploymentSummary,
  runDeploymentCheck,
  type DeploymentArtefact,
} from '../foundation/evaluate-deployment.js'

export interface DeploymentCheckFlags {
  checkoutDir: string
  jsonPath: string | null
  json: boolean
  strict: boolean
}

export function parseDeploymentCheckArgs(
  args: string[],
  cwd = process.cwd(),
): DeploymentCheckFlags {
  const flags: DeploymentCheckFlags = {
    checkoutDir: cwd,
    jsonPath: null,
    json: false,
    strict: false,
  }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--checkout') flags.checkoutDir = args[(index += 1)] ?? flags.checkoutDir
    else if (arg === '--strict') flags.strict = true
    else if (arg === '--json') {
      const next = args[index + 1]
      if (next && !next.startsWith('--')) {
        flags.jsonPath = next
        index += 1
      } else {
        flags.json = true
      }
    } else throw new Error(`Unknown foundation:check:deployment option: ${arg}`)
  }
  return { ...flags, checkoutDir: resolve(flags.checkoutDir) }
}

export function runDeploymentCheckCommand(flags: DeploymentCheckFlags): {
  artefact: DeploymentArtefact
  exitCode: number
} {
  const artefact = runDeploymentCheck({
    root: flags.checkoutDir,
    toolVersion: readOwnVersion(),
    strict: flags.strict,
  })
  if (flags.jsonPath) {
    writeFileSync(flags.jsonPath, JSON.stringify(artefact, null, 2) + '\n', 'utf8')
  }
  if (flags.json) {
    console.log(JSON.stringify(artefact, null, 2))
  } else {
    console.log(formatDeploymentSummary(artefact))
  }
  return { artefact, exitCode: artefact.exitCode }
}
