import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  findAuditRoot,
  parseBareDoctorArgs,
  runBareDoctorCommand,
  type BareDoctorRunners,
} from '../src/commands/doctor-bare.js'

import type { AuditReport, RunAuditOptions } from '../src/audit.js'
import type { DoctorReport } from '../src/doctor.js'

const tempDirs: string[] = []
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
  vi.restoreAllMocks()
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'narduk-bare-doctor-'))
  tempDirs.push(dir)
  return dir
}

function prerequisites(...statuses: Array<'pass' | 'warn' | 'fail'>): DoctorReport {
  const checks = statuses.map((status, index) => ({
    ...(status === 'pass' ? {} : { detail: `check ${index} is ${status}` }),
    name: `check-${index}`,
    status,
  }))
  return { checks, clean: checks.every((check) => check.status !== 'fail'), rootDir: '/app' }
}

function audit(status: AuditReport['status']): AuditReport {
  return {
    accepted: [],
    blocking: [],
    cached: false,
    notes: [],
    status,
    summary: `${status.toUpperCase()} audit summary`,
  }
}

function runners(
  prereq: DoctorReport,
  auditStatus: AuditReport['status'],
  seen: RunAuditOptions[] = [],
): BareDoctorRunners {
  return {
    audit: (options) => {
      seen.push(options)
      return audit(auditStatus)
    },
    prerequisites: () => prereq,
  }
}

function run(prereq: DoctorReport, auditStatus: AuditReport['status'], json = false) {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  const result = runBareDoctorCommand(
    { json, noCache: false, rootDir: '/app' },
    runners(prereq, auditStatus),
  )
  return { output: log.mock.calls.map((call) => String(call[0])).join('\n'), result }
}

describe('bare doctor: prerequisites + audit, one verdict (narduk-libs#376)', () => {
  it('is PASS, exit 0, when both legs pass, and prints the verdict line first', () => {
    const { output, result } = run(prerequisites('pass', 'pass'), 'pass')
    expect(result).toMatchObject({ exitCode: 0, verdict: 'PASS' })
    expect(output.split('\n')[0]).toBe('DOCTOR PASS -- prerequisites and audit pass')
    expect(output).toContain('Doctor report for /app')
    expect(output).toContain('PASS audit summary')
  })

  it('fails, exit 1, on an undeclared high/critical advisory: the one new failure mode', () => {
    const { result } = run(prerequisites('pass', 'warn'), 'fail')
    expect(result).toMatchObject({ exitCode: 1, verdict: 'FAIL' })
    expect(result.line).toBe('DOCTOR FAIL -- audit: FAIL audit summary')
  })

  it('still fails, exit 1, on a failing prerequisite, as it did before', () => {
    const { result } = run(prerequisites('fail', 'pass'), 'pass')
    expect(result).toMatchObject({ exitCode: 1, verdict: 'FAIL' })
    expect(result.line).toBe('DOCTOR FAIL -- prerequisites: check-0')
  })

  it('warns, exit 0, on a prerequisite warning or an offline audit, and never names adoption', () => {
    for (const [prereq, auditStatus] of [
      [prerequisites('warn'), 'pass'],
      [prerequisites('pass'), 'unknown'],
      [prerequisites('pass'), 'warn'],
    ] as const) {
      const { result } = run(prereq, auditStatus)
      expect(result).toMatchObject({ exitCode: 0, verdict: 'WARN' })
      expect(result.line).not.toContain('adoption')
    }
  })

  it('keeps the old JSON fields at the top level and adds the verdict and audit', () => {
    const { output } = run(prerequisites('pass', 'warn'), 'pass', true)
    const parsed = JSON.parse(output)
    expect(parsed).toMatchObject({
      checks: expect.any(Array),
      clean: true,
      rootDir: '/app',
      verdict: 'WARN',
      exitCode: 0,
      audit: { status: 'pass' },
    })
    expect(parsed.line).toBe('DOCTOR WARN -- prerequisites: check-1')
  })

  it('parses only --json and --no-cache and ignores anything else, as before', () => {
    expect(parseBareDoctorArgs(['--json', '--stray'], '/x')).toEqual({
      json: true,
      noCache: false,
      rootDir: '/x',
    })
    expect(parseBareDoctorArgs(['--no-cache'], '/x').noCache).toBe(true)
  })
})

describe('findAuditRoot', () => {
  it('walks up from apps/web to the lockfile at the repository root', () => {
    const repo = tempDir()
    mkdirSync(join(repo, '.git'))
    writeFileSync(join(repo, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n')
    const web = join(repo, 'apps', 'web')
    mkdirSync(web, { recursive: true })
    expect(findAuditRoot(web)).toBe(repo)
    expect(findAuditRoot(repo)).toBe(repo)
  })

  it('never leaves the git repository for a lockfile above it', () => {
    const outer = tempDir()
    writeFileSync(join(outer, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n')
    const repo = join(outer, 'app')
    mkdirSync(join(repo, '.git'), { recursive: true })
    const web = join(repo, 'apps', 'web')
    mkdirSync(web, { recursive: true })
    expect(findAuditRoot(web)).toBe(web)
  })

  it('runs the audit at the lockfile root, not the directory doctor ran in', () => {
    const repo = tempDir()
    mkdirSync(join(repo, '.git'))
    writeFileSync(join(repo, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n')
    const web = join(repo, 'apps', 'web')
    mkdirSync(web, { recursive: true })
    const seen: RunAuditOptions[] = []
    vi.spyOn(console, 'log').mockImplementation(() => {})
    runBareDoctorCommand(
      { json: false, noCache: true, rootDir: web },
      runners(prerequisites('pass'), 'pass', seen),
    )
    expect(seen).toEqual([{ noCache: true, root: repo }])
  })
})
