/**
 * Item 12 -- `deployment-standard-conformance` (deployment-standard design
 * §2.2 tier 1; Logan approved every recommended option on 2026-09-17,
 * company-hq#745).
 *
 * The standard is **Cloudflare builds, GitHub promotes**: a Workers Build runs
 * `wrangler versions upload` on every branch and deploys nothing; a GitHub
 * Actions job promotes one version to 100% only after the gate check is green
 * on that exact commit. This item is the cheap half of holding an app to that
 * -- a pure repo read, no credential, runs in the existing build job.
 *
 * **What this item cannot do, stated in its own verdict.** Tier 1 reads the
 * repository. It cannot see Cloudflare's own configuration: a deploy command
 * edited in the dashboard, a branch-builds toggle, a second Worker on a personal
 * account serving the same hostname. Those need a read-only Cloudflare token and
 * are design §2.2 tier 2 (`doctor --cloudflare`, a follow-up). A green verdict
 * here means the repository declares the standard correctly -- never that the
 * deployment is correct. The artefact says so in `limitations`, and the printed
 * summary repeats it, so a green repo check is not mistaken for a green
 * deployment.
 *
 * **Rollout mode is the default.** An app with no `deployment` block is
 * `not-applicable` and the command exits 0, with a loud NOT ADOPTED banner.
 * Publishing this item therefore turns no app's CI red on the day it ships;
 * adoption happens app by app (§7.2). `--strict` makes the missing block a
 * failure, and is what the estate flips to once adoption is complete.
 *
 * **The one rule that fails even in rollout mode** is 12.4. A Worker version
 * captures its binding *configuration* but not the state behind it, and
 * `preview_database_id` / `preview_id` / `preview_bucket_name` are `wrangler
 * dev` only -- they do nothing for a Workers Builds preview (§3.2). So a
 * non-production branch build of an app whose committed wrangler config binds
 * production D1/KV/R2 writes to production data from every PR branch. That is
 * not advice; the gate refuses it.
 */

import {
  DEPLOYMENT_STANDARD,
  PREVIEW_BINDING_KINDS,
  STANDARD_DEPLOY_COMMAND,
  BUILD_VERSION_HEADER,
  previewBindingName,
  readDeploymentBlock,
  type DeploymentBlockOutcome,
  type PreviewBindingKind,
} from '../../deployment-config.js'
import { check } from '../schema.js'
import { findWranglerConfig, isRecord, parseJson, wranglerScopes, type AppRepo } from '../source.js'
import {
  STATUS_FAIL,
  STATUS_NA,
  STATUS_PASS,
  STATUS_UNKNOWN,
  type FoundationSubCheck,
} from '../types.js'

export const DEPLOYMENT_ITEM_ID = 12
export const DEPLOYMENT_ITEM_NAME = 'deployment-standard-conformance'

/** The app's declaration surface. */
export const CLOUDFLARE_APP_FILE = 'Config/cloudflare-app.json'

/** What tier 1 is structurally unable to decide. Carried in the artefact and
 * printed with every verdict (design §2.2: "say so in the item's own message
 * rather than letting a green repo check read as a green deployment"). */
export const TIER_ONE_LIMITATIONS: readonly string[] = [
  'This item reads the repository only. It cannot prove anything about Cloudflare itself -- ' +
    'the deploy commands actually configured on the Workers Builds connection, whether ' +
    'non-production branch builds are enabled there, or whether another Worker on another ' +
    'account serves the same hostname.',
  'A dashboard-edited deploy command is invisible here and is the exact failure that would ' +
    'silently undo the standard. Catching it needs the live read (design §2.2 tier 2).',
]

/** The wrangler keys that declare each preview-sensitive binding kind. */
const BINDING_KEYS: Record<PreviewBindingKind, string> = {
  d1: 'd1_databases',
  kv: 'kv_namespaces',
  r2: 'r2_buckets',
}

export type BindingsByKind = Record<PreviewBindingKind, string[]>

function emptyBindings(): BindingsByKind {
  return { d1: [], kv: [], r2: [] }
}

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort()
}

/**
 * Every D1/KV/R2 binding NAME a JSON or JSONC wrangler config declares, by
 * kind, across the top level and every `env.*` scope.
 *
 * Every scope counts, not just the top level: a branch build reads the
 * committed config, and a binding declared under any environment is one a
 * version can be built with. Over-reporting here can only make the §3.2 refusal
 * stricter, never weaker.
 */
export function bindingsByKindFromJson(config: unknown): BindingsByKind {
  const out = emptyBindings()
  for (const [, scope] of wranglerScopes(config)) {
    for (const kind of PREVIEW_BINDING_KINDS) {
      const block = scope[BINDING_KEYS[kind]]
      if (!Array.isArray(block)) continue
      for (const entry of block) {
        if (isRecord(entry) && typeof entry.binding === 'string' && entry.binding.trim() !== '') {
          out[kind].push(entry.binding.trim())
        }
      }
    }
  }
  for (const kind of PREVIEW_BINDING_KINDS) out[kind] = sortedUnique(out[kind])
  return out
}

/**
 * The same, for `wrangler.toml`. Array-tables are tracked by header so a
 * `binding = "..."` line is attributed to the kind whose table it sits in;
 * `[env.NAME.d1_databases]` counts as `d1` for the same reason the JSON half
 * reads every scope.
 */
export function bindingsByKindFromToml(text: string): BindingsByKind {
  const out = emptyBindings()
  let kind: PreviewBindingKind | null = null
  for (const line of text.split(/\r?\n/u)) {
    const header = /^\s*\[\[?([^\]]+)\]\]?\s*$/u.exec(line)
    if (header) {
      const tail = header[1].trim().split('.').pop() ?? ''
      kind = PREVIEW_BINDING_KINDS.find((candidate) => BINDING_KEYS[candidate] === tail) ?? null
      continue
    }
    if (kind === null) continue
    const match = /^\s*binding\s*=\s*"([^"]+)"/u.exec(line)
    if (match && match[1].trim() !== '') out[kind].push(match[1].trim())
  }
  for (const each of PREVIEW_BINDING_KINDS) out[each] = sortedUnique(out[each])
  return out
}

export function productionBindings(repo: AppRepo, wranglerRel: string | null): BindingsByKind {
  if (!wranglerRel) return emptyBindings()
  const text = repo.read(wranglerRel)
  if (text === null) return emptyBindings()
  if (wranglerRel.endsWith('.toml')) return bindingsByKindFromToml(text)
  return bindingsByKindFromJson(parseJson(text))
}

/** Every `account_id` a JSON/JSONC wrangler config declares, across scopes. */
export function declaredAccountIds(repo: AppRepo, wranglerRel: string | null): string[] {
  if (!wranglerRel || wranglerRel.endsWith('.toml')) return []
  const config = parseJson(repo.read(wranglerRel))
  const ids: string[] = []
  for (const [, scope] of wranglerScopes(config)) {
    if (typeof scope.account_id === 'string' && scope.account_id.trim() !== '') {
      ids.push(scope.account_id.trim())
    }
  }
  return sortedUnique(ids)
}

export interface DeploymentScan {
  configFile: typeof CLOUDFLARE_APP_FILE
  wranglerRel: string | null
  outcome: DeploymentBlockOutcome
  /** D1/KV/R2 bindings the committed wrangler config declares. */
  production: BindingsByKind
  /** Production bindings `previewBindings` does not replace. Empty unless the
   * block is valid AND non-production branch builds are on. */
  uncovered: BindingsByKind
  accountIds: string[]
}

export function scanDeployment(repo: AppRepo): DeploymentScan {
  const wranglerRel = findWranglerConfig(repo)
  const outcome = readDeploymentBlock(parseJson(repo.read(CLOUDFLARE_APP_FILE)))
  const production = productionBindings(repo, wranglerRel)
  const uncovered = emptyBindings()
  if (outcome.kind === 'valid' && outcome.block.nonProductionBranchBuilds) {
    for (const kind of PREVIEW_BINDING_KINDS) {
      const covered = new Set(outcome.block.previewBindings[kind].map(previewBindingName))
      uncovered[kind] = production[kind].filter((name) => !covered.has(name))
    }
  }
  return {
    configFile: CLOUDFLARE_APP_FILE,
    wranglerRel,
    outcome,
    production,
    uncovered,
    accountIds: declaredAccountIds(repo, wranglerRel),
  }
}

/* -------------------------------------------------------------------------- */
/* sub-checks                                                                  */
/* -------------------------------------------------------------------------- */

/** The message an app that has not adopted the standard reads. Deliberately an
 * instruction, not a scold: the whole point of rollout mode is that this is a
 * normal, expected, exit-0 state until the app's onboarding step runs. */
export const NOT_ADOPTED_DETAIL =
  `${CLOUDFLARE_APP_FILE} declares no "deployment" block, so this app has not adopted the ` +
  `Narduk deployment standard yet. Rollout mode reports that as not-applicable and exits 0; ` +
  `adopt it by adding the block (design §2.1) and re-run. Pass --strict to make a missing ` +
  `block a failure once the estate has finished adopting.`

/** 12.0 -- the block exists and satisfies the schema. */
function evaluate120(scan: DeploymentScan, strict: boolean): FoundationSubCheck {
  const name = 'deployment block declared and valid'
  const { outcome } = scan
  if (outcome.kind === 'absent') {
    return check(
      '12.0',
      name,
      strict ? STATUS_FAIL : STATUS_NA,
      strict
        ? `${CLOUDFLARE_APP_FILE} declares no "deployment" block and --strict was passed`
        : NOT_ADOPTED_DETAIL,
      scan.configFile,
    )
  }
  if (outcome.kind === 'malformed') {
    return check(
      '12.0',
      name,
      STATUS_FAIL,
      `"deployment" is present but unreadable: ${outcome.detail}`,
      scan.configFile,
    )
  }
  if (outcome.kind === 'exempt') {
    return check(
      '12.0',
      name,
      STATUS_NA,
      `"deployment".standard is ${JSON.stringify(outcome.standard)}, not ` +
        `${JSON.stringify(DEPLOYMENT_STANDARD)} -- this app is exempt from the standard and ` +
        `must justify that where exemptions are recorded; nothing below applies to it`,
      scan.configFile,
    )
  }
  if (outcome.kind === 'invalid') {
    return check(
      '12.0',
      name,
      STATUS_FAIL,
      `"deployment" claims ${JSON.stringify(DEPLOYMENT_STANDARD)} but does not satisfy it: ` +
        outcome.issues.map((issue) => `${issue.path} -- ${issue.message}`).join('; '),
      scan.configFile,
    )
  }
  return check(
    '12.0',
    name,
    STATUS_PASS,
    `"deployment" declares ${DEPLOYMENT_STANDARD} on builder ${outcome.block.builder}, ` +
      `production branch ${outcome.block.productionBranch}`,
    scan.configFile,
  )
}

/** Every later sub-check is undecidable unless 12.0 found a valid block. */
function onlyWhenValid(
  id: string,
  name: string,
  scan: DeploymentScan,
  decide: () => FoundationSubCheck,
): FoundationSubCheck {
  if (scan.outcome.kind === 'valid') return decide()
  const why =
    scan.outcome.kind === 'absent'
      ? 'no deployment block to check'
      : scan.outcome.kind === 'exempt'
        ? 'this app declares a different standard'
        : 'the deployment block is not valid'
  return check(id, name, STATUS_NA, why, scan.configFile)
}

/** 12.1 -- a build uploads a version; it never deploys. */
function evaluate121(scan: DeploymentScan): FoundationSubCheck {
  const name = 'both build commands upload a version rather than deploying'
  return onlyWhenValid('12.1', name, scan, () => {
    if (scan.outcome.kind !== 'valid') throw new Error('unreachable')
    const { productionDeployCommand, nonProductionDeployCommand } = scan.outcome.block
    const wrong: string[] = []
    if (productionDeployCommand.trim() !== STANDARD_DEPLOY_COMMAND) {
      wrong.push(`productionDeployCommand = ${JSON.stringify(productionDeployCommand)}`)
    }
    if (nonProductionDeployCommand.trim() !== STANDARD_DEPLOY_COMMAND) {
      wrong.push(`nonProductionDeployCommand = ${JSON.stringify(nonProductionDeployCommand)}`)
    }
    if (wrong.length > 0) {
      return check(
        '12.1',
        name,
        STATUS_FAIL,
        `${wrong.join('; ')} -- both must be exactly ${JSON.stringify(STANDARD_DEPLOY_COMMAND)}. ` +
          `A build whose command deploys has already pushed to production, which is the one ` +
          `thing the standard exists to prevent.`,
        scan.configFile,
      )
    }
    return check(
      '12.1',
      name,
      STATUS_PASS,
      `both commands are ${JSON.stringify(STANDARD_DEPLOY_COMMAND)}`,
      scan.configFile,
    )
  })
}

/** 12.2 -- promotion is gated on a named check and a named credential. */
function evaluate122(scan: DeploymentScan): FoundationSubCheck {
  const name = 'promotion is gated on a named check with its own credential'
  return onlyWhenValid('12.2', name, scan, () => {
    if (scan.outcome.kind !== 'valid') throw new Error('unreachable')
    const { promotion } = scan.outcome.block
    if (promotion.mode === 'manual-dispatch') {
      return check(
        '12.2',
        name,
        STATUS_PASS,
        `promotion.mode is manual-dispatch; a human runs the promote workflow, credential ` +
          `${promotion.credential}`,
        scan.configFile,
      )
    }
    if (!promotion.credential.startsWith('cloudflare/')) {
      return check(
        '12.2',
        name,
        STATUS_FAIL,
        `promotion.credential ${JSON.stringify(promotion.credential)} does not name a Cloudflare ` +
          `credential path -- one scoped token per app, e.g. ` +
          `cloudflare/prd/narduk-enterprises-<app>-promote`,
        scan.configFile,
      )
    }
    return check(
      '12.2',
      name,
      STATUS_PASS,
      `auto-on-green behind ${JSON.stringify(promotion.gateCheck)}, credential ` +
        `${promotion.credential}`,
      scan.configFile,
    )
  })
}

/** 12.3 -- the live proof can actually be run against this app. */
function evaluate123(scan: DeploymentScan): FoundationSubCheck {
  const name = 'live proof declares a header, a health path and a smoke path'
  return onlyWhenValid('12.3', name, scan, () => {
    if (scan.outcome.kind !== 'valid') throw new Error('unreachable')
    const { liveProof } = scan.outcome.block
    if (liveProof.buildVersionHeader.toLowerCase() !== BUILD_VERSION_HEADER) {
      return check(
        '12.3',
        name,
        STATUS_FAIL,
        `liveProof.buildVersionHeader is ${JSON.stringify(liveProof.buildVersionHeader)}, but ` +
          `narduk-core emits ${JSON.stringify(BUILD_VERSION_HEADER)} from ` +
          `runtimeConfig.public.buildVersion -- a proof against any other header name reads ` +
          `nothing and would pass an undeployed commit`,
        scan.configFile,
      )
    }
    return check(
      '12.3',
      name,
      STATUS_PASS,
      `${BUILD_VERSION_HEADER}, health ${liveProof.healthPath}, smoke ${liveProof.smokePath}, ` +
        `up to ${liveProof.attempts} attempts ${liveProof.intervalSeconds}s apart`,
      scan.configFile,
    )
  })
}

/**
 * 12.4 -- **the refusal.** Non-production branch builds may not bind production
 * data. This is the safety-critical rule of the whole item and the reason
 * `nonProductionBranchBuilds` is a declared field rather than a Cloudflare-side
 * toggle nobody can see from a checkout.
 */
function evaluate124(scan: DeploymentScan): FoundationSubCheck {
  const name = 'non-production branch builds do not bind production data'
  return onlyWhenValid('12.4', name, scan, () => {
    if (scan.outcome.kind !== 'valid') throw new Error('unreachable')
    const { block } = scan.outcome
    if (!block.nonProductionBranchBuilds) {
      return check(
        '12.4',
        name,
        STATUS_PASS,
        'nonProductionBranchBuilds is false, so no branch preview is built against this ' +
          "Worker's production bindings",
        scan.configFile,
      )
    }
    if (!scan.wranglerRel) {
      return check(
        '12.4',
        name,
        STATUS_UNKNOWN,
        'nonProductionBranchBuilds is true but no wrangler config was found at a known path, ' +
          'so whether a preview would bind production data cannot be decided from this checkout',
      )
    }
    const offenders = PREVIEW_BINDING_KINDS.flatMap((kind) =>
      scan.uncovered[kind].map((binding) => `${kind}:${binding}`),
    )
    if (offenders.length > 0) {
      return check(
        '12.4',
        name,
        STATUS_FAIL,
        `nonProductionBranchBuilds is true and ${scan.wranglerRel} declares ` +
          `${offenders.length} production binding(s) that deployment.previewBindings does not ` +
          `replace: ${offenders.join(', ')}. A Worker version captures its binding ` +
          `configuration but not the state behind it, and preview_database_id / preview_id / ` +
          `preview_bucket_name apply to "wrangler dev" only -- they do nothing for a Workers ` +
          `Builds preview. As declared, every PR branch of this app would read and write ` +
          `production data. Create a preview resource per binding, list it under ` +
          `deployment.previewBindings, or set nonProductionBranchBuilds to false.`,
        scan.wranglerRel,
      )
    }
    const covered = PREVIEW_BINDING_KINDS.flatMap((kind) => scan.production[kind])
    return check(
      '12.4',
      name,
      STATUS_PASS,
      covered.length === 0
        ? `nonProductionBranchBuilds is true and ${scan.wranglerRel} declares no D1, KV or R2 ` +
            `binding, so a preview has no production state to reach`
        : `every one of the ${covered.length} production D1/KV/R2 binding(s) has a preview ` +
            `replacement declared`,
      scan.wranglerRel,
    )
  })
}

/** 12.5 -- one Cloudflare account, declared in the repository. */
function evaluate125(scan: DeploymentScan): FoundationSubCheck {
  const name = 'wrangler declares one Cloudflare account'
  const caveat =
    'this is a repository read: whether that id is the Narduk Enterprises account, and whether ' +
    'another Worker on another account serves the same hostname, needs the live check (tier 2)'
  return onlyWhenValid('12.5', name, scan, () => {
    if (!scan.wranglerRel) {
      return check('12.5', name, STATUS_UNKNOWN, 'no wrangler config found at a known path')
    }
    if (scan.wranglerRel.endsWith('.toml')) {
      return check(
        '12.5',
        name,
        STATUS_NA,
        `${scan.wranglerRel} is TOML; the account id is read from JSON/JSONC configs only`,
        scan.wranglerRel,
      )
    }
    if (scan.accountIds.length === 0) {
      // The paved path deliberately omits `account_id`: it comes from
      // CLOUDFLARE_ACCOUNT_ID at deploy time, and the generator refuses to
      // fabricate live account metadata. Absence is the normal shape, not a
      // finding -- which account was actually used is tier 2's question.
      return check(
        '12.5',
        name,
        STATUS_NA,
        `${scan.wranglerRel} declares no account_id, so the account comes from the environment ` +
          `at deploy time -- ${caveat}`,
        scan.wranglerRel,
      )
    }
    if (scan.accountIds.length > 1) {
      return check(
        '12.5',
        name,
        STATUS_FAIL,
        `${scan.wranglerRel} declares ${scan.accountIds.length} different account_id values ` +
          `across its environments (${scan.accountIds.join(', ')}); one app deploys to one account`,
        scan.wranglerRel,
      )
    }
    return check(
      '12.5',
      name,
      STATUS_PASS,
      `${scan.wranglerRel} declares a single account_id on every environment -- ${caveat}`,
      scan.wranglerRel,
    )
  })
}

export function evaluateItem12(scan: DeploymentScan, strict = false): FoundationSubCheck[] {
  return [
    evaluate120(scan, strict),
    evaluate121(scan),
    evaluate122(scan),
    evaluate123(scan),
    evaluate124(scan),
    evaluate125(scan),
  ]
}
