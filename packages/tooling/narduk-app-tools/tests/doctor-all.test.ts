import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  aggregateDoctorVerdict,
  parseDoctorAllArgs,
  runDoctorAllCommand,
  type DoctorAllLegs,
} from '../src/commands/doctor-all.js'

import type { AuditReport } from '../src/audit.js'
import type { DoctorReport } from '../src/doctor.js'
import type { AdoptionArtefact } from '../src/foundation/evaluate-adoption.js'

const tempDirs: string[] = []
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
  vi.restoreAllMocks()
})

function prerequisites(...statuses: Array<'pass' | 'warn' | 'fail'>): DoctorReport {
  const checks = statuses.map((status, index) => ({
    ...(status === 'pass' ? {} : { detail: `check ${index} is ${status}` }),
    name: `check-${index}`,
    status,
  }))
  return { checks, clean: checks.every((check) => check.status !== 'fail'), rootDir: '/app' }
}

function adoption(result: AdoptionArtefact['result']): AdoptionArtefact {
  const exitCode = { DEVIATION: 3, FAIL: 1, PASS: 0, UNKNOWN: 2 }[result] as 0 | 1 | 2 | 3
  return {
    app: { commit: 'abc1234', repo: 'narduk-enterprises/example' },
    exitCode,
    live: null,
    manualReview: [],
    requirements: [],
    result,
    standard: { requirements: 15, source: 'company-hq' },
    toolVersion: '0.0.0-test',
    score: {
      deviation: result === 'DEVIATION' ? 1 : 0,
      fail: result === 'FAIL' ? 2 : 0,
      notApplicable: 0,
      pass: 12,
      unknown: result === 'UNKNOWN' ? 3 : 0,
    },
  } as unknown as AdoptionArtefact
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

function legs(
  prereq: DoctorReport,
  adoptionResult: AdoptionArtefact['result'],
  auditStatus: AuditReport['status'],
): DoctorAllLegs {
  return { adoption: adoption(adoptionResult), audit: audit(auditStatus), prerequisites: prereq }
}

describe('doctor --all verdict (narduk-libs#376)', () => {
  it('is PASS, exit 0, only when every leg passes', () => {
    const verdict = aggregateDoctorVerdict(legs(prerequisites('pass', 'pass'), 'PASS', 'pass'))
    expect(verdict).toMatchObject({ exitCode: 0, verdict: 'PASS' })
    expect(verdict.line).toBe('DOCTOR PASS -- prerequisites, adoption and audit all pass')
  })

  it.each([
    [
      'a failing prerequisite',
      legs(prerequisites('pass', 'fail'), 'PASS', 'pass'),
      /prerequisites/u,
    ],
    [
      'a failing adoption requirement',
      legs(prerequisites('pass'), 'FAIL', 'pass'),
      /adoption FAIL/u,
    ],
    ['an undeclared high/critical advisory', legs(prerequisites('pass'), 'PASS', 'fail'), /audit/u],
  ])('is FAIL, exit 1, on %s', (_name, input, reason) => {
    const verdict = aggregateDoctorVerdict(input)
    expect(verdict).toMatchObject({ exitCode: 1, verdict: 'FAIL' })
    expect(verdict.line).toMatch(/^DOCTOR FAIL -- /u)
    expect(verdict.line).toMatch(reason)
  })

  it.each([
    [
      'a warning prerequisite',
      legs(prerequisites('pass', 'warn'), 'PASS', 'pass'),
      /prerequisites/u,
    ],
    [
      'an undecided adoption report (no --live)',
      legs(prerequisites('pass'), 'UNKNOWN', 'pass'),
      /adoption UNKNOWN/u,
    ],
    [
      'a declared deviation',
      legs(prerequisites('pass'), 'DEVIATION', 'pass'),
      /adoption DEVIATION/u,
    ],
    ['an audit warning', legs(prerequisites('pass'), 'PASS', 'warn'), /audit/u],
    ['an unreachable registry', legs(prerequisites('pass'), 'PASS', 'unknown'), /audit/u],
  ])('is WARN, exit 0, on %s', (_name, input, reason) => {
    const verdict = aggregateDoctorVerdict(input)
    expect(verdict).toMatchObject({ exitCode: 0, verdict: 'WARN' })
    expect(verdict.line).toMatch(/^DOCTOR WARN -- /u)
    expect(verdict.line).toMatch(reason)
  })

  it('names every failing leg, and FAIL wins over WARN', () => {
    const verdict = aggregateDoctorVerdict(legs(prerequisites('fail', 'warn'), 'FAIL', 'unknown'))
    expect(verdict.verdict).toBe('FAIL')
    expect(verdict.line).toContain('prerequisites: check-0')
    expect(verdict.line).toContain('adoption FAIL (2 failing)')
    expect(verdict.line).not.toContain('audit')
  })

  it('parses its flags and refuses the ones it does not know', () => {
    expect(
      parseDoctorAllArgs(
        [
          '--all',
          '--checkout',
          '/app',
          '--live',
          'https://x.test',
          '--path',
          '/a',
          '--json',
          '--no-cache',
        ],
        '/cwd',
      ),
    ).toEqual({
      checkoutDir: '/app',
      expectSha: null,
      json: true,
      liveUrl: 'https://x.test',
      noCache: true,
      paths: ['/a'],
    })
    expect(() => parseDoctorAllArgs(['--all', '--fix'])).toThrow(/Unknown doctor --all option/u)
    expect(() => parseDoctorAllArgs(['--all', '--expect-sha', 'abc'])).toThrow(/--live/u)
  })

  it('composes the existing legs, prints the verdict line first, and exits by it', async () => {
    const root = mkdtempSync(join(tmpdir(), 'narduk-doctor-all-'))
    tempDirs.push(root)
    writeFileSync(join(root, 'package.json'), '{}')
    const printed: string[] = []
    vi.spyOn(console, 'log').mockImplementation((text: string) => printed.push(text))
    const seen: Record<string, unknown> = {}
    const result = await runDoctorAllCommand(
      { checkoutDir: root, expectSha: null, json: false, liveUrl: null, noCache: true, paths: [] },
      {
        adoption: async (options) => {
          seen.adoption = options
          return adoption('UNKNOWN')
        },
        audit: (options) => {
          seen.audit = options
          return audit('fail')
        },
        prerequisites: (dir) => {
          seen.prerequisites = dir
          return prerequisites('pass')
        },
      },
    )
    expect(result.exitCode).toBe(1)
    expect(seen).toMatchObject({
      adoption: { root },
      audit: { noCache: true, root },
      prerequisites: root,
    })
    const output = printed.join('\n').split('\n')
    expect(output[0]).toMatch(/^DOCTOR FAIL -- audit/u)
    expect(output).toContain('AUDIT FAIL audit summary')
    expect(output).toContain('RESULT: UNKNOWN')
    expect(output).toContain(`Doctor report for /app`)
  })

  it('prints one JSON object with the verdict and every leg under --json', async () => {
    const root = mkdtempSync(join(tmpdir(), 'narduk-doctor-all-'))
    tempDirs.push(root)
    writeFileSync(join(root, 'package.json'), '{}')
    const printed: string[] = []
    vi.spyOn(console, 'log').mockImplementation((text: string) => printed.push(text))
    await runDoctorAllCommand(
      { checkoutDir: root, expectSha: null, json: true, liveUrl: null, noCache: false, paths: [] },
      {
        adoption: async () => adoption('PASS'),
        audit: () => audit('pass'),
        prerequisites: () => prerequisites('pass'),
      },
    )
    expect(printed).toHaveLength(1)
    expect(JSON.parse(printed[0]!)).toMatchObject({
      adoption: { result: 'PASS' },
      audit: { status: 'pass' },
      exitCode: 0,
      prerequisites: { clean: true },
      verdict: 'PASS',
    })
  })
})
