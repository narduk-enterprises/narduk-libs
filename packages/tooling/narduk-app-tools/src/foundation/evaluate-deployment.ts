/**
 * Runs item 12 `deployment-standard-conformance` as its own small artefact.
 *
 * It is NOT emitted inside `foundation-check.json`: that artefact is the exact
 * 7-item contract company-hq `check-web-foundation.py` `validate_artefact()`
 * consumes, and an `id` outside `1..7` is a rollup-red F3 ARTEFACT finding --
 * the same reasoning items 8, 9, 10 and 11 already carry. This runner reuses the
 * status vocabulary and roll-up rules (`check()`, `rollUp()`) and writes a
 * one-item artefact so nothing mistakes it for the ratified shape.
 *
 * Every verdict comes from the app's own files, so no credential is needed and
 * the command can be wired into generated CI after the install step has dropped
 * the GitHub Packages token -- which is also its limit: see
 * `TIER_ONE_LIMITATIONS`, reported with every run.
 */

import {
  CLOUDFLARE_APP_FILE,
  DEPLOYMENT_ITEM_ID,
  DEPLOYMENT_ITEM_NAME,
  evaluateItem12,
  scanDeployment,
  TIER_ONE_LIMITATIONS,
  type BindingsByKind,
  type DeploymentScan,
} from './items/item-12-deployment-standard.js'
import { rollUp } from './schema.js'
import { resolveAppInfo } from './evaluate.js'
import { AppRepo } from './source.js'
import { DEPLOYMENT_STANDARD, PREVIEW_BINDING_KINDS } from '../deployment-config.js'
import { PREVIEW_CONFIG_FILENAME, type PreviewPlanStatus } from '../preview-config.js'
import type { FoundationAppInfo, FoundationItemResult, FoundationResult } from './types.js'

export const DEPLOYMENT_TOOL_NAME = '@narduk-enterprises/narduk-app-tools/deployment-standard'
export const DEPLOYMENT_CONTRACT_SOURCE =
  'Narduk deployment standard (deployment-standard design §2.1/§2.2 tier 1); ' +
  'Logan approved every recommended option on 2026-09-17 (company-hq#745)'

/** Rollout is the default: a missing block is reported, not failed. */
export type DeploymentCheckMode = 'rollout' | 'strict'

/** What the repository says about its relationship to the standard. */
export type DeploymentAdoption = 'adopted' | 'not-adopted' | 'exempt' | 'invalid'

/**
 * The live-proof contract the app declares, carried out of the scan so a
 * caller that probes the origin reads the app's own paths rather than
 * assuming them (narduk-libs#632).
 *
 * Null whenever the block is absent, exempt or invalid: there is then no
 * declaration to honour, and a consumer falls back to the standard's
 * defaults rather than inventing one.
 */
export interface DeclaredLiveProof {
  /** The response header that carries the deployed build stamp. */
  buildVersionHeader: string
  /** The path a health probe must read. */
  healthPath: string
  /** The path a delivery-path probe must read. */
  smokePath: string
}

/** A one-item artefact, deliberately NOT shaped like `FoundationCheckArtefact`
 * (no `items` array, no claim of the ratified 7-item contract). */
export interface DeploymentArtefact {
  schemaVersion: 1
  tool: typeof DEPLOYMENT_TOOL_NAME
  toolVersion: string
  generated: string
  app: FoundationAppInfo
  contract: { source: string; standard: string; items: 1 }
  mode: DeploymentCheckMode
  adoption: DeploymentAdoption
  declaration: {
    file: string
    wranglerConfig: string | null
    standard: string | null
    nonProductionBranchBuilds: boolean | null
    stagingEnabled: boolean | null
    /** What the block declares about proving a deployment live. Null unless
     * the block is valid -- see `DeclaredLiveProof`. */
    liveProof: DeclaredLiveProof | null
  }
  /** D1/KV/R2 bindings the committed wrangler config declares. */
  productionBindings: BindingsByKind
  /** Production bindings a branch preview would reach with no replacement. */
  uncoveredPreviewBindings: BindingsByKind
  /** What a non-production branch build uploads (narduk-libs#473). Null unless
   * the block is valid and non-production branch builds are on. `file` is the
   * preview config the build writes, or null when it keeps the production one. */
  previewConfig: {
    status: PreviewPlanStatus | 'blocked'
    file: string | null
    rebound: string[]
    blockers: string[]
  } | null
  /** What a repository read structurally cannot decide. Always populated. */
  limitations: readonly string[]
  item: FoundationItemResult
  result: FoundationResult
  exitCode: 0 | 1 | 2
}

function adoptionOf(scan: DeploymentScan): DeploymentAdoption {
  switch (scan.outcome.kind) {
    case 'valid':
      return 'adopted'
    case 'exempt':
      return 'exempt'
    case 'absent':
      return 'not-adopted'
    default:
      return 'invalid'
  }
}

export interface RunDeploymentCheckOptions {
  root: string
  toolVersion: string
  /** Make a missing `deployment` block a failure instead of a report. */
  strict?: boolean
  appOverrides?: Partial<FoundationAppInfo>
  generated?: string
}

export function runDeploymentCheck(options: RunDeploymentCheckOptions): DeploymentArtefact {
  const repo = new AppRepo(options.root)
  const scan = scanDeployment(repo)
  const strict = options.strict === true
  const checks = evaluateItem12(scan, strict)
  const item: FoundationItemResult = {
    id: DEPLOYMENT_ITEM_ID,
    name: DEPLOYMENT_ITEM_NAME,
    status: rollUp(checks),
    checks,
  }
  const result: FoundationResult =
    item.status === 'fail' ? 'FAIL' : item.status === 'unknown' ? 'UNKNOWN' : 'PASS'
  const exitCode: 0 | 1 | 2 = result === 'FAIL' ? 1 : result === 'UNKNOWN' ? 2 : 0
  const block = scan.outcome.kind === 'valid' ? scan.outcome.block : null

  return {
    schemaVersion: 1,
    tool: DEPLOYMENT_TOOL_NAME,
    toolVersion: options.toolVersion,
    generated: options.generated ?? new Date().toISOString(),
    app: resolveAppInfo(options.root, options.appOverrides),
    contract: {
      source: DEPLOYMENT_CONTRACT_SOURCE,
      standard: DEPLOYMENT_STANDARD,
      items: 1,
    },
    mode: strict ? 'strict' : 'rollout',
    adoption: adoptionOf(scan),
    declaration: {
      file: CLOUDFLARE_APP_FILE,
      wranglerConfig: scan.wranglerRel,
      standard:
        scan.outcome.kind === 'valid'
          ? scan.outcome.block.standard
          : scan.outcome.kind === 'exempt' || scan.outcome.kind === 'invalid'
            ? scan.outcome.standard
            : null,
      nonProductionBranchBuilds: block ? block.nonProductionBranchBuilds : null,
      stagingEnabled: block ? block.staging.enabled : null,
      liveProof: block
        ? {
            buildVersionHeader: block.liveProof.buildVersionHeader,
            healthPath: block.liveProof.healthPath,
            smokePath: block.liveProof.smokePath,
          }
        : null,
    },
    productionBindings: scan.production,
    uncoveredPreviewBindings: scan.uncovered,
    previewConfig: scan.preview
      ? {
          status: scan.preview.plan ? scan.preview.plan.status : 'blocked',
          file: scan.preview.plan?.status === 'ready' ? PREVIEW_CONFIG_FILENAME : null,
          rebound: scan.preview.plan?.rebound ?? [],
          blockers: scan.preview.blockers,
        }
      : null,
    limitations: TIER_ONE_LIMITATIONS,
    item,
    result,
    exitCode,
  }
}

function bindingSummary(bindings: BindingsByKind): string {
  const parts = PREVIEW_BINDING_KINDS.filter((kind) => bindings[kind].length > 0).map(
    (kind) => `${kind} ${bindings[kind].join(', ')}`,
  )
  return parts.length > 0 ? parts.join('; ') : 'none'
}

export function formatDeploymentSummary(artefact: DeploymentArtefact): string {
  const lines: string[] = []
  lines.push(`foundation:check:deployment -- ${artefact.app.repo}`)
  lines.push(`  contract   ${artefact.contract.source}`)
  lines.push(`  mode       ${artefact.mode}`)
  lines.push(
    `  adoption   ${artefact.adoption}` +
      (artefact.declaration.standard ? ` (standard ${artefact.declaration.standard})` : ''),
  )
  lines.push(
    `  wrangler   ${artefact.declaration.wranglerConfig ?? '(none found)'}; production D1/KV/R2 ` +
      `bindings: ${bindingSummary(artefact.productionBindings)}`,
  )
  if (artefact.previewConfig) {
    const { status, file, rebound } = artefact.previewConfig
    lines.push(
      `  preview    ${status}` +
        (file ? `; branch builds upload ${file}: ${rebound.join(', ')}` : ''),
    )
  }
  if (artefact.adoption === 'not-adopted') {
    lines.push('')
    lines.push(
      '  NOT ADOPTED -- this app has not declared the Narduk deployment standard yet. ' +
        (artefact.mode === 'rollout'
          ? 'Rollout mode reports this and exits 0.'
          : 'Strict mode fails on it.'),
    )
  }
  lines.push('')
  for (const sub of artefact.item.checks) {
    const mark =
      sub.status === 'pass'
        ? 'PASS'
        : sub.status === 'fail'
          ? 'FAIL'
          : sub.status === 'unknown'
            ? 'UNKN'
            : 'N/A '
    lines.push(`  [${mark}] ${sub.id} ${sub.name}`)
    if (sub.status !== 'pass') lines.push(`         ${sub.detail}`)
  }
  lines.push('')
  lines.push('  This check reads the repository only:')
  for (const limitation of artefact.limitations) lines.push(`    - ${limitation}`)
  lines.push('')
  lines.push(`RESULT: ${artefact.result}`)
  return lines.join('\n')
}
