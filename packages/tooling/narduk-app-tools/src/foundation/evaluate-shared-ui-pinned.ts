/**
 * Runs item 8 `shared-ui-pinned` (components-library-plan.md §2 item 6,
 * narduk-libs#253) as its own small artefact.
 *
 * The plan says narduk-app-tools "gains `foundation:check` item 8". The
 * evaluator (`./items/item-8-shared-ui-pinned.ts`) matches items 1-7
 * exactly. It is not emitted inside `foundation-check.json`: that artefact
 * is the exact 7-item contract company-hq `check-web-foundation.py`
 * `validate_artefact()` consumes, and an `id` outside `1..7` is a
 * rollup-red F3 ARTEFACT finding. This runner reuses the same status
 * vocabulary and roll-up rules (`check()`, `rollUp()`) and writes a
 * one-item artefact (`tool: '.../shared-ui-pinned'`) so nothing mistakes
 * it for the ratified shape.
 *
 * The item decides from the app's own manifests, so this runner needs no
 * registry credential and cannot exit 2 for want of one: `UNKNOWN` is
 * reachable only when no `package.json` is readable at a known monorepo
 * candidate path. That is what lets the command be wired into the generated
 * CI in `create-narduk-app`, whose install step deliberately keeps the
 * GitHub Packages token out of the ambient job environment.
 */

import { evaluateItem8, nuxtUiPinAdvisories } from './items/item-8-shared-ui-pinned.js'
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
 * (no `items` array, no claim of the ratified 7-item contract). */
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
  /** Warnings that change neither `result` nor `exitCode` (narduk-libs#1033). */
  advisories: string[]
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
    advisories: nuxtUiPinAdvisories(repo),
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
  for (const advisory of artefact.advisories) lines.push(`  [WARN] ${advisory}`)
  lines.push('')
  lines.push(`RESULT: ${artefact.result}`)
  return lines.join('\n')
}
