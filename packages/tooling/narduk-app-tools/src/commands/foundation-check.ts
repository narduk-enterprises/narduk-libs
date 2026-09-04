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

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { runFoundationCheck } from '../foundation/evaluate.js'
import { formatArtefactSummary } from '../foundation/schema.js'
import type { FoundationCheckArtefact } from '../foundation/types.js'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

function readOwnVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
      version?: unknown
    }
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0'
  } catch {
    return '0.0.0'
  }
}

export interface FoundationCheckFlags {
  checkoutDir: string
  jsonPath: string | null
  json: boolean
}

export function parseFoundationCheckArgs(args: string[]): FoundationCheckFlags {
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
    } else throw new Error(`Unknown foundation:check option: ${arg}`)
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
  return { artefact, exitCode: artefact.exitCode }
}
