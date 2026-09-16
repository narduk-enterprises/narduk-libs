/**
 * Roll-up and artefact assembly for `foundation:check` (spec §3, §4).
 */

import {
  CONTRACT_ITEMS,
  FOUNDATION_ITEM_COUNT,
  STATUS_FAIL,
  STATUS_NA,
  STATUS_PASS,
  STATUS_UNKNOWN,
  type FoundationAppInfo,
  type FoundationCheckArtefact,
  type FoundationItemResult,
  type FoundationStatus,
  type FoundationSubCheck,
} from './types.js'

export function check(
  id: string,
  name: string,
  status: FoundationStatus,
  detail: string,
  evidence?: string,
): FoundationSubCheck {
  return evidence === undefined
    ? { id, name, status, detail }
    : { id, name, status, detail, evidence }
}

/** fail beats unknown beats pass; all-not-applicable is not-applicable; an
 * item with no sub-checks is unknown. Identical to
 * `check-web-foundation.py`'s `_roll_up()` -- spec §3: "A decided failure is
 * never erased by an undecided sibling, and `unknown` is never a pass". */
export function rollUp(checks: FoundationSubCheck[]): FoundationStatus {
  if (checks.length === 0) return STATUS_UNKNOWN
  const seen = new Set(checks.map((c) => c.status))
  if (seen.has(STATUS_FAIL)) return STATUS_FAIL
  if (seen.has(STATUS_UNKNOWN)) return STATUS_UNKNOWN
  if (seen.size === 1 && seen.has(STATUS_NA)) return STATUS_NA
  return STATUS_PASS
}

export function itemResult(id: number, checks: FoundationSubCheck[]): FoundationItemResult {
  return { id, name: CONTRACT_ITEMS[id], status: rollUp(checks), checks }
}

export function buildArtefact(options: {
  toolVersion: string
  app: FoundationAppInfo
  items: FoundationItemResult[]
  generated?: string
}): FoundationCheckArtefact {
  const { toolVersion, app, generated } = options
  const items = [...options.items].sort((a, b) => a.id - b.id)
  if (items.length !== FOUNDATION_ITEM_COUNT || items.some((it, index) => it.id !== index + 1)) {
    throw new Error(
      `foundation:check must evaluate exactly items 1..${FOUNDATION_ITEM_COUNT}, got ids ` +
        `[${items.map((it) => it.id).join(', ')}]`,
    )
  }
  const seven = items[FOUNDATION_ITEM_COUNT - 1]
  if (seven.status !== STATUS_NA) {
    throw new Error(
      `item 7 (recorded-exemption) must be not-applicable -- an app's own CI cannot read ` +
        `APP_REGISTRY.yaml, and the rollup rejects a decided verdict on item 7 as F3 ` +
        `(got status ${seven.status})`,
    )
  }

  const passing = items.filter((it) => it.status === STATUS_PASS).map((it) => it.id)
  const failing = items.filter((it) => it.status === STATUS_FAIL).map((it) => it.id)
  const unknown = items.filter((it) => it.status === STATUS_UNKNOWN).map((it) => it.id)
  const notApplicable = items.filter((it) => it.status === STATUS_NA).map((it) => it.id)
  const decided = passing.length + failing.length
  const percent = decided > 0 ? Math.round((100 * passing.length) / decided) : 0

  const result = failing.length > 0 ? 'FAIL' : unknown.length > 0 ? 'UNKNOWN' : 'PASS'
  const exitCode = result === 'FAIL' ? 1 : result === 'UNKNOWN' ? 2 : 0

  return {
    schemaVersion: 1,
    tool: '@narduk-enterprises/narduk-app-tools',
    toolVersion,
    generated: generated ?? new Date().toISOString(),
    app,
    contract: {
      source: 'company-hq strategy/web-foundation-libs-plan.md#4',
      ratifiedBy: 'D-WEBFOUND-2 Q9 (a), 2026-09-04; amended 2026-09-16',
      items: FOUNDATION_ITEM_COUNT,
    },
    items,
    score: {
      decided,
      passing: passing.length,
      failing: failing.length,
      unknown: unknown.length,
      notApplicable: notApplicable.length,
      percent,
    },
    failingItems: failing,
    result,
    exitCode: exitCode as 0 | 1 | 2,
  }
}

export function formatArtefactSummary(artefact: FoundationCheckArtefact): string {
  const lines: string[] = []
  lines.push(`foundation:check -- ${artefact.app.repo}`)
  lines.push(
    `  contract   plan §4, ${artefact.contract.items} items, ${artefact.contract.ratifiedBy}`,
  )
  lines.push(
    `  score      ${artefact.score.passing}P ${artefact.score.failing}F ${artefact.score.unknown}U ` +
      `${artefact.score.notApplicable}N/A (${artefact.score.percent ?? 0}% of decided items)`,
  )
  lines.push('')
  for (const item of artefact.items) {
    const mark =
      item.status === 'pass'
        ? 'PASS'
        : item.status === 'fail'
          ? 'FAIL'
          : item.status === 'unknown'
            ? 'UNKN'
            : 'N/A '
    lines.push(`  [${mark}] item ${item.id} ${item.name}`)
    for (const sub of item.checks) {
      if (sub.status === 'pass') continue
      const subMark = sub.status === 'fail' ? 'FAIL' : sub.status === 'unknown' ? 'UNKN' : 'N/A '
      lines.push(`         [${subMark}] ${sub.id} ${sub.name}: ${sub.detail}`)
    }
  }
  lines.push('')
  lines.push(
    `RESULT: ${artefact.result}` +
      (artefact.failingItems.length > 0
        ? ` -- failing item(s) ${artefact.failingItems.join(', ')}`
        : ''),
  )
  return lines.join('\n')
}
