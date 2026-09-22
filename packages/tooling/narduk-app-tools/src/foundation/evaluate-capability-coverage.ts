/**
 * Runs item 9 `shared-capability-coverage` as its own small artefact, the same
 * way `evaluate-shared-ui-pinned.ts` runs item 8 -- and for the same reason:
 * `foundation-check.json` is the exact 7-item contract company-hq
 * `check-web-foundation.py` `validate_artefact()` consumes, and an `id` outside
 * `1..7` is a rollup-red F3 ARTEFACT finding. The `tool` name carries the
 * `/capability-coverage` suffix so nothing mistakes this document for the
 * ratified shape.
 *
 * The artefact carries an `inventory` block beside the item. That is the point
 * of the item: the estate roster wants the app's `@narduk-enterprises/*` pins
 * with versions and the shared-capability catalog they are scored against, as
 * DATA. Recovering that by re-parsing sub-check prose would make the roster
 * depend on sentence wording, so the block is first-class and the sub-check
 * details summarize it rather than being its only home.
 *
 * NO REGISTRY CREDENTIAL IS NEEDED. Every verdict comes from the app's own
 * manifests and its own source, so a missing `NODE_AUTH_TOKEN` cannot turn this
 * command into exit 2 -- the same property that lets item 8 be wired into
 * `create-narduk-app`'s generated CI after its install step has dropped the
 * GitHub Packages token.
 */

import {
  CAPABILITY_COVERAGE_ITEM_ID,
  CAPABILITY_COVERAGE_ITEM_NAME,
  evaluateItem9,
  type CapabilityCoverageEvaluation,
  type CoverageDetection,
} from './items/item-9-capability-coverage.js'
import type { CapabilityInventory } from './capability-inventory.js'
import { rollUp } from './schema.js'
import { resolveAppInfo } from './evaluate.js'
import { AppRepo } from './source.js'
import type { FoundationAppInfo, FoundationItemResult, FoundationResult } from './types.js'

export const CAPABILITY_COVERAGE_TOOL_NAME =
  '@narduk-enterprises/narduk-app-tools/capability-coverage'
export const CAPABILITY_COVERAGE_CONTRACT_SOURCE =
  'company-hq docs/NARDUK-APP-COMPLIANCE.md#39 (shared behaviour is fixed upstream, never worked around in the app)'

/** A one-item artefact, deliberately NOT shaped like `FoundationCheckArtefact`
 * (no `items` array, no claim of the ratified 7-item contract). */
export interface CapabilityCoverageArtefact {
  schemaVersion: 1
  tool: typeof CAPABILITY_COVERAGE_TOOL_NAME
  toolVersion: string
  generated: string
  app: FoundationAppInfo
  contract: { source: string; items: 1 }
  /** Part (a): what the app pins, and the catalog it is scored against. */
  inventory: CapabilityInventory
  /** Part (b): every reimplementation signal, with its confidence tier. */
  detections: CoverageDetection[]
  /** What the source scan actually covered, so a pass states its own bounds. */
  scan: CapabilityCoverageEvaluation['scan']
  item: FoundationItemResult
  result: FoundationResult
  exitCode: 0 | 1 | 2
}

export interface RunCapabilityCoverageCheckOptions {
  root: string
  toolVersion: string
  appOverrides?: Partial<FoundationAppInfo>
  generated?: string
}

export function runCapabilityCoverageCheck(
  options: RunCapabilityCoverageCheckOptions,
): CapabilityCoverageArtefact {
  const repo = new AppRepo(options.root)
  const evaluation = evaluateItem9(repo)
  const item: FoundationItemResult = {
    id: CAPABILITY_COVERAGE_ITEM_ID,
    name: CAPABILITY_COVERAGE_ITEM_NAME,
    status: rollUp(evaluation.checks),
    checks: evaluation.checks,
  }
  const result: FoundationResult =
    item.status === 'fail' ? 'FAIL' : item.status === 'unknown' ? 'UNKNOWN' : 'PASS'
  const exitCode: 0 | 1 | 2 = result === 'FAIL' ? 1 : result === 'UNKNOWN' ? 2 : 0

  return {
    schemaVersion: 1,
    tool: CAPABILITY_COVERAGE_TOOL_NAME,
    toolVersion: options.toolVersion,
    generated: options.generated ?? new Date().toISOString(),
    app: resolveAppInfo(options.root, options.appOverrides),
    contract: { source: CAPABILITY_COVERAGE_CONTRACT_SOURCE, items: 1 },
    inventory: evaluation.inventory,
    detections: evaluation.detections,
    scan: evaluation.scan,
    item,
    result,
    exitCode,
  }
}

/** A heuristic-only sub-check prints `WARN`; an undecided one prints `UNKN`.
 * Both are `unknown` -- the distinction is what the checker could see, not a
 * fifth status (see `item-9-capability-coverage.ts` § THE VERDICTS). */
function subCheckMark(
  status: string,
  id: string,
  detections: readonly CoverageDetection[],
): string {
  if (status === 'fail') return 'FAIL'
  if (status === 'not-applicable') return 'N/A '
  if (status !== 'unknown') return 'PASS'
  const mine = detections.filter((detection) => detection.subCheck === id)
  return mine.length > 0 && mine.every((detection) => detection.confidence === 'heuristic')
    ? 'WARN'
    : 'UNKN'
}

export function formatCapabilityCoverageSummary(artefact: CapabilityCoverageArtefact): string {
  const { inventory } = artefact
  const adopted = inventory.capabilities.filter((capability) => capability.adopted)
  const lines: string[] = []
  lines.push(`foundation:check:coverage -- ${artefact.app.repo}`)
  lines.push(`  contract   ${artefact.contract.source}`)
  lines.push(
    `  inventory  ${inventory.dependencies.length} estate pin(s) in ` +
      `${inventory.manifests.length} manifest(s); ${adopted.length}/${inventory.capabilities.length} ` +
      'shared capabilities adopted',
  )
  for (const capability of adopted) {
    lines.push(
      `             ${capability.id.padEnd(18)} ${capability.package}@${capability.version}`,
    )
  }
  for (const capability of inventory.capabilities.filter((c) => c.state === 'forked')) {
    lines.push(
      `             ${capability.id.padEnd(18)} FORKED: pinned at ${capability.version}, and the app ` +
        `carries ${capability.fork?.files.length ?? 0} file(s) / ${capability.fork?.lines ?? 0} line(s) of its own copy`,
    )
  }
  if (inventory.unclassified.length > 0) {
    lines.push(`             unclassified: ${inventory.unclassified.join(', ')}`)
  }
  lines.push(
    `  scan       ${artefact.scan.files} file(s) under ${artefact.scan.directories.join(', ') || '(none)'}` +
      (artefact.scan.truncated ? ' (truncated at the file ceiling)' : ''),
  )
  lines.push('')
  const mark =
    artefact.item.status === 'pass'
      ? 'PASS'
      : artefact.item.status === 'fail'
        ? 'FAIL'
        : artefact.item.status === 'unknown'
          ? 'UNKN'
          : 'N/A '
  lines.push(`  [${mark}] item ${artefact.item.id} ${artefact.item.name}`)
  for (const sub of artefact.item.checks) {
    if (sub.status === 'pass') continue
    lines.push(
      `         [${subCheckMark(sub.status, sub.id, artefact.detections)}] ${sub.id} ${sub.name}: ${sub.detail}`,
    )
  }
  lines.push('')
  lines.push(`RESULT: ${artefact.result}`)
  return lines.join('\n')
}
