/**
 * Shared types for `narduk-app foundation:check` (W5(a), D-WEBFOUND-2 Q9 (a)).
 *
 * The artefact shape here is the exact contract company-hq's
 * `docs/WEB-FOUNDATION-CHECK.md` §4 documents and `scripts/check-web-foundation.py`
 * `validate_artefact()` enforces. Do not add fields the schema does not name, and
 * do not rename `status`/`id`/`items`/`result` -- the rollup pattern-matches this
 * shape exactly.
 */

/** The four verdicts a sub-check or an item can resolve to. No warning tier
 * (D-WEBFOUND-2 Q9 (a)): `unknown` is never a pass, and a `fail` is never
 * erased by an undecided sibling. */
export type FoundationStatus = 'pass' | 'fail' | 'unknown' | 'not-applicable'

export const STATUS_PASS: FoundationStatus = 'pass'
export const STATUS_FAIL: FoundationStatus = 'fail'
export const STATUS_UNKNOWN: FoundationStatus = 'unknown'
export const STATUS_NA: FoundationStatus = 'not-applicable'

/** One machine-checkable sub-check, e.g. "1.2" (bindings mirrored). */
export interface FoundationSubCheck {
  id: string
  name: string
  status: FoundationStatus
  detail: string
  evidence?: string
}

/** One of the seven §4 items, rolled up from its sub-checks. */
export interface FoundationItemResult {
  id: number
  name: string
  status: FoundationStatus
  checks: FoundationSubCheck[]
}

export interface FoundationAppInfo {
  repo: string
  name: string
  commit: string
  ref: string
}

export interface FoundationContractInfo {
  source: string
  ratifiedBy: string
  items: number
}

export interface FoundationScore {
  decided: number
  passing: number
  failing: number
  unknown: number
  notApplicable: number
  percent: number | null
}

export type FoundationResult = 'PASS' | 'FAIL' | 'UNKNOWN'

/** The exact `foundation-check.json` document §4 of the spec defines. */
export interface FoundationCheckArtefact {
  schemaVersion: 1
  tool: string
  toolVersion: string
  generated: string
  app: FoundationAppInfo
  contract: FoundationContractInfo
  items: FoundationItemResult[]
  score: FoundationScore
  failingItems: number[]
  result: FoundationResult
  exitCode: 0 | 1 | 2
}

/** The stable machine ids for the seven §4 items, in plan order. Mirrors
 * `check-web-foundation.py`'s `CONTRACT_ITEMS` -- a second copy that falls out
 * of step with the rollup's naming would make artefacts silently incomparable. */
export const CONTRACT_ITEMS: Record<number, string> = {
  1: 'scaffold-parity',
  2: 'mandatory-packages',
  3: 'capability-packages',
  4: 'no-forks',
  5: 'shared-ci',
  6: 'secrets-and-registry',
  7: 'recorded-exemption',
}

export const FOUNDATION_ITEM_COUNT = 7
