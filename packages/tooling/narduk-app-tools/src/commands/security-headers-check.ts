/**
 * `narduk-app foundation:check:security-headers` -- narduk-core's
 * `security.headers` preset, company-hq#745. See
 * `../foundation/evaluate-security-headers.js` for why this is a separate
 * command and artefact from `foundation:check` rather than a ninth item folded
 * into that ratified 7-item contract.
 *
 * Exit codes, same convention as `foundation:check` (no warning tier):
 *   0  PASS    every probed route serves the expected header set, and the CSP
 *              it enforces is nonce-based.
 *   1  FAIL    a probed route is missing a header, or enforces a policy whose
 *              script-src has no nonce.
 *   2  UNKNOWN no `--base-url` was given, or no route could be read. The app's
 *              own CI should treat this as a failure too -- "we did not look"
 *              is not evidence either way.
 *
 * No credential is required: this reads public response headers from a
 * deployed origin, which is what lets it be wired into a generated CI job
 * after the install step has dropped the GitHub Packages token.
 */

import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { readOwnVersion } from './own-version.js'
import {
  formatSecurityHeadersSummary,
  runSecurityHeadersCheck,
  type HeaderProbe,
  type SecurityHeadersArtefact,
} from '../foundation/evaluate-security-headers.js'

export interface SecurityHeadersCheckFlags {
  checkoutDir: string
  jsonPath: string | null
  json: boolean
  baseUrl: string | null
  paths: string[]
}

export function parseSecurityHeadersCheckArgs(
  args: string[],
  cwd = process.cwd(),
): SecurityHeadersCheckFlags {
  const flags: SecurityHeadersCheckFlags = {
    checkoutDir: cwd,
    jsonPath: null,
    json: false,
    baseUrl: null,
    paths: [],
  }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--checkout') flags.checkoutDir = args[(index += 1)] ?? flags.checkoutDir
    else if (arg === '--base-url') {
      const value = args[(index += 1)]
      if (!value || value.startsWith('--')) throw new Error('--base-url requires a value')
      flags.baseUrl = value
    } else if (arg === '--path') {
      const value = args[(index += 1)]
      if (!value || value.startsWith('--')) throw new Error('--path requires a value')
      flags.paths.push(value)
    } else if (arg === '--json') {
      const next = args[index + 1]
      if (next && !next.startsWith('--')) {
        flags.jsonPath = next
        index += 1
      } else {
        flags.json = true
      }
    } else throw new Error(`Unknown foundation:check:security-headers option: ${arg}`)
  }
  if (flags.paths.length > 0 && !flags.baseUrl) {
    throw new Error('--path requires --base-url')
  }
  if (flags.baseUrl) {
    // Fail here rather than inside the probe, where a bad URL would read as an
    // unreachable deployment.
    try {
      const parsed = new URL(flags.baseUrl)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('protocol')
      }
    } catch {
      throw new Error(`--base-url must be an http(s) URL, got ${JSON.stringify(flags.baseUrl)}`)
    }
  }
  return { ...flags, checkoutDir: resolve(flags.checkoutDir) }
}

export async function runSecurityHeadersCheckCommand(
  flags: SecurityHeadersCheckFlags,
  probe?: HeaderProbe,
): Promise<{ artefact: SecurityHeadersArtefact; exitCode: number }> {
  const artefact = await runSecurityHeadersCheck({
    root: flags.checkoutDir,
    toolVersion: readOwnVersion(),
    baseUrl: flags.baseUrl ?? undefined,
    paths: flags.paths,
    probe,
  })
  if (flags.jsonPath) {
    writeFileSync(flags.jsonPath, JSON.stringify(artefact, null, 2) + '\n', 'utf8')
  }
  if (flags.json) {
    console.log(JSON.stringify(artefact, null, 2))
  } else {
    console.log(formatSecurityHeadersSummary(artefact))
  }
  return { artefact, exitCode: artefact.exitCode }
}
