/**
 * Runs the "shared UI pinned" check (components-library-plan.md §2 item 6,
 * narduk-libs#253) as its OWN small artefact.
 *
 * DEVIATION FROM THE PLAN TEXT, RECORDED HERE. The plan (and narduk-libs#253)
 * say narduk-app-tools "gains `foundation:check` item 8 `shared-ui-pinned`".
 * `foundation:check`'s artefact is not extensible, though: it is the exact
 * contract ratified by D-WEBFOUND-2 Q9 (a) and mirrored byte-for-byte in
 * company-hq `strategy/web-foundation-libs-plan.md#4` /
 * `scripts/check-web-foundation.py`. That script's own module docstring
 * states `"foundation" means ... seven numbered items`, its
 * `CONTRACT_ITEMS` dict has exactly keys 1-7, and its `validate_artefact()`
 * rejects (F3 ARTEFACT, a RED/exit-1 finding in the weekly rollup) any
 * artefact item whose `id` falls outside `1..FOUNDATION_ITEM_COUNT`, and any
 * `foundation_exception.items` entry outside `1-7` (F1 EXCEPTION). This
 * repo's own `buildArtefact()` (`./schema.js`) enforces the matching local
 * invariant: exactly `FOUNDATION_ITEM_COUNT` (7) items, ids 1..7. Emitting an
 * `id: 8` inside that artefact would either throw locally (if the local
 * invariant is left alone) or silently break every other app's company-hq
 * rollup the moment it upgrades narduk-app-tools (if the invariant and the
 * mirrored `CONTRACT_ITEMS`/`FOUNDATION_ITEM_COUNT` were widened here) --
 * company-hq's script is out of this lane's scope (narduk-libs#253's own
 * scope guard) and was never amended by D-WEBFOUND-2's 2026-09-11 backlog
 * entry to accept an eighth item.
 *
 * So "shared-ui-pinned" ships as a parallel, additively-composable gate with
 * the same status vocabulary and rollup rules as `foundation:check`
 * (`FoundationStatus`, `check()`, `rollUp()` -- all reused from `./schema.js`
 * and `./types.js` unchanged), its own `item-8-*.ts` evaluator and
 * `item-8-*.test.ts` tests to match the requested shape, and its own CLI
 * command (`foundation:check:shared-ui-pinned`) and JSON artefact shape
 * (`tool: '@narduk-enterprises/narduk-app-tools/shared-ui-pinned'`) so it is
 * never mistaken for a `foundation-check.json` artefact by anything that
 * parses that ratified shape. Folding it into the ratified contract as item 8
 * is a follow-up that needs its own company-hq decision and script change,
 * not a unilateral edit from this repo.
 */

import { evaluateItem8 } from './items/item-8-shared-ui-pinned.js'
import { FilesystemRegistryReality, type RegistryReality } from './npm-registry.js'
import { rollUp } from './schema.js'
import { resolveAppInfo } from './evaluate.js'
import { AppRepo } from './source.js'
import type { FoundationAppInfo, FoundationItemResult, FoundationResult } from './types.js'

export const SHARED_UI_PINNED_ITEM_ID = 8
export const SHARED_UI_PINNED_ITEM_NAME = 'shared-ui-pinned'
export const SHARED_UI_PINNED_TOOL_NAME = '@narduk-enterprises/narduk-app-tools/shared-ui-pinned'
export const SHARED_UI_PINNED_CONTRACT_SOURCE =
  'narduk-libs docs/plans/components-library-plan.md#2 item 6 (narduk-libs#253)'

/** A one-item artefact, deliberately NOT shaped like `FoundationCheckArtefact`
 * (no `items` array, no `schemaVersion: 1` claim of the ratified 7-item
 * contract) so nothing mistakes it for one. */
export interface SharedUiPinnedArtefact {
  schemaVersion: 1
  tool: typeof SHARED_UI_PINNED_TOOL_NAME
  toolVersion: string
  generated: string
  app: FoundationAppInfo
  contract: { source: string; items: 1 }
  item: FoundationItemResult
  result: FoundationResult
  exitCode: 0 | 1 | 2
}

export interface RunSharedUiPinnedCheckOptions {
  root: string
  toolVersion: string
  reality?: RegistryReality
  appOverrides?: Partial<FoundationAppInfo>
  generated?: string
}

export async function runSharedUiPinnedCheck(
  options: RunSharedUiPinnedCheckOptions,
): Promise<SharedUiPinnedArtefact> {
  const repo = new AppRepo(options.root)
  const reality = options.reality ?? new FilesystemRegistryReality(options.root)
  const checks = await evaluateItem8(repo, reality)
  const item: FoundationItemResult = {
    id: SHARED_UI_PINNED_ITEM_ID,
    name: SHARED_UI_PINNED_ITEM_NAME,
    status: rollUp(checks),
    checks,
  }
  const result: FoundationResult =
    item.status === 'fail' ? 'FAIL' : item.status === 'unknown' ? 'UNKNOWN' : 'PASS'
  const exitCode: 0 | 1 | 2 = result === 'FAIL' ? 1 : result === 'UNKNOWN' ? 2 : 0

  return {
    schemaVersion: 1,
    tool: SHARED_UI_PINNED_TOOL_NAME,
    toolVersion: options.toolVersion,
    generated: options.generated ?? new Date().toISOString(),
    app: resolveAppInfo(options.root, options.appOverrides),
    contract: { source: SHARED_UI_PINNED_CONTRACT_SOURCE, items: 1 },
    item,
    result,
    exitCode,
  }
}

export function formatSharedUiPinnedSummary(artefact: SharedUiPinnedArtefact): string {
  const lines: string[] = []
  lines.push(`foundation:check:shared-ui-pinned -- ${artefact.app.repo}`)
  lines.push(`  contract   ${artefact.contract.source}`)
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
    const subMark = sub.status === 'fail' ? 'FAIL' : sub.status === 'unknown' ? 'UNKN' : 'N/A '
    lines.push(`         [${subMark}] ${sub.id} ${sub.name}: ${sub.detail}`)
  }
  lines.push('')
  lines.push(`RESULT: ${artefact.result}`)
  return lines.join('\n')
}
