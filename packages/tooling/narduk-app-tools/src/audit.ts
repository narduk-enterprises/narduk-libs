/**
 * `narduk-app doctor --audit` -- the doctor's dependency-audit leg
 * (narduk-libs#376). The rules are Logan's, 2026-09-17: "its very clear HOW a
 * narduk-app declares this and make sure its easy to do and fast and ... will
 * never get in our way".
 *
 * - Only high and critical advisories count. Low and moderate never fail,
 *   never warn and never need a declaration.
 * - An app accepts one in one place, one line: `narduk-app.json`
 *   `security.acceptedAdvisories[]`, `{ "id": "GHSA-…", "reason": "…" }`, with
 *   an optional `expiresOn` (YYYY-MM-DD).
 * - A failure prints the line to paste, and the patched version when one
 *   exists, because then the bump is the right move.
 * - It never gets in the way: an audit that cannot run (registry or network
 *   down, no lockfile) is UNKNOWN and exits 0. A declaration that no longer
 *   matches anything is a "remove this entry" note, and an expired one is a
 *   warning. Neither fails.
 * - One `pnpm audit --json` call, cached per lockfile hash.
 */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const NARDUK_APP_FILE = 'narduk-app.json'
const LOCKFILE = 'pnpm-lock.yaml'
const BLOCKING = new Set(['critical', 'high'])
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/u
/** npm's spelling for "no version fixes this". */
const UNPATCHED = '<0.0.0'
/**
 * A cached result is reused only while the lockfile is unchanged AND it is
 * this fresh: advisories are published against versions an app already has,
 * so a lockfile hash alone would keep an old "pass" forever.
 */
export const AUDIT_CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000

export type AuditStatus = 'pass' | 'warn' | 'fail' | 'unknown'

export interface AcceptedAdvisory {
  id: string
  reason: string
  expiresOn?: string
}

export interface AuditAdvisory {
  /** The GHSA id -- the id a declaration names. */
  id: string
  severity: string
  module: string
  title: string
  url: string
  /** `null` when no version fixes it. */
  patchedVersions: string | null
  /** Up to three dependency paths, as pnpm prints them. */
  paths: string[]
}

export interface AuditReport {
  status: AuditStatus
  /** The one-line verdict. */
  summary: string
  /** High/critical advisories with no declaration: these fail. */
  blocking: AuditAdvisory[]
  /** High/critical advisories covered by a current declaration. */
  accepted: Array<AuditAdvisory & { reason: string }>
  /** Everything else worth a line: stale or expired declarations, bad entries. */
  notes: string[]
  /** Whether the audit result came from the lockfile-hash cache. */
  cached: boolean
}

interface Declarations {
  entries: AcceptedAdvisory[]
  problems: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Read `narduk-app.json` `security.acceptedAdvisories`. A missing file is no declarations. */
export function readAcceptedAdvisories(root: string): Declarations {
  const path = join(root, NARDUK_APP_FILE)
  if (!existsSync(path)) return { entries: [], problems: [] }
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    return {
      entries: [],
      problems: [`${NARDUK_APP_FILE} is not valid JSON (${(error as Error).message})`],
    }
  }
  const list =
    isRecord(parsed) && isRecord(parsed.security) ? parsed.security.acceptedAdvisories : []
  if (list === undefined) return { entries: [], problems: [] }
  if (!Array.isArray(list)) {
    return {
      entries: [],
      problems: [`${NARDUK_APP_FILE} security.acceptedAdvisories is not an array`],
    }
  }
  const entries: AcceptedAdvisory[] = []
  const problems: string[] = []
  for (const [index, entry] of (list as unknown[]).entries()) {
    const where = `${NARDUK_APP_FILE} security.acceptedAdvisories[${index}]`
    if (!isRecord(entry) || typeof entry.id !== 'string' || entry.id.trim() === '') {
      problems.push(`${where} has no "id"; it is ignored`)
      continue
    }
    if (typeof entry.reason !== 'string' || entry.reason.trim() === '') {
      problems.push(`${where} (${entry.id}) has no "reason"; it is ignored`)
      continue
    }
    if (
      entry.expiresOn !== undefined &&
      (typeof entry.expiresOn !== 'string' || !DATE_RE.test(entry.expiresOn))
    ) {
      problems.push(`${where} (${entry.id}) expiresOn must be YYYY-MM-DD; it is ignored`)
      continue
    }
    entries.push({
      id: entry.id.trim(),
      reason: entry.reason,
      ...(entry.expiresOn === undefined ? {} : { expiresOn: entry.expiresOn }),
    })
  }
  return { entries, problems }
}

/** The advisories in `pnpm audit --json` output, or `null` when it is not an audit result. */
export function parseAuditOutput(output: unknown): AuditAdvisory[] | null {
  if (!isRecord(output) || !isRecord(output.advisories)) return null
  const byId = new Map<string, AuditAdvisory>()
  for (const raw of Object.values(output.advisories)) {
    if (!isRecord(raw)) continue
    const id =
      typeof raw.github_advisory_id === 'string' && raw.github_advisory_id !== ''
        ? raw.github_advisory_id
        : String(raw.id ?? '')
    if (id === '' || byId.has(id)) continue
    const patched = typeof raw.patched_versions === 'string' ? raw.patched_versions : ''
    const findings = Array.isArray(raw.findings) ? raw.findings : []
    const paths = findings
      .flatMap((finding: unknown) =>
        isRecord(finding) && Array.isArray(finding.paths) ? (finding.paths as unknown[]) : [],
      )
      .filter((path): path is string => typeof path === 'string')
    byId.set(id, {
      id,
      module: typeof raw.module_name === 'string' ? raw.module_name : 'unknown',
      patchedVersions: patched === '' || patched === UNPATCHED ? null : patched,
      paths: [...new Set(paths)].slice(0, 3),
      severity: typeof raw.severity === 'string' ? raw.severity : 'unknown',
      title: typeof raw.title === 'string' ? raw.title : '',
      url: typeof raw.url === 'string' ? raw.url : '',
    })
  }
  return [...byId.values()]
}

/** The line to paste into `security.acceptedAdvisories`. */
export function acceptanceLine(advisory: AuditAdvisory): string {
  return `{ "id": ${JSON.stringify(advisory.id)}, "reason": "why this is acceptable for this app" }`
}

function sameId(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

/** Decide the verdict from parsed advisories and the app's declarations. Pure. */
export function evaluateAudit(
  advisories: AuditAdvisory[] | null,
  declarations: Declarations,
  today: string,
  unknownReason = 'pnpm audit produced no result',
): Omit<AuditReport, 'cached'> {
  const notes = [...declarations.problems]
  if (advisories === null) {
    return {
      accepted: [],
      blocking: [],
      notes,
      status: 'unknown',
      summary: `UNKNOWN: ${unknownReason}. Not a failure; run it again when the registry is reachable.`,
    }
  }
  // An expired declaration still accepts its advisory: expiry is a reminder
  // to look again, never a failure.
  let expired = false
  const blocking: AuditAdvisory[] = []
  const accepted: AuditReport['accepted'] = []
  for (const advisory of advisories.filter((entry) => BLOCKING.has(entry.severity))) {
    const declared = declarations.entries.find((entry) => sameId(entry.id, advisory.id))
    if (!declared) {
      blocking.push(advisory)
      continue
    }
    accepted.push({ ...advisory, reason: declared.reason })
    if (declared.expiresOn !== undefined && declared.expiresOn < today) {
      expired = true
      notes.push(
        `${declared.id}: declaration expired on ${declared.expiresOn}. Check it again, then move or remove "expiresOn"`,
      )
    }
  }
  const present = new Set(advisories.map((advisory) => advisory.id.toLowerCase()))
  for (const entry of declarations.entries) {
    if (!present.has(entry.id.toLowerCase())) {
      notes.push(`${entry.id}: no longer reported by pnpm audit. Remove this entry`)
    }
  }
  const status: AuditStatus =
    blocking.length > 0 ? 'fail' : expired || declarations.problems.length > 0 ? 'warn' : 'pass'
  const others = advisories.length - blocking.length - accepted.length
  const summary =
    status === 'fail'
      ? `FAIL: ${blocking.length} high/critical advisor${blocking.length === 1 ? 'y' : 'ies'} not declared in ${NARDUK_APP_FILE}`
      : `${status.toUpperCase()}: no undeclared high/critical advisories (${accepted.length} accepted, ${others} low/moderate ignored)`
  return { accepted, blocking, notes, status, summary }
}

export interface AuditRunResult {
  /** Parsed `pnpm audit --json` output, or `null` when it did not produce one. */
  output: unknown
  /** Why there is no output, when there is none. */
  error?: string
}

export type AuditRunner = (root: string) => AuditRunResult

/** One `pnpm audit --json`. A non-zero exit is normal: pnpm exits 1 when it finds anything. */
export const runPnpmAudit: AuditRunner = (root) => {
  // No fetch retries: offline, pnpm's default retries take about a minute to
  // give up, and a registry that does not answer is an UNKNOWN, not a wait.
  const result = spawnSync('pnpm', ['audit', '--json', '--config.fetch-retries=0'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: 30_000,
  })
  if (result.error) {
    return { error: `pnpm audit did not run (${result.error.message})`, output: null }
  }
  let output: unknown
  try {
    output = JSON.parse(result.stdout)
  } catch {
    const reason = (result.stderr || result.stdout).trim().split('\n')[0] ?? ''
    return { error: `pnpm audit gave no JSON result${reason ? ` (${reason})` : ''}`, output: null }
  }
  // Offline, pnpm still prints JSON: `{ "error": { "code", "message" } }`.
  if (isRecord(output) && isRecord(output.error)) {
    const { code, message } = output.error
    return {
      error: `pnpm audit could not reach the registry (${String(code ?? message ?? 'error')})`,
      output: null,
    }
  }
  return { output }
}

export interface RunAuditOptions {
  root: string
  runner?: AuditRunner
  now?: () => Date
  /** Skip the cache in both directions. */
  noCache?: boolean
}

function cachePath(root: string, lockHash: string): string {
  return join(root, 'node_modules', '.cache', 'narduk-app', `audit-${lockHash}.json`)
}

function readCache(path: string, now: Date): unknown {
  try {
    const entry = JSON.parse(readFileSync(path, 'utf8')) as { at?: number; output?: unknown }
    if (typeof entry.at !== 'number' || now.getTime() - entry.at > AUDIT_CACHE_MAX_AGE_MS)
      return null
    return entry.output ?? null
  } catch {
    return null
  }
}

function writeCache(path: string, now: Date, output: unknown): void {
  try {
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, JSON.stringify({ at: now.getTime(), output }), 'utf8')
  } catch {
    // A read-only or missing node_modules only costs the next run a fresh audit.
  }
}

/** Run the audit leg against a checkout root (where `pnpm-lock.yaml` lives). */
export function runAudit(options: RunAuditOptions): AuditReport {
  const now = (options.now ?? (() => new Date()))()
  const today = now.toISOString().slice(0, 10)
  const declarations = readAcceptedAdvisories(options.root)
  const lockPath = join(options.root, LOCKFILE)
  if (!existsSync(lockPath)) {
    return {
      ...evaluateAudit(
        null,
        declarations,
        today,
        `no ${LOCKFILE} in ${options.root}, so there is nothing to audit`,
      ),
      cached: false,
    }
  }
  const lockHash = createHash('sha256').update(readFileSync(lockPath)).digest('hex').slice(0, 16)
  const cacheFile = cachePath(options.root, lockHash)
  const fromCache = options.noCache ? null : readCache(cacheFile, now)
  if (fromCache !== null) {
    const advisories = parseAuditOutput(fromCache)
    if (advisories !== null)
      return { ...evaluateAudit(advisories, declarations, today), cached: true }
  }
  const run = (options.runner ?? runPnpmAudit)(options.root)
  const advisories = parseAuditOutput(run.output)
  if (advisories !== null && !options.noCache) writeCache(cacheFile, now, run.output)
  return {
    ...evaluateAudit(
      advisories,
      declarations,
      today,
      run.error ?? 'pnpm audit returned no advisories object',
    ),
    cached: false,
  }
}

/** The verdict line first, then what to do about each finding. */
export function formatAuditReport(report: AuditReport): string {
  const lines = [`AUDIT ${report.summary}${report.cached ? ' [cached]' : ''}`]
  for (const advisory of report.blocking) {
    lines.push(
      '',
      `  ${advisory.severity.toUpperCase()} ${advisory.id} ${advisory.module}: ${advisory.title}`,
      ...(advisory.url ? [`    ${advisory.url}`] : []),
      ...advisory.paths.map((path) => `    via ${path}`),
      advisory.patchedVersions === null
        ? '    No patched version exists. If this app can live with it, add this line to'
        : `    Patched in ${advisory.patchedVersions}: bump ${advisory.module} (or its parent) -- that is the fix. Only if you cannot, add this line to`,
      `    ${NARDUK_APP_FILE} "security": { "acceptedAdvisories": [ ... ] } and say why:`,
      `    ${acceptanceLine(advisory)}`,
    )
  }
  for (const advisory of report.accepted) {
    lines.push(
      `  accepted ${advisory.severity} ${advisory.id} ${advisory.module}: ${advisory.reason}`,
    )
  }
  for (const note of report.notes) lines.push(`  note: ${note}`)
  return lines.join('\n')
}

/** Exit code for this leg: only a FAIL is non-zero, so an unreachable registry never goes red. */
export function auditExitCode(report: AuditReport): number {
  return report.status === 'fail' ? 1 : 0
}
