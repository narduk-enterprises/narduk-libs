/**
 * The six-check Narduk app status (D-NAC-STATUS-1, narduk-libs#1409).
 *
 * The standard (agent-infrastructure `docs/standards/NARDUK-APP-COMPLIANCE.md`)
 * is six checks the checker can answer, in two groups:
 *
 *   (a) Is a Narduk app -- structural:  platform, delivery, security, health.
 *   (b) Is up to date   -- currency:    packages, freshness.
 *
 * THIS COMPOSES THE R1..R15 REQUIREMENTS, IT DOES NOT RE-DECIDE THEM. Each check
 * rolls up the requirements `NAC_CHECKS` names, so the two views of one run can
 * never disagree about a fact. Two things are new here and decided from
 * evidence this module gathers: the Dependabot alert read behind `security`,
 * and the `waivers` read from `Config/cloudflare-app.json`.
 *
 * ADDITIVE ON PURPOSE. The artefact keeps `schemaVersion: 1` and every R* field
 * where it already was, because the portal's adoption ingest refuses any other
 * `schemaVersion` and reads `requirements` from the top level
 * (operator-portal#1635). The new fields are `checks`, `status`, `upToDate`,
 * `blocking`, `waivers`, `dependabot` and `freshness`; a reader tells a new
 * report from an old one by the presence of `checks`. R* leaves one minor after
 * this one.
 *
 * HONESTY.
 *  - A check the checker cannot decide is `unknown` with a reason, never a pass.
 *  - The Dependabot read needs "Dependabot alerts: read". A run whose token
 *    lacks it answers `unknown` and names the permission. Nothing here widens a
 *    token or asks for a different one.
 *  - A waiver names a check, an issue and an expiry. It needs no sign-off, never
 *    covers delivery or security, and stops counting the day after `expires`.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const NAC_STATUS_DECISION = 'D-NAC-STATUS-1'
export const NAC_STATUS_SCHEMA_VERSION = 1
/** A report older than this stops counting as fresh. The portal measures the
 * age; the checker names the bound so the two always agree. */
export const FRESHNESS_MAX_AGE_DAYS = 14

export const NAC_CHECK_IDS = [
  'platform',
  'delivery',
  'security',
  'health',
  'packages',
  'freshness',
] as const
export type NacCheckId = (typeof NAC_CHECK_IDS)[number]

export type NacGroup = 'structural' | 'currency'

/** Delivery and security are what make an app a Narduk app safely; a waiver on
 * either would let an app opt out of the point of the status. */
export const UNWAIVABLE_CHECKS: readonly NacCheckId[] = ['delivery', 'security']

/** The verdict a check reports. `waived` only ever appears here, never on a
 * requirement: it means "failing or undecided, but covered by a live waiver". */
export type NacVerdict = 'pass' | 'fail' | 'unknown' | 'waived'
export type NacMeasured = 'pass' | 'fail' | 'unknown'

/** The verdicts a requirement can carry, as `evaluate-adoption` defines them.
 * Restated structurally so this module needs no import cycle. */
export type RequirementVerdict = 'pass' | 'fail' | 'unknown' | 'not-applicable' | 'deviation'
export interface RequirementLike {
  id: string
  verdict: RequirementVerdict
  detail: string
  evidence: string[]
}

export interface NacCheckDefinition {
  id: NacCheckId
  number: 1 | 2 | 3 | 4 | 5 | 6
  title: string
  group: NacGroup
  /** The R* requirements whose verdicts this check rolls up. */
  from: readonly string[]
  /** What answers it: a command a reader can re-run, or the evidence read. */
  diagnostics: readonly string[]
}

export const NAC_CHECKS: readonly NacCheckDefinition[] = [
  {
    diagnostics: [
      'narduk-app foundation:check (items 1-9)',
      'narduk-app foundation:check:shared-ui-pinned',
      'narduk-app foundation:check:coverage',
    ],
    from: ['R4', 'R10'],
    group: 'structural',
    id: 'platform',
    number: 1,
    title: 'Built on the platform',
  },
  {
    diagnostics: [
      'narduk-app foundation:check:deployment (12.x)',
      'live x-build-version header against --expect-sha',
    ],
    from: ['R1', 'R5', 'R6', 'R7'],
    group: 'structural',
    id: 'delivery',
    number: 2,
    title: 'Ships the standard way',
  },
  {
    diagnostics: [
      'narduk-app foundation:check:security-headers --live',
      'GET /repos/{repo}/dependabot/alerts?state=open&severity=critical,high',
    ],
    from: ['R8'],
    group: 'structural',
    id: 'security',
    number: 3,
    title: 'Secure',
  },
  {
    diagnostics: ['live health route read (liveProof.healthPath)'],
    from: ['R12'],
    group: 'structural',
    id: 'health',
    number: 4,
    title: 'Healthy',
  },
  {
    diagnostics: [
      'narduk-app doctor --adoption (package table)',
      'narduk-app foundation:check:toolchain',
      'narduk-app doctor --adoption (mapkit provenance)',
    ],
    from: ['R2', 'R3', 'R9'],
    group: 'currency',
    id: 'packages',
    number: 5,
    title: 'Packages current',
  },
  {
    diagnostics: ['this artefact: generated and toolVersion'],
    from: ['R15'],
    group: 'currency',
    id: 'freshness',
    number: 6,
    title: 'Report fresh',
  },
]

/** Requirements the status does not score. R11, R13 and R14 are manual and
 * always UNKNOWN; they say nothing on a status row. Every other R* is the input
 * of exactly one check (`NAC_CHECKS[].from`). */
export const NAC_UNSCORED_REQUIREMENTS: readonly string[] = ['R11', 'R13', 'R14']

// ---------------------------------------------------------------------------
// Waivers
// ---------------------------------------------------------------------------

export type NacWaiverState = 'active' | 'expired' | 'refused' | 'invalid' | 'unneeded'

export interface NacWaiver {
  /** The check as written in the config; may not be one of the six when the
   * entry is `invalid`. */
  check: string
  /** `#123`, `owner/repo#123`, or the issue URL, as the app wrote it. */
  issue: string
  /** `YYYY-MM-DD`, inclusive: the waiver counts through this date (UTC). */
  expires: string
  state: NacWaiverState
  /** Why it is not `active`: the refusal, the expiry or the malformation. */
  reason: string | null
}

export interface NacWaiverRead {
  waivers: NacWaiver[]
}

const ISSUE_PATTERN =
  /^(?:#\d+|[\w.-]+\/[\w.-]+#\d+|https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/\d+)$/u
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u

function isCheckId(value: string): value is NacCheckId {
  return (NAC_CHECK_IDS as readonly string[]).includes(value)
}

function isRealDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** An issue the app wrote as a bare number is the same claim as `#123`. */
function normaliseIssue(value: unknown): string | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return `#${value}`
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (/^\d+$/u.test(trimmed) && Number(trimmed) > 0) return `#${Number(trimmed)}`
  return ISSUE_PATTERN.test(trimmed) ? trimmed : null
}

/**
 * The `waivers` array of `Config/cloudflare-app.json`, parsed but not yet
 * judged: `state` is filled by `applyWaivers`, which knows the check verdicts
 * and the date. A missing or unreadable config has no waivers; a `waivers`
 * value that is not an array is one invalid entry, so a typo cannot silently
 * read as "no waivers".
 */
export function readWaiverConfig(root: string): unknown[] | 'malformed' {
  let raw: string
  try {
    raw = readFileSync(join(root, 'Config', 'cloudflare-app.json'), 'utf8')
  } catch {
    return []
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!isRecord(parsed) || !('waivers' in parsed)) return []
  return Array.isArray(parsed.waivers) ? parsed.waivers : 'malformed'
}

/**
 * Judge every declared waiver against the measured verdicts and the report
 * date. Order matters and is deliberate: an unknown check or a malformed field
 * is `invalid`; delivery and security are `refused` whatever their date; then
 * an `expires` before today is `expired`; a waiver on a check that already
 * passes is `unneeded` (it must not turn a pass into the weaker "waived");
 * anything else is `active`.
 */
export function judgeWaivers(
  entries: unknown[] | 'malformed',
  measured: Record<NacCheckId, NacMeasured>,
  generated: string,
): NacWaiver[] {
  if (entries === 'malformed') {
    return [
      {
        check: '',
        expires: '',
        issue: '',
        reason:
          '"waivers" in Config/cloudflare-app.json must be an array of {check, issue, expires}',
        state: 'invalid',
      },
    ]
  }
  const today = generated.slice(0, 10)
  return entries.map((entry): NacWaiver => {
    const record = isRecord(entry) ? entry : {}
    const check = typeof record.check === 'string' ? record.check.trim() : ''
    const issue = normaliseIssue(record.issue)
    const expires = typeof record.expires === 'string' ? record.expires.trim() : ''
    const written = { check, expires, issue: issue ?? String(record.issue ?? '') }
    const invalid = (reason: string): NacWaiver => ({ ...written, reason, state: 'invalid' })

    if (!isCheckId(check)) {
      return invalid(`"check" must be one of ${NAC_CHECK_IDS.join(', ')}`)
    }
    if (issue === null) return invalid('"issue" must name a GitHub issue such as #123')
    if (!isRealDate(expires)) return invalid('"expires" must be a real date, YYYY-MM-DD')
    if (UNWAIVABLE_CHECKS.includes(check)) {
      return {
        ...written,
        issue,
        reason: `${check} cannot be waived (${NAC_STATUS_DECISION}); fix the check`,
        state: 'refused',
      }
    }
    if (expires < today) {
      return {
        ...written,
        issue,
        reason: `expired ${expires}; the check reads its real verdict`,
        state: 'expired',
      }
    }
    if (measured[check] === 'pass') {
      return { ...written, issue, reason: 'the check passes without it', state: 'unneeded' }
    }
    return { ...written, issue, reason: null, state: 'active' }
  })
}

// ---------------------------------------------------------------------------
// Dependabot (the new half of `security`)
// ---------------------------------------------------------------------------

export interface DependabotAlertRow {
  severity: string
  /** null when no patched release exists: not fixable, so it does not count. */
  firstPatchedVersion: string | null
  packageName: string | null
}

export type DependabotRead =
  { kind: 'read'; alerts: DependabotAlertRow[] } | { kind: 'unknown'; reason: string }

export interface DependabotReality {
  read(repo: string): Promise<DependabotRead>
}

export interface NacDependabotReading {
  read: 'ok' | 'unknown'
  /** Why it could not be read; null when it was. */
  reason: string | null
  /** Open alerts of severity critical or high that have a patched release. */
  fixableCritical: number | null
  fixableHigh: number | null
}

const DEPENDABOT_PAGE_SIZE = 100
const DEPENDABOT_MAX_PAGES = 10
const DEPENDABOT_MISSING_PERMISSION =
  'needs "Dependabot alerts: read" (fine-grained token) or security_events (classic); this run was not given it and the checker does not widen a token'

export interface GithubDependabotOptions {
  /** Defaults to `GH_TOKEN`, then `GITHUB_TOKEN`. Never logged or returned. */
  token?: string
  fetchImpl?: typeof fetch
  apiUrl?: string
}

function clip(text: string, length = 160): string {
  const flat = text.replaceAll(/\s+/gu, ' ').trim()
  return flat.length > length ? `${flat.slice(0, length - 1)}…` : flat
}

function parseAlertRows(body: unknown): DependabotAlertRow[] | null {
  if (!Array.isArray(body)) return null
  return body.filter(isRecord).map((alert) => {
    const vulnerability = isRecord(alert.security_vulnerability) ? alert.security_vulnerability : {}
    const advisory = isRecord(alert.security_advisory) ? alert.security_advisory : {}
    const patched = isRecord(vulnerability.first_patched_version)
      ? vulnerability.first_patched_version.identifier
      : null
    const pkg = isRecord(vulnerability.package) ? vulnerability.package.name : null
    const severity = vulnerability.severity ?? advisory.severity
    return {
      firstPatchedVersion: typeof patched === 'string' && patched !== '' ? patched : null,
      packageName: typeof pkg === 'string' ? pkg : null,
      severity: typeof severity === 'string' ? severity.toLowerCase() : 'unknown',
    }
  })
}

/**
 * The real reader: GitHub's REST Dependabot alerts list for the app repository.
 * Every non-200 answer becomes `unknown` with the reason, because the token an
 * Actions run holds is routinely refused here (403 "Resource not accessible by
 * integration") and that must read as "could not tell", not as a clean bill.
 */
export function createGithubDependabotReality(
  options: GithubDependabotOptions = {},
): DependabotReality {
  return {
    async read(repo) {
      const token = options.token ?? process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN
      if (!/^[\w.-]+\/[\w.-]+$/u.test(repo) || repo === 'unknown/unknown') {
        return {
          kind: 'unknown',
          reason: 'the app repository is not known (set product.repository or GITHUB_REPOSITORY)',
        }
      }
      if (!token) {
        return {
          kind: 'unknown',
          reason: `no GitHub token in the environment (GH_TOKEN or GITHUB_TOKEN); reading alerts ${DEPENDABOT_MISSING_PERMISSION}`,
        }
      }
      const doFetch = options.fetchImpl ?? fetch
      const base = options.apiUrl ?? 'https://api.github.com'
      const alerts: DependabotAlertRow[] = []
      for (let page = 1; page <= DEPENDABOT_MAX_PAGES; page += 1) {
        const url = `${base}/repos/${repo}/dependabot/alerts?state=open&severity=critical,high&per_page=${DEPENDABOT_PAGE_SIZE}&page=${page}`
        let response: Response
        try {
          response = await doFetch(url, {
            headers: {
              accept: 'application/vnd.github+json',
              authorization: `Bearer ${token}`,
              'x-github-api-version': '2022-11-28',
            },
            signal: AbortSignal.timeout(15_000),
          })
        } catch (error) {
          return {
            kind: 'unknown',
            reason: `the Dependabot alerts read failed to connect: ${clip(error instanceof Error ? error.message : String(error))}`,
          }
        }
        if (response.status !== 200) {
          let message = ''
          try {
            const body: unknown = await response.json()
            if (isRecord(body) && typeof body.message === 'string') message = body.message
          } catch {
            // The status alone names the refusal.
          }
          return {
            kind: 'unknown',
            reason: `GitHub answered ${response.status}${message ? ` (${clip(message)})` : ''} to the Dependabot alerts read, which ${DEPENDABOT_MISSING_PERMISSION}`,
          }
        }
        let rows: DependabotAlertRow[] | null
        try {
          rows = parseAlertRows(await response.json())
        } catch {
          rows = null
        }
        if (rows === null) {
          return {
            kind: 'unknown',
            reason: 'GitHub answered the Dependabot alerts read with a body that is not a list',
          }
        }
        alerts.push(...rows)
        if (rows.length < DEPENDABOT_PAGE_SIZE) return { kind: 'read', alerts }
      }
      return {
        kind: 'unknown',
        reason: `more than ${DEPENDABOT_PAGE_SIZE * DEPENDABOT_MAX_PAGES} open critical or high alerts; the read stopped paging`,
      }
    },
  }
}

/** The fixable high or critical alerts, which is what the standard counts. An
 * alert with no patched release is a fact worth knowing and nothing the app can
 * act on, so it does not fail the check. */
export function summariseDependabot(read: DependabotRead): NacDependabotReading {
  if (read.kind === 'unknown') {
    return { fixableCritical: null, fixableHigh: null, read: 'unknown', reason: read.reason }
  }
  const fixable = read.alerts.filter((alert) => alert.firstPatchedVersion !== null)
  return {
    fixableCritical: fixable.filter((alert) => alert.severity === 'critical').length,
    fixableHigh: fixable.filter((alert) => alert.severity === 'high').length,
    read: 'ok',
    reason: null,
  }
}

// ---------------------------------------------------------------------------
// The checks
// ---------------------------------------------------------------------------

export interface NacCheck {
  id: NacCheckId
  number: 1 | 2 | 3 | 4 | 5 | 6
  title: string
  group: NacGroup
  /** What the check reports, after any waiver. */
  verdict: NacVerdict
  /** What the checker measured, before any waiver. */
  measured: NacMeasured
  detail: string
  /** Why `measured` is `unknown`; null otherwise. */
  reason: string | null
  from: string[]
  diagnostics: string[]
  evidence: string[]
  /** The live waiver, when `verdict` is `waived`; null otherwise. */
  waiver: { issue: string; expires: string } | null
}

interface Part {
  source: string
  verdict: RequirementVerdict
  detail: string
}

/**
 * fail beats unknown beats pass; `not-applicable` parts are ignored (an app
 * with no D1 has no D1 ownership to get wrong); a declared `deviation` is a
 * fail, because an app that ships some other way does not ship the standard
 * way. A check whose every part is not applicable passes.
 */
function rollUp(parts: Part[]): { measured: NacMeasured; detail: string } {
  const applicable = parts.filter((part) => part.verdict !== 'not-applicable')
  const failing = applicable.filter(
    (part) => part.verdict === 'fail' || part.verdict === 'deviation',
  )
  const unknown = applicable.filter((part) => part.verdict === 'unknown')
  const deciding = failing.length > 0 ? failing : unknown.length > 0 ? unknown : applicable
  const measured: NacMeasured =
    failing.length > 0 ? 'fail' : unknown.length > 0 ? 'unknown' : 'pass'
  const detail =
    deciding.length === 0
      ? 'nothing applies to this app'
      : deciding.map((part) => `${part.source}: ${part.detail}`).join('; ')
  return { detail: detail.slice(0, 600), measured }
}

function dependabotPart(reading: NacDependabotReading): Part {
  if (reading.read === 'unknown') {
    return { detail: reading.reason ?? 'unread', source: 'Dependabot', verdict: 'unknown' }
  }
  const critical = reading.fixableCritical ?? 0
  const high = reading.fixableHigh ?? 0
  if (critical + high === 0) {
    return {
      detail: 'no open critical or high alert has a patched release',
      source: 'Dependabot',
      verdict: 'pass',
    }
  }
  return {
    detail: `${critical + high} open alert(s) with a patched release (${critical} critical, ${high} high)`,
    source: 'Dependabot',
    verdict: 'fail',
  }
}

export interface NacFreshness {
  generated: string
  toolVersion: string
  maxAgeDays: number
  /** `generated` plus `maxAgeDays`. The portal still computes age itself. */
  freshUntil: string
}

export interface NacStatus {
  statusSchemaVersion: typeof NAC_STATUS_SCHEMA_VERSION
  checks: NacCheck[]
  waivers: NacWaiver[]
  dependabot: NacDependabotReading
  freshness: NacFreshness
  /** `narduk-app` when the four structural checks pass or are waived. */
  status: 'narduk-app' | 'not-yet'
  /** Checks 5 and 6 both pass or are waived. Independent of `status`. */
  upToDate: boolean
  /** The structural checks that are not passing or waived, in order. */
  blocking: NacCheckId[]
}

export interface BuildNacStatusInput {
  requirements: readonly RequirementLike[]
  dependabot: NacDependabotReading
  waiverEntries: unknown[] | 'malformed'
  generated: string
  toolVersion: string
}

function addDays(iso: string, days: number): string {
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return iso
  return new Date(parsed.getTime() + days * 86_400_000).toISOString()
}

export function buildNacStatus(input: BuildNacStatusInput): NacStatus {
  const { requirements, dependabot, generated, toolVersion } = input

  const measuredById = {} as Record<NacCheckId, { measured: NacMeasured; detail: string }>
  const evidenceById = {} as Record<NacCheckId, string[]>

  for (const definition of NAC_CHECKS) {
    const rows = definition.from
      .map((id) => requirements.find((requirement) => requirement.id === id))
      .filter((row): row is RequirementLike => row !== undefined)
    const parts: Part[] = rows.map((row) => ({
      detail: row.detail,
      source: row.id,
      verdict: row.verdict,
    }))
    if (definition.id === 'security') parts.push(dependabotPart(dependabot))
    if (definition.id === 'freshness') {
      // The report is fresh at the instant it is generated, by the checker that
      // generated it. Age is the portal's to compute from `generated`.
      measuredById[definition.id] = {
        detail: `generated ${generated} by narduk-app-tools ${toolVersion}; fresh for ${FRESHNESS_MAX_AGE_DAYS} days`,
        measured: 'pass',
      }
    } else {
      measuredById[definition.id] = rollUp(parts)
    }
    evidenceById[definition.id] = [...new Set(rows.flatMap((row) => row.evidence))]
  }

  const measured = Object.fromEntries(
    NAC_CHECK_IDS.map((id) => [id, measuredById[id].measured]),
  ) as Record<NacCheckId, NacMeasured>
  const waivers = judgeWaivers(input.waiverEntries, measured, generated)

  const checks: NacCheck[] = NAC_CHECKS.map((definition) => {
    const { measured: checkMeasured, detail } = measuredById[definition.id]
    const live = waivers
      .filter((waiver) => waiver.state === 'active' && waiver.check === definition.id)
      .sort((a, b) => b.expires.localeCompare(a.expires))[0]
    const refused = waivers.some(
      (waiver) => waiver.state === 'refused' && waiver.check === definition.id,
    )
    const verdict: NacVerdict = live ? 'waived' : checkMeasured
    return {
      detail: refused ? `${detail}; a waiver for this check was refused` : detail,
      diagnostics: [...definition.diagnostics],
      evidence: evidenceById[definition.id],
      from: [...definition.from],
      group: definition.group,
      id: definition.id,
      measured: checkMeasured,
      number: definition.number,
      reason: checkMeasured === 'unknown' ? detail : null,
      title: definition.title,
      verdict,
      waiver: live ? { expires: live.expires, issue: live.issue } : null,
    }
  })

  const passing = (check: NacCheck): boolean =>
    check.verdict === 'pass' || check.verdict === 'waived'
  const blocking = checks
    .filter((check) => check.group === 'structural' && !passing(check))
    .map((check) => check.id)
  const upToDate = checks.filter((check) => check.group === 'currency').every(passing)

  return {
    blocking,
    checks,
    dependabot,
    freshness: {
      freshUntil: addDays(generated, FRESHNESS_MAX_AGE_DAYS),
      generated,
      maxAgeDays: FRESHNESS_MAX_AGE_DAYS,
      toolVersion,
    },
    status: blocking.length === 0 ? 'narduk-app' : 'not-yet',
    statusSchemaVersion: NAC_STATUS_SCHEMA_VERSION,
    upToDate,
    waivers,
  }
}

const NAC_VERDICT_LABEL: Record<NacVerdict, string> = {
  fail: 'FAIL  ',
  pass: 'PASS  ',
  unknown: 'UNKNOWN',
  waived: 'WAIVED',
}

/** The six checks and the status line, for the human summary. */
export function formatNacStatus(status: NacStatus): string[] {
  const headline =
    status.status === 'narduk-app'
      ? `Narduk app · ${status.upToDate ? 'up to date' : 'behind'}`
      : `Not yet (${status.blocking.join(', ')})`
  const lines = [`  status     ${headline}`, '']
  for (const check of status.checks) {
    const waiver = check.waiver ? ` until ${check.waiver.expires} (${check.waiver.issue})` : ''
    lines.push(
      `  [${NAC_VERDICT_LABEL[check.verdict]}] ${check.number} ${check.title}${waiver}`,
      `            ${check.detail}`,
    )
  }
  for (const waiver of status.waivers.filter((entry) => entry.state !== 'active')) {
    lines.push(
      `  waiver ${waiver.state}: ${waiver.check || '(no check)'} ${waiver.issue} -- ${waiver.reason ?? ''}`,
    )
  }
  return lines
}
