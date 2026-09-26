/**
 * `narduk-app doctor --all` -- one command, one verdict line (narduk-libs#376).
 *
 * It composes the doctor's existing legs and reimplements none of them:
 *   - prerequisites  bare `doctor`'s checks (`runDoctor`);
 *   - adoption       `doctor --adoption`'s fifteen requirements, which already
 *                    run foundation:check, the toolchain, shared-UI, coverage and
 *                    deployment checks, and -- with `--live` -- the security
 *                    header probe and the live build probe (`runAdoptionCheck`);
 *   - audit          `doctor --audit`'s high/critical advisory leg (`runAudit`).
 *
 * WHY A FLAG AND NOT BARE `doctor`. Bare `doctor`'s output and exit code have
 * callers, and whether it should grow the aggregation is an open maintainer
 * call. `--all` is additive: bare `doctor`, `--adoption` and `--audit` all keep
 * their exact behaviour.
 *
 * The verdict line comes first, then each leg's own report unchanged:
 *   DOCTOR FAIL  any leg fails: a prerequisite, an adoption requirement, or an
 *                undeclared high/critical advisory. Exit 1.
 *   DOCTOR WARN  nothing fails, but a prerequisite warns, the adoption report
 *                is UNKNOWN (always, without `--live`) or DEVIATION, or the audit
 *                warns or could not reach the registry. Exit 0.
 *   DOCTOR PASS  every leg passes. Exit 0.
 * An unreachable registry or an undecided requirement never goes red here,
 * matching the legs' own conventions.
 */

import { resolve } from 'node:path'

import { formatAuditReport, runAudit, type AuditReport, type RunAuditOptions } from '../audit.js'
import { formatDoctorReport, runDoctor, type DoctorReport } from '../doctor.js'
import {
  formatAdoptionSummary,
  runAdoptionCheck,
  type AdoptionArtefact,
  type RunAdoptionCheckOptions,
} from '../foundation/evaluate-adoption.js'
import { assertAppCheckout } from './checkout-root.js'
import { readOwnVersion } from './own-version.js'

export interface DoctorAllFlags {
  checkoutDir: string
  /** The commit that should be live, compared against `x-build-version`. */
  expectSha: string | null
  json: boolean
  /** The deployed origin. Without it the adoption leg stays UNKNOWN. */
  liveUrl: string | null
  noCache: boolean
  /** Routes for the security-header probe, beyond the default. */
  paths: string[]
}

export interface DoctorAllLegs {
  adoption: AdoptionArtefact
  audit: AuditReport
  prerequisites: DoctorReport
}

export interface DoctorAllVerdict {
  exitCode: 0 | 1
  /** The one line: `DOCTOR <VERDICT> -- <reason>`. */
  line: string
  verdict: 'PASS' | 'WARN' | 'FAIL'
}

/** Seams for the tests: real runs call the legs themselves. */
export interface DoctorAllRunners {
  adoption: (options: RunAdoptionCheckOptions) => Promise<AdoptionArtefact>
  audit: (options: RunAuditOptions) => AuditReport
  prerequisites: (rootDir: string) => DoctorReport
}

export function parseDoctorAllArgs(args: string[], cwd = process.cwd()): DoctorAllFlags {
  const flags: DoctorAllFlags = {
    checkoutDir: cwd,
    expectSha: null,
    json: false,
    liveUrl: null,
    noCache: false,
    paths: [],
  }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--all') continue
    if (arg === '--checkout') flags.checkoutDir = args[(index += 1)] ?? flags.checkoutDir
    else if (arg === '--live') flags.liveUrl = args[(index += 1)] ?? null
    else if (arg === '--expect-sha') flags.expectSha = args[(index += 1)] ?? null
    else if (arg === '--path') {
      const next = args[(index += 1)]
      if (next) flags.paths.push(next)
    } else if (arg === '--json') flags.json = true
    else if (arg === '--no-cache') flags.noCache = true
    else throw new Error(`Unknown doctor --all option: ${arg}`)
  }
  if (flags.expectSha && !flags.liveUrl) {
    throw new Error('--expect-sha needs --live: there is no origin to compare the commit against')
  }
  return { ...flags, checkoutDir: resolve(flags.checkoutDir) }
}

function namesWith(report: DoctorReport, status: 'warn' | 'fail'): string[] {
  return report.checks.filter((check) => check.status === status).map((check) => check.name)
}

/** The single answer across the three legs. Pure, so every combination is testable. */
export function aggregateDoctorVerdict(legs: DoctorAllLegs): DoctorAllVerdict {
  const { adoption, audit, prerequisites } = legs
  const failing: string[] = []
  const prerequisiteFailures = namesWith(prerequisites, 'fail')
  if (prerequisiteFailures.length > 0) {
    failing.push(`prerequisites: ${prerequisiteFailures.join(', ')}`)
  }
  if (adoption.result === 'FAIL') failing.push(`adoption FAIL (${adoption.score.fail} failing)`)
  if (audit.status === 'fail') failing.push(`audit: ${audit.summary}`)
  if (failing.length > 0) {
    return { exitCode: 1, line: `DOCTOR FAIL -- ${failing.join('; ')}`, verdict: 'FAIL' }
  }

  const warning: string[] = []
  const prerequisiteWarnings = namesWith(prerequisites, 'warn')
  if (prerequisiteWarnings.length > 0) {
    warning.push(`prerequisites: ${prerequisiteWarnings.join(', ')}`)
  }
  if (adoption.result === 'UNKNOWN') {
    warning.push(`adoption UNKNOWN (${adoption.score.unknown} undecided)`)
  } else if (adoption.result === 'DEVIATION') {
    warning.push(`adoption DEVIATION (${adoption.score.deviation} declared)`)
  }
  if (audit.status === 'warn' || audit.status === 'unknown') {
    warning.push(`audit: ${audit.summary}`)
  }
  if (warning.length > 0) {
    return { exitCode: 0, line: `DOCTOR WARN -- ${warning.join('; ')}`, verdict: 'WARN' }
  }
  return {
    exitCode: 0,
    line: 'DOCTOR PASS -- prerequisites, adoption and audit all pass',
    verdict: 'PASS',
  }
}

const DEFAULT_RUNNERS: DoctorAllRunners = {
  adoption: runAdoptionCheck,
  audit: runAudit,
  prerequisites: runDoctor,
}

export async function runDoctorAllCommand(
  flags: DoctorAllFlags,
  runners: DoctorAllRunners = DEFAULT_RUNNERS,
): Promise<DoctorAllVerdict & { legs: DoctorAllLegs }> {
  assertAppCheckout(flags.checkoutDir, 'doctor --all')
  const legs: DoctorAllLegs = {
    prerequisites: runners.prerequisites(flags.checkoutDir),
    adoption: await runners.adoption({
      expectSha: flags.expectSha ?? undefined,
      headerPaths: flags.paths.length > 0 ? flags.paths : undefined,
      liveUrl: flags.liveUrl ?? undefined,
      root: flags.checkoutDir,
      toolVersion: readOwnVersion(),
    }),
    audit: runners.audit({ noCache: flags.noCache, root: flags.checkoutDir }),
  }
  const verdict = aggregateDoctorVerdict(legs)
  if (flags.json) {
    console.log(
      JSON.stringify(
        { verdict: verdict.verdict, line: verdict.line, exitCode: verdict.exitCode, ...legs },
        null,
        2,
      ),
    )
  } else {
    console.log(
      [
        verdict.line,
        '',
        formatDoctorReport(legs.prerequisites),
        '',
        formatAdoptionSummary(legs.adoption),
        '',
        formatAuditReport(legs.audit),
      ].join('\n'),
    )
  }
  return { ...verdict, legs }
}
