/**
 * Bare `narduk-app doctor [--json] [--no-cache]` -- prerequisites plus the
 * dependency audit, with one verdict line first (narduk-libs#376).
 *
 * Logan, 2026-09-26 (askme, verbatim): "Bare = prereqs + audit (Recommended)".
 * `doctor --all` stays the deep report with the adoption leg.
 *
 * The verdict is `aggregateDoctorVerdict` without the adoption leg:
 *   DOCTOR FAIL  a prerequisite fails, or an undeclared high/critical advisory.
 *                Exit 1. Before the audit leg, only a failing prerequisite
 *                exited 1; the advisory is the one new way to fail.
 *   DOCTOR WARN  a prerequisite warns, or the audit warns or is offline. Exit 0.
 *   DOCTOR PASS  both legs pass. Exit 0.
 *
 * `--json` keeps the prerequisite report's own fields (`checks`, `clean`,
 * `rootDir`) at the top level and adds `verdict`, `line`, `exitCode` and
 * `audit`, so a caller that read the old shape still finds it.
 *
 * The audit runs at the nearest directory holding `pnpm-lock.yaml`, walking up
 * from where `doctor` runs but never out of its git repository: a generated
 * app's `pnpm run doctor` runs in `apps/web`, while its lockfile and
 * `narduk-app.json` live at the repository root.
 *
 * Bare `doctor` never refused a directory, so this does not assert an app
 * checkout: outside one, the prerequisites fail on `package.json` as before
 * and the audit reads UNKNOWN (no lockfile).
 */

import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { formatAuditReport, runAudit, type AuditReport, type RunAuditOptions } from '../audit.js'
import { formatDoctorReport, runDoctor, type DoctorReport } from '../doctor.js'
import { aggregateDoctorVerdict, type DoctorAllVerdict } from './doctor-all.js'

export interface BareDoctorFlags {
  json: boolean
  noCache: boolean
  rootDir: string
}

/** Seams for the tests: real runs call the legs themselves. */
export interface BareDoctorRunners {
  audit: (options: RunAuditOptions) => AuditReport
  prerequisites: (rootDir: string) => DoctorReport
}

/** Bare `doctor` has always ignored arguments it does not know; it still does. */
export function parseBareDoctorArgs(args: string[], cwd = process.cwd()): BareDoctorFlags {
  return {
    json: args.includes('--json'),
    noCache: args.includes('--no-cache'),
    rootDir: resolve(cwd),
  }
}

/** The nearest directory at or above `startDir` with a lockfile, inside the same git repository. */
export function findAuditRoot(startDir: string): string {
  let directory = resolve(startDir)
  for (;;) {
    if (existsSync(join(directory, 'pnpm-lock.yaml'))) return directory
    const parent = dirname(directory)
    if (parent === directory || existsSync(join(directory, '.git'))) return resolve(startDir)
    directory = parent
  }
}

const DEFAULT_RUNNERS: BareDoctorRunners = { audit: runAudit, prerequisites: runDoctor }

export function runBareDoctorCommand(
  flags: BareDoctorFlags,
  runners: BareDoctorRunners = DEFAULT_RUNNERS,
): DoctorAllVerdict & { audit: AuditReport; prerequisites: DoctorReport } {
  const prerequisites = runners.prerequisites(flags.rootDir)
  const audit = runners.audit({ noCache: flags.noCache, root: findAuditRoot(flags.rootDir) })
  const verdict = aggregateDoctorVerdict({ audit, prerequisites })
  if (flags.json) {
    console.log(
      JSON.stringify(
        {
          ...prerequisites,
          verdict: verdict.verdict,
          line: verdict.line,
          exitCode: verdict.exitCode,
          audit,
        },
        null,
        2,
      ),
    )
  } else {
    console.log(
      [verdict.line, '', formatDoctorReport(prerequisites), '', formatAuditReport(audit)].join(
        '\n',
      ),
    )
  }
  return { ...verdict, audit, prerequisites }
}
