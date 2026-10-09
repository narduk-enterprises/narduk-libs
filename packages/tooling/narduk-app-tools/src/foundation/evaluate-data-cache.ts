/**
 * Runs item 15 `public-reads-are-cached` (narduk-libs#1717) as its own small
 * artefact, shaped like item 8's (`./evaluate-shared-ui-pinned.ts`) and for
 * the same reason: `foundation-check.json` is the exact 7-item contract
 * company-hq's `check-web-foundation.py` validates, so an item outside `1..7`
 * stays out of it.
 *
 * It is a warning in rollout mode. Its sub-checks are `pass` or
 * `not-applicable`, `result` is `PASS`, `exitCode` is `0`, and each finding is
 * an entry in `advisories` (and, structured, in `findings`), so publishing the
 * check turns no app's CI red. See `./items/item-15-public-reads-cached.ts`
 * for the heuristics and for how it ratchets to a failure later.
 */

import { rollUp } from './schema.js'
import { resolveAppInfo } from './evaluate.js'
import {
  DATA_CACHE_ITEM_ID,
  DATA_CACHE_ITEM_NAME,
  dataCacheAdvisories,
  evaluateItem15,
  type CacheExemption,
  type CacheFinding,
  type CacheSuppression,
} from './items/item-15-public-reads-cached.js'
import { AppRepo } from './source.js'
import type { FoundationAppInfo, FoundationItemResult } from './types.js'

export const DATA_CACHE_TOOL_NAME = '@narduk-enterprises/narduk-app-tools/data-cache'
export const DATA_CACHE_CONTRACT_SOURCE = 'narduk-libs#1717 (follow-up to #1716, #1268)'

/** A one-item artefact, deliberately NOT shaped like `FoundationCheckArtefact`. */
export interface DataCacheArtefact {
  schemaVersion: 1
  tool: typeof DATA_CACHE_TOOL_NAME
  toolVersion: string
  generated: string
  app: FoundationAppInfo
  contract: { source: string; items: 1 }
  item: FoundationItemResult
  result: 'PASS'
  exitCode: 0
  /** `warn` today: findings change neither `result` nor `exitCode`. */
  mode: 'warn'
  /** One line per finding, same order as `findings`. */
  advisories: string[]
  findings: CacheFinding[]
  /** Routes carrying the escape comment, with the reason it records. */
  suppressed: CacheSuppression[]
  /** Routes that read D1 but are session-bound or deliberately private. */
  exempt: CacheExemption[]
}

export interface RunDataCacheCheckOptions {
  root: string
  toolVersion: string
  appOverrides?: Partial<FoundationAppInfo>
  generated?: string
}

export function runDataCacheCheck(options: RunDataCacheCheckOptions): DataCacheArtefact {
  const { checks, scan } = evaluateItem15(new AppRepo(options.root))
  const item: FoundationItemResult = {
    id: DATA_CACHE_ITEM_ID,
    name: DATA_CACHE_ITEM_NAME,
    status: rollUp(checks),
    checks,
  }
  return {
    schemaVersion: 1,
    tool: DATA_CACHE_TOOL_NAME,
    toolVersion: options.toolVersion,
    generated: options.generated ?? new Date().toISOString(),
    app: resolveAppInfo(options.root, options.appOverrides),
    contract: { source: DATA_CACHE_CONTRACT_SOURCE, items: 1 },
    item,
    result: 'PASS',
    exitCode: 0,
    mode: 'warn',
    advisories: dataCacheAdvisories(scan),
    findings: [...scan.uncachedRoutes, ...scan.ssrFindings],
    suppressed: scan.suppressed,
    exempt: scan.exempt,
  }
}

const MARKS = { pass: 'PASS', fail: 'FAIL', unknown: 'UNKN', 'not-applicable': 'N/A ' } as const

export function formatDataCacheSummary(artefact: DataCacheArtefact): string {
  const lines = [
    `foundation:check:data-cache -- ${artefact.app.repo}`,
    `  contract   ${artefact.contract.source}`,
    `  [${MARKS[artefact.item.status]}] item ${artefact.item.id} ${artefact.item.name}`,
  ]
  for (const sub of artefact.item.checks) {
    lines.push(`         [${MARKS[sub.status]}] ${sub.id} ${sub.name}: ${sub.detail}`)
  }
  for (const advisory of artefact.advisories) lines.push(`  [WARN] ${advisory}`)
  for (const entry of artefact.suppressed) {
    lines.push(`  [SKIP] ${entry.file}: intentionally uncached -- ${entry.reason}`)
  }
  if (artefact.advisories.length > 0) {
    lines.push(
      '',
      '  Fix: setCacheProfile(event, "live") for outside callers and withWorkerCache(...) for SSR',
      '  reads, or mark the route "// narduk-cache: intentionally-uncached <reason>".',
      '  Guide: narduk-core README, "Worker data cache: withWorkerCache".',
    )
  }
  lines.push('', `RESULT: ${artefact.result} (${artefact.mode} mode)`)
  return lines.join('\n')
}
