/**
 * Runs the component suite's two repository checks (narduk-libs#260,
 * components-library-plan.md §2 item 13), each as its own one-item artefact:
 *
 *   - item 13 `no-local-copy`            `foundation:check:no-local-copy`
 *   - item 14 `list-routes-use-contract` `foundation:check:list-routes`
 *
 * They are not folded into `foundation-check.json` for the reason item 8
 * gives (`./evaluate-shared-ui-pinned.ts`): that artefact is the exact 7-item
 * contract company-hq `check-web-foundation.py` validates. Both items decide
 * from the checkout alone, so neither needs a registry credential.
 */

import { rollUp } from './schema.js'
import { resolveAppInfo } from './evaluate.js'
import {
  NO_LOCAL_COPY_ITEM_ID,
  NO_LOCAL_COPY_ITEM_NAME,
  evaluateItem13,
} from './items/item-13-no-local-copy.js'
import {
  LIST_ROUTES_ITEM_ID,
  LIST_ROUTES_ITEM_NAME,
  evaluateItem14,
} from './items/item-14-list-routes-use-contract.js'
import { AppRepo } from './source.js'
import type {
  FoundationAppInfo,
  FoundationItemResult,
  FoundationResult,
  FoundationSubCheck,
} from './types.js'

export const COMPONENT_SUITE_CONTRACT_SOURCE =
  'narduk-libs docs/plans/components-library-plan.md#2 item 13 (narduk-libs#260)'

export const NO_LOCAL_COPY_TOOL_NAME = '@narduk-enterprises/narduk-app-tools/no-local-copy'
export const LIST_ROUTES_TOOL_NAME = '@narduk-enterprises/narduk-app-tools/list-routes-use-contract'

/** A one-item artefact, shaped like item 8's rather than `FoundationCheckArtefact`. */
export interface ComponentSuiteArtefact {
  schemaVersion: 1
  tool: typeof NO_LOCAL_COPY_TOOL_NAME | typeof LIST_ROUTES_TOOL_NAME
  toolVersion: string
  generated: string
  app: FoundationAppInfo
  contract: { source: string; items: 1 }
  item: FoundationItemResult
  result: FoundationResult
  exitCode: 0 | 1 | 2
}

export interface RunComponentSuiteCheckOptions {
  root: string
  toolVersion: string
  appOverrides?: Partial<FoundationAppInfo>
  generated?: string
}

function runOneItem(
  options: RunComponentSuiteCheckOptions,
  tool: ComponentSuiteArtefact['tool'],
  id: number,
  name: string,
  evaluate: (repo: AppRepo) => FoundationSubCheck[],
): ComponentSuiteArtefact {
  const checks = evaluate(new AppRepo(options.root))
  const item: FoundationItemResult = { id, name, status: rollUp(checks), checks }
  const result: FoundationResult =
    item.status === 'fail' ? 'FAIL' : item.status === 'unknown' ? 'UNKNOWN' : 'PASS'
  return {
    schemaVersion: 1,
    tool,
    toolVersion: options.toolVersion,
    generated: options.generated ?? new Date().toISOString(),
    app: resolveAppInfo(options.root, options.appOverrides),
    contract: { source: COMPONENT_SUITE_CONTRACT_SOURCE, items: 1 },
    item,
    result,
    exitCode: result === 'FAIL' ? 1 : result === 'UNKNOWN' ? 2 : 0,
  }
}

export function runNoLocalCopyCheck(
  options: RunComponentSuiteCheckOptions,
): ComponentSuiteArtefact {
  return runOneItem(
    options,
    NO_LOCAL_COPY_TOOL_NAME,
    NO_LOCAL_COPY_ITEM_ID,
    NO_LOCAL_COPY_ITEM_NAME,
    evaluateItem13,
  )
}

export function runListRoutesCheck(options: RunComponentSuiteCheckOptions): ComponentSuiteArtefact {
  return runOneItem(
    options,
    LIST_ROUTES_TOOL_NAME,
    LIST_ROUTES_ITEM_ID,
    LIST_ROUTES_ITEM_NAME,
    evaluateItem14,
  )
}

const MARKS = { pass: 'PASS', fail: 'FAIL', unknown: 'UNKN', 'not-applicable': 'N/A ' } as const

export function formatComponentSuiteSummary(
  command: string,
  artefact: ComponentSuiteArtefact,
): string {
  const lines = [
    `${command} -- ${artefact.app.repo}`,
    `  contract   ${artefact.contract.source}`,
    `  [${MARKS[artefact.item.status]}] item ${artefact.item.id} ${artefact.item.name}`,
  ]
  for (const sub of artefact.item.checks) {
    if (sub.status === 'pass') continue
    lines.push(`         [${MARKS[sub.status]}] ${sub.id} ${sub.name}: ${sub.detail}`)
  }
  lines.push('', `RESULT: ${artefact.result}`)
  return lines.join('\n')
}
