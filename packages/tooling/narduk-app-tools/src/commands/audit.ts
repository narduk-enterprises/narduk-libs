/**
 * `narduk-app doctor --audit [--checkout <dir>] [--json] [--no-cache]` -- the
 * doctor's dependency-audit leg (narduk-libs#376). A flag on `doctor`, like
 * `--adoption`, so bare `doctor` keeps its exact output and exit code.
 *
 * Exit codes: 0 for PASS, WARN and UNKNOWN (an unreachable registry never goes
 * red), 1 for FAIL.
 */

import { resolve } from 'node:path'

import { auditExitCode, formatAuditReport, runAudit, type AuditReport } from '../audit.js'
import { assertAppCheckout } from './checkout-root.js'

export interface AuditFlags {
  checkoutDir: string
  json: boolean
  noCache: boolean
}

export function parseAuditArgs(args: string[], cwd = process.cwd()): AuditFlags {
  const flags: AuditFlags = { checkoutDir: cwd, json: false, noCache: false }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--audit') continue
    if (arg === '--checkout') flags.checkoutDir = args[(index += 1)] ?? flags.checkoutDir
    else if (arg === '--json') flags.json = true
    else if (arg === '--no-cache') flags.noCache = true
    else throw new Error(`Unknown doctor --audit option: ${arg}`)
  }
  return { ...flags, checkoutDir: resolve(flags.checkoutDir) }
}

export function runAuditCommand(
  flags: AuditFlags,
  run: (options: { root: string; noCache: boolean }) => AuditReport = runAudit,
): { exitCode: number; report: AuditReport } {
  assertAppCheckout(flags.checkoutDir, 'doctor --audit')
  const report = run({ noCache: flags.noCache, root: flags.checkoutDir })
  console.log(flags.json ? JSON.stringify(report, null, 2) : formatAuditReport(report))
  return { exitCode: auditExitCode(report), report }
}
