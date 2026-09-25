import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  AUDIT_CACHE_MAX_AGE_MS,
  acceptanceLine,
  auditExitCode,
  formatAuditReport,
  parseAuditOutput,
  runAudit,
  runPnpmAudit,
  type AuditRunner,
} from '../src/audit.js'
import { parseAuditArgs, runAuditCommand } from '../src/commands/audit.js'

const tempDirs: string[] = []
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
  vi.restoreAllMocks()
})

const NOW = new Date('2026-09-25T12:00:00.000Z')

/** One advisory in `pnpm audit --json`'s shape (pnpm 10). */
function advisory(
  id: number,
  ghsa: string,
  severity: string,
  module: string,
  patched: string,
): Record<string, unknown> {
  return {
    findings: [{ paths: [`.>${module}`, `.>parent>${module}`], version: '1.0.0' }],
    github_advisory_id: ghsa,
    id,
    module_name: module,
    patched_versions: patched,
    severity,
    title: `${module} is vulnerable`,
    url: `https://github.com/advisories/${ghsa}`,
  }
}

function auditOutput(...advisories: Array<Record<string, unknown>>): unknown {
  return {
    actions: [],
    advisories: Object.fromEntries(advisories.map((entry) => [String(entry.id), entry])),
    metadata: {},
    muted: [],
  }
}

const UNFIXABLE_HIGH = advisory(1, 'GHSA-aaaa-bbbb-cccc', 'high', 'esbuild', '<0.0.0')
const FIXABLE_CRITICAL = advisory(2, 'GHSA-dddd-eeee-ffff', 'critical', 'undici', '>=7.29.1')
const LOW = advisory(3, 'GHSA-gggg-hhhh-iiii', 'low', 'dompurify', '>=3.4.12')
const MODERATE = advisory(4, 'GHSA-jjjj-kkkk-llll', 'moderate', 'fflate', '>=0.4.9')

function makeApp(options: { lockfile?: string; declarations?: unknown } = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'narduk-audit-'))
  tempDirs.push(root)
  writeFileSync(join(root, 'package.json'), '{"name":"fixture"}')
  if (options.lockfile !== undefined) writeFileSync(join(root, 'pnpm-lock.yaml'), options.lockfile)
  if (options.declarations !== undefined) {
    writeFileSync(
      join(root, 'narduk-app.json'),
      JSON.stringify({ security: { acceptedAdvisories: options.declarations } }, null, 2),
    )
  }
  return root
}

function runnerReturning(output: unknown): AuditRunner & { calls: number } {
  const runner = Object.assign(
    () => {
      runner.calls += 1
      return { output }
    },
    { calls: 0 },
  )
  return runner
}

const offline: AuditRunner = () => ({
  error: 'pnpm audit gave no JSON result (ERR_PNPM_AUDIT_BAD_RESPONSE getaddrinfo ENOTFOUND)',
  output: null,
})

describe('doctor --audit (narduk-libs#376)', () => {
  it('goes red on an unfixable high with the paste-ready line, green once pasted, and green offline', () => {
    const root = makeApp({ lockfile: 'lockfileVersion: 9.0\n' })
    const red = runAudit({
      noCache: true,
      now: () => NOW,
      root,
      runner: runnerReturning(auditOutput(UNFIXABLE_HIGH)),
    })
    expect(red.status).toBe('fail')
    expect(auditExitCode(red)).toBe(1)
    const printed = formatAuditReport(red)
    expect(printed.split('\n')[0]).toBe(
      'AUDIT FAIL: 1 high/critical advisory not declared in narduk-app.json',
    )
    expect(printed).toContain('No patched version exists')
    const line = acceptanceLine({
      id: 'GHSA-aaaa-bbbb-cccc',
      module: 'esbuild',
      patchedVersions: null,
      paths: [],
      severity: 'high',
      title: '',
      url: '',
    })
    expect(printed).toContain(line)

    // Paste the printed line, with a real reason, exactly where it says.
    const pasted = JSON.parse(line) as { id: string; reason: string }
    writeFileSync(
      join(root, 'narduk-app.json'),
      JSON.stringify({
        security: { acceptedAdvisories: [{ ...pasted, reason: 'dev server only; no patch' }] },
      }),
    )
    const green = runAudit({
      noCache: true,
      now: () => NOW,
      root,
      runner: runnerReturning(auditOutput(UNFIXABLE_HIGH)),
    })
    expect(green.status).toBe('pass')
    expect(auditExitCode(green)).toBe(0)
    expect(green.accepted.map((entry) => entry.reason)).toEqual(['dev server only; no patch'])

    const down = runAudit({ noCache: true, now: () => NOW, root, runner: offline })
    expect(down.status).toBe('unknown')
    expect(auditExitCode(down)).toBe(0)
    expect(formatAuditReport(down)).toMatch(/^AUDIT UNKNOWN: .*ENOTFOUND.*Not a failure/u)
  })

  it('never fails, warns or asks for a declaration on low or moderate advisories', () => {
    const root = makeApp({ lockfile: 'x' })
    const report = runAudit({
      noCache: true,
      now: () => NOW,
      root,
      runner: runnerReturning(auditOutput(LOW, MODERATE)),
    })
    expect(report.status).toBe('pass')
    expect(report.notes).toEqual([])
    expect(report.summary).toBe(
      'PASS: no undeclared high/critical advisories (0 accepted, 2 low/moderate ignored)',
    )
  })

  it('says the bump is the fix when a patched version exists', () => {
    const root = makeApp({ lockfile: 'x' })
    const report = runAudit({
      noCache: true,
      now: () => NOW,
      root,
      runner: runnerReturning(auditOutput(FIXABLE_CRITICAL)),
    })
    expect(report.status).toBe('fail')
    const printed = formatAuditReport(report)
    expect(printed).toContain('CRITICAL GHSA-dddd-eeee-ffff undici')
    expect(printed).toContain('Patched in >=7.29.1: bump undici (or its parent) -- that is the fix')
    expect(printed).toContain('via .>parent>undici')
  })

  it('notes a declaration that no longer matches anything, without failing', () => {
    const root = makeApp({
      declarations: [{ id: 'GHSA-gone-gone-gone', reason: 'was dev only' }],
      lockfile: 'x',
    })
    const report = runAudit({
      noCache: true,
      now: () => NOW,
      root,
      runner: runnerReturning(auditOutput(LOW)),
    })
    expect(report.status).toBe('pass')
    expect(report.notes).toEqual([
      'GHSA-gone-gone-gone: no longer reported by pnpm audit. Remove this entry',
    ])
  })

  it('warns on an expired declaration but still accepts the advisory', () => {
    const root = makeApp({
      declarations: [{ expiresOn: '2026-09-01', id: 'ghsa-aaaa-bbbb-cccc', reason: 'no patch' }],
      lockfile: 'x',
    })
    const report = runAudit({
      noCache: true,
      now: () => NOW,
      root,
      runner: runnerReturning(auditOutput(UNFIXABLE_HIGH)),
    })
    expect(report.status).toBe('warn')
    expect(auditExitCode(report)).toBe(0)
    expect(report.blocking).toEqual([])
    expect(report.notes[0]).toContain('declaration expired on 2026-09-01')
  })

  it('does not expire a declaration on its own expiry day', () => {
    const root = makeApp({
      declarations: [{ expiresOn: '2026-09-25', id: 'GHSA-aaaa-bbbb-cccc', reason: 'no patch' }],
      lockfile: 'x',
    })
    const report = runAudit({
      noCache: true,
      now: () => NOW,
      root,
      runner: runnerReturning(auditOutput(UNFIXABLE_HIGH)),
    })
    expect(report.status).toBe('pass')
  })

  it('ignores a declaration without an id or reason, and says so as a warning', () => {
    const root = makeApp({
      declarations: [
        { id: 'GHSA-aaaa-bbbb-cccc' },
        { reason: 'no id' },
        { expiresOn: 'soon', id: 'x', reason: 'y' },
      ],
      lockfile: 'x',
    })
    const report = runAudit({
      noCache: true,
      now: () => NOW,
      root,
      runner: runnerReturning(auditOutput(UNFIXABLE_HIGH)),
    })
    expect(report.status).toBe('fail')
    expect(report.notes).toEqual([
      'narduk-app.json security.acceptedAdvisories[0] (GHSA-aaaa-bbbb-cccc) has no "reason"; it is ignored',
      'narduk-app.json security.acceptedAdvisories[1] has no "id"; it is ignored',
      'narduk-app.json security.acceptedAdvisories[2] (x) expiresOn must be YYYY-MM-DD; it is ignored',
    ])
  })

  it('is UNKNOWN, not red, when there is no lockfile to audit', () => {
    const root = makeApp()
    const runner = runnerReturning(auditOutput(UNFIXABLE_HIGH))
    const report = runAudit({ now: () => NOW, root, runner })
    expect(report.status).toBe('unknown')
    expect(report.summary).toContain('no pnpm-lock.yaml')
    expect(runner.calls).toBe(0)
  })

  describe('cache per lockfile hash', () => {
    it('runs pnpm audit once for an unchanged lockfile, again after it changes', () => {
      const root = makeApp({ lockfile: 'one' })
      const runner = runnerReturning(auditOutput(LOW))
      expect(runAudit({ now: () => NOW, root, runner }).cached).toBe(false)
      expect(runAudit({ now: () => NOW, root, runner }).cached).toBe(true)
      expect(runner.calls).toBe(1)

      writeFileSync(join(root, 'pnpm-lock.yaml'), 'two')
      expect(runAudit({ now: () => NOW, root, runner }).cached).toBe(false)
      expect(runner.calls).toBe(2)
    })

    it('runs it again once the cached result is too old, and with --no-cache', () => {
      const root = makeApp({ lockfile: 'one' })
      const runner = runnerReturning(auditOutput(LOW))
      runAudit({ now: () => NOW, root, runner })
      const later = new Date(NOW.getTime() + AUDIT_CACHE_MAX_AGE_MS + 1)
      expect(runAudit({ now: () => later, root, runner }).cached).toBe(false)
      runAudit({ noCache: true, now: () => later, root, runner })
      expect(runner.calls).toBe(3)
    })

    it('never caches an UNKNOWN', () => {
      const root = makeApp({ lockfile: 'one' })
      runAudit({ now: () => NOW, root, runner: offline })
      const runner = runnerReturning(auditOutput(LOW))
      expect(runAudit({ now: () => NOW, root, runner }).cached).toBe(false)
      expect(runner.calls).toBe(1)
    })
  })

  it('parses pnpm audit output by GHSA id and treats <0.0.0 as unpatched', () => {
    expect(parseAuditOutput({ error: { code: 'ENOTFOUND' } })).toBeNull()
    expect(parseAuditOutput(auditOutput(UNFIXABLE_HIGH, FIXABLE_CRITICAL))).toEqual([
      expect.objectContaining({
        id: 'GHSA-aaaa-bbbb-cccc',
        patchedVersions: null,
        severity: 'high',
      }),
      expect.objectContaining({ id: 'GHSA-dddd-eeee-ffff', patchedVersions: '>=7.29.1' }),
    ])
  })

  it('runs pnpm audit without retries and reads its offline error JSON as UNKNOWN', () => {
    const bin = mkdtempSync(join(tmpdir(), 'narduk-audit-bin-'))
    tempDirs.push(bin)
    writeFileSync(
      join(bin, 'pnpm'),
      [
        '#!/bin/sh',
        'echo "$@" > "$(dirname "$0")/args"',
        'echo \'{ "error": { "code": "ENOTFOUND", "message": "getaddrinfo ENOTFOUND" } }\'',
        'exit 1',
      ].join('\n'),
    )
    chmodSync(join(bin, 'pnpm'), 0o755)
    vi.stubEnv('PATH', `${bin}:${process.env.PATH ?? ''}`)
    const root = makeApp({ lockfile: 'x' })

    const run = runPnpmAudit(root)
    expect(run).toEqual({
      error: 'pnpm audit could not reach the registry (ENOTFOUND)',
      output: null,
    })
    expect(readFileSync(join(bin, 'args'), 'utf8').trim()).toBe(
      'audit --json --config.fetch-retries=0',
    )
    vi.unstubAllEnvs()
  })

  it('parses the CLI flags and refuses a checkout with no package.json', () => {
    expect(parseAuditArgs(['--audit', '--checkout', '/x', '--json', '--no-cache'], '/cwd')).toEqual(
      {
        checkoutDir: '/x',
        json: true,
        noCache: true,
      },
    )
    expect(() => parseAuditArgs(['--audit', '--live', 'x'])).toThrow(
      /Unknown doctor --audit option/,
    )
    const empty = mkdtempSync(join(tmpdir(), 'narduk-audit-empty-'))
    tempDirs.push(empty)
    expect(() => runAuditCommand({ checkoutDir: empty, json: false, noCache: true })).toThrow(
      /no package.json/,
    )
  })

  it('exits 1 only for FAIL through the command', () => {
    const root = makeApp({ lockfile: 'x' })
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const run = (runner: AuditRunner) =>
      runAuditCommand({ checkoutDir: root, json: true, noCache: true }, (options) =>
        runAudit({ ...options, now: () => NOW, runner }),
      ).exitCode
    expect(run(runnerReturning(auditOutput(UNFIXABLE_HIGH)))).toBe(1)
    expect(run(offline)).toBe(0)
    expect(run(runnerReturning(auditOutput(LOW)))).toBe(0)
  })
})
