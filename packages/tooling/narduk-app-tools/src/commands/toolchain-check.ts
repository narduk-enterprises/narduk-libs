/**
 * `narduk-app foundation:check:toolchain` -- item 11, the single-source
 * toolchain contract (Logan, askme 2026-09-17). See
 * `../foundation/evaluate-toolchain.js` for why this is a separate command and
 * artefact from `foundation:check` rather than an eleventh item folded into that
 * ratified 7-item contract.
 *
 * Exit codes, same convention as `foundation:check` (no warning tier):
 *   0  PASS    both sources are declared, every mirror agrees, and CI resolves
 *              its versions from the sources rather than restating them.
 *   1  FAIL    a source is missing, or a mirror disagrees, or a workflow pins a
 *              literal instead of pointing at the source.
 *   2  UNKNOWN no package.json at a known monorepo-candidate path -- this is not
 *              an app checkout. The app's own CI should treat this as a failure
 *              too.
 *
 * No credential is required: every verdict comes from the app's own files, which
 * is what lets this be wired into a generated CI job after the install step has
 * dropped the GitHub Packages token.
 */

import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { readOwnVersion } from './own-version.js'
import {
  formatToolchainSummary,
  runToolchainCheck,
  type ToolchainArtefact,
} from '../foundation/evaluate-toolchain.js'

export interface ToolchainCheckFlags {
  checkoutDir: string
  jsonPath: string | null
  json: boolean
  fix: boolean
}

export function parseToolchainCheckArgs(args: string[], cwd = process.cwd()): ToolchainCheckFlags {
  const flags: ToolchainCheckFlags = {
    checkoutDir: cwd,
    jsonPath: null,
    json: false,
    fix: false,
  }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--checkout') flags.checkoutDir = args[(index += 1)] ?? flags.checkoutDir
    else if (arg === '--fix') flags.fix = true
    else if (arg === '--json') {
      const next = args[index + 1]
      if (next && !next.startsWith('--')) {
        flags.jsonPath = next
        index += 1
      } else {
        flags.json = true
      }
    } else throw new Error(`Unknown foundation:check:toolchain option: ${arg}`)
  }
  return { ...flags, checkoutDir: resolve(flags.checkoutDir) }
}

export function runToolchainCheckCommand(flags: ToolchainCheckFlags): {
  artefact: ToolchainArtefact
  exitCode: number
} {
  const artefact = runToolchainCheck({
    root: flags.checkoutDir,
    toolVersion: readOwnVersion(),
    fix: flags.fix,
  })
  if (flags.jsonPath) {
    writeFileSync(flags.jsonPath, JSON.stringify(artefact, null, 2) + '\n', 'utf8')
  }
  if (flags.json) {
    console.log(JSON.stringify(artefact, null, 2))
  } else {
    console.log(formatToolchainSummary(artefact))
  }
  return { artefact, exitCode: artefact.exitCode }
}
