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
import {
  findWranglerConfig,
  findWranglerConfigs,
  isRecord,
  parseJson,
  wranglerScopes,
  type AppRepo,
} from '../source.js'
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

/**
 * Every `account_id` a `wrangler.toml` declares, top level and under every
 * `[env.*]` table.
 *
 * TOML is read for the same reason §2.3 exists: both committed
 * personal-account Workers in the estate are `.toml`, so a check that reads
 * JSON only is not-applicable in exactly the place the defect lives. The
 * anchor rejects a commented-out `# account_id = "..."` line, which one of
 * those two files carries.
 */
export function accountIdsFromToml(text: string): string[] {
  const ids: string[] = []
  for (const line of text.split(/\r?\n/u)) {
    const match = /^\s*account_id\s*=\s*"([^"]+)"/u.exec(line)
    if (match && match[1].trim() !== '') ids.push(match[1].trim())
  }
  return sortedUnique(ids)
}

/** Every `account_id` a JSON/JSONC wrangler config declares, across scopes. */
export function accountIdsFromJson(config: unknown): string[] {
  const ids: string[] = []
  for (const [, scope] of wranglerScopes(config)) {
    if (typeof scope.account_id === 'string' && scope.account_id.trim() !== '') {
      ids.push(scope.account_id.trim())
    }
  }
  return sortedUnique(ids)
}

/** One `account_id` declaration, and which file made it. */
export interface DeclaredAccount {
  rel: string
  accountId: string
}

export function declaredAccounts(
  repo: AppRepo,
  wranglerRels: readonly string[],
): DeclaredAccount[] {
  const out: DeclaredAccount[] = []
  for (const rel of wranglerRels) {
    const text = repo.read(rel)
    if (text === null) continue
    const ids = rel.endsWith('.toml')
      ? accountIdsFromToml(text)
      : accountIdsFromJson(parseJson(text))
    for (const id of ids) out.push({ rel, accountId: id })
  }
  return out
}

/** Cloudflare's own default for both flags when a config is silent: a Worker
 * gets its `workers.dev` route and its version preview URLs unless the config
 * turns them off. Silence therefore means `true`, not "unspecified" -- which is
 * why an app declaring `workersDev: false` and shipping a wrangler config that
 * never mentions `workers_dev` disagrees with itself. */
export const WRANGLER_EXPOSURE_DEFAULT = true

const EXPOSURE_FLAGS = ['workers_dev', 'preview_urls'] as const
export type ExposureFlag = (typeof EXPOSURE_FLAGS)[number]

/** `Config/cloudflare-app.json` `worker.*` counterpart of each wrangler flag. */
export const EXPOSURE_DECLARATION_KEYS: Record<ExposureFlag, string> = {
  workers_dev: 'workersDev',
  preview_urls: 'previewUrls',
}

/** One `workers_dev` / `preview_urls` setting, and where it was set. */
export interface DeclaredFlag {
  rel: string
  scope: string
  key: ExposureFlag
  value: boolean
}

export function exposureFlagsFromToml(text: string): DeclaredFlag[] {
  const out: DeclaredFlag[] = []
  let scope = '(top level)'
  for (const line of text.split(/\r?\n/u)) {
    const header = /^\s*\[\[?([^\]]+)\]\]?\s*$/u.exec(line)
    if (header) {
      scope = header[1].trim()
      continue
    }
    const match = /^\s*(workers_dev|preview_urls)\s*=\s*(true|false)\b/u.exec(line)
    if (match) {
      out.push({ rel: '', scope, key: match[1] as ExposureFlag, value: match[2] === 'true' })
    }
  }
  return out
}

export function exposureFlagsFromJson(config: unknown): DeclaredFlag[] {
  const out: DeclaredFlag[] = []
  for (const [prefix, scope] of wranglerScopes(config)) {
    for (const key of EXPOSURE_FLAGS) {
      const value = scope[key]
      if (typeof value === 'boolean') {
        out.push({ rel: '', scope: prefix === '' ? '(top level)' : prefix, key, value })
      }
    }
  }
  return out
}

export function declaredExposureFlags(repo: AppRepo, wranglerRel: string | null): DeclaredFlag[] {
  if (!wranglerRel) return []
  const text = repo.read(wranglerRel)
  if (text === null) return []
  const flags = wranglerRel.endsWith('.toml')
    ? exposureFlagsFromToml(text)
    : exposureFlagsFromJson(parseJson(text))
  return flags.map((flag) => ({ ...flag, rel: wranglerRel }))
}

/** What `Config/cloudflare-app.json` says about the two exposure flags. */
export function declaredExposure(cloudflareApp: unknown): Partial<Record<ExposureFlag, boolean>> {
  const out: Partial<Record<ExposureFlag, boolean>> = {}
  if (!isRecord(cloudflareApp)) return out
  const worker = cloudflareApp.worker
  if (!isRecord(worker)) return out
  for (const key of EXPOSURE_FLAGS) {
    const value = worker[EXPOSURE_DECLARATION_KEYS[key]]
    if (typeof value === 'boolean') out[key] = value
  }
  return out
}

export interface DeploymentScan {
  configFile: typeof CLOUDFLARE_APP_FILE
  /** The app's own wrangler config -- the one everything descriptive names. */
  wranglerRel: string | null
  /** EVERY wrangler config in the checkout, the app's own first. */
  wranglerRels: string[]
  outcome: DeploymentBlockOutcome
  /** D1/KV/R2 bindings the committed wrangler configs declare, across all of
   * them: a second Worker's production binding is still production data a
   * branch build can be given. */
  production: BindingsByKind
  /** Production bindings `previewBindings` does not replace. Empty unless the
   * block is valid AND non-production branch builds are on. */
  uncovered: BindingsByKind
  /** Every `account_id` declaration in the checkout, with its file. */
  accounts: DeclaredAccount[]
  /** The distinct account ids among them. */
  accountIds: string[]
  /** `workers_dev` / `preview_urls` as the app's own wrangler config sets them. */
  exposureFlags: DeclaredFlag[]
  /** `worker.workersDev` / `worker.previewUrls` from Config/cloudflare-app.json. */
  declaredExposure: Partial<Record<ExposureFlag, boolean>>
}

export function scanDeployment(repo: AppRepo): DeploymentScan {
  const wranglerRel = findWranglerConfig(repo)
  const wranglerRels = findWranglerConfigs(repo)
  const cloudflareApp = parseJson(repo.read(CLOUDFLARE_APP_FILE))
  const outcome = readDeploymentBlock(cloudflareApp)
  const production = emptyBindings()
  for (const rel of wranglerRels) {
    const one = productionBindings(repo, rel)
    for (const kind of PREVIEW_BINDING_KINDS) production[kind].push(...one[kind])
  }
  for (const kind of PREVIEW_BINDING_KINDS) production[kind] = sortedUnique(production[kind])
  const uncovered = emptyBindings()
  if (outcome.kind === 'valid' && outcome.block.nonProductionBranchBuilds) {
    for (const kind of PREVIEW_BINDING_KINDS) {
      const covered = new Set(outcome.block.previewBindings[kind].map(previewBindingName))
      uncovered[kind] = production[kind].filter((name) => !covered.has(name))
    }
  }
  const accounts = declaredAccounts(repo, wranglerRels)
  return {
    configFile: CLOUDFLARE_APP_FILE,
    wranglerRel,
    wranglerRels,
    outcome,
    production,
    uncovered,
    accounts,
    accountIds: sortedUnique(accounts.map((entry) => entry.accountId)),
    exposureFlags: declaredExposureFlags(repo, wranglerRel),
    declaredExposure: declaredExposure(cloudflareApp),
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
    if (scan.wranglerRels.length === 0) {
      return check(
        '12.4',
        name,
        STATUS_UNKNOWN,
        'nonProductionBranchBuilds is true but no wrangler config was found anywhere in this ' +
          'checkout, so whether a preview would bind production data cannot be decided from it',
      )
    }
    const scanned = scan.wranglerRels.join(', ')
    const offenders = PREVIEW_BINDING_KINDS.flatMap((kind) =>
      scan.uncovered[kind].map((binding) => `${kind}:${binding}`),
    )
    if (offenders.length > 0) {
      return check(
        '12.4',
        name,
        STATUS_FAIL,
        `nonProductionBranchBuilds is true and ${scanned} declare(s) ` +
          `${offenders.length} production binding(s) that deployment.previewBindings does not ` +
          `replace: ${offenders.join(', ')}. A Worker version captures its binding ` +
          `configuration but not the state behind it, and preview_database_id / preview_id / ` +
          `preview_bucket_name apply to "wrangler dev" only -- they do nothing for a Workers ` +
          `Builds preview. As declared, every PR branch of this app would read and write ` +
          `production data. Create a preview resource per binding, list it under ` +
          `deployment.previewBindings, or set nonProductionBranchBuilds to false.`,
        scan.wranglerRel ?? undefined,
      )
    }
    const covered = PREVIEW_BINDING_KINDS.flatMap((kind) => scan.production[kind])
    return check(
      '12.4',
      name,
      STATUS_PASS,
      covered.length === 0
        ? `nonProductionBranchBuilds is true and ${scanned} declare(s) no D1, KV or R2 ` +
            `binding, so a preview has no production state to reach`
        : `every one of the ${covered.length} production D1/KV/R2 binding(s) across ${scanned} ` +
            `has a preview replacement declared`,
      scan.wranglerRel ?? undefined,
    )
  })
}

/**
 * 12.5 -- one Cloudflare account, and the one the app declared.
 *
 * Two questions, not one. The weaker is internal consistency: every wrangler
 * config in the checkout -- the app's own and every second Worker beside it --
 * must agree on the account. The stronger is §2.2's actual ask, that the account
 * "is the Narduk Enterprises account", and it is answerable only when the app
 * names the account it deploys to in `deployment.accountId`. When it does not,
 * the verdict says plainly that the stronger question went unasked rather than
 * letting a consistent-but-personal account read as conformant.
 *
 * TOML counts. Both committed personal-account Workers in the estate are
 * `.toml` files under a services directory, so reading JSON only would make
 * this check not-applicable in exactly the place the defect lives.
 */
function evaluate125(scan: DeploymentScan): FoundationSubCheck {
  const name = 'every wrangler config declares the one declared Cloudflare account'
  const tierTwo =
    'a repository read cannot see a live duplicate Worker on another account serving the same ' +
    'hostname; that is the live check (tier 2)'
  return onlyWhenValid('12.5', name, scan, () => {
    if (scan.outcome.kind !== 'valid') throw new Error('unreachable')
    const declared = scan.outcome.block.accountId ?? null
    const scanned = scan.wranglerRels.join(', ')
    if (scan.wranglerRels.length === 0) {
      return check('12.5', name, STATUS_UNKNOWN, 'no wrangler config found in this checkout')
    }
    const where = (entry: DeclaredAccount): string => `${entry.rel} -> ${entry.accountId}`
    if (declared !== null) {
      const wrong = scan.accounts.filter((entry) => entry.accountId !== declared)
      if (wrong.length > 0) {
        return check(
          '12.5',
          name,
          STATUS_FAIL,
          `deployment.accountId is ${declared}, but ${wrong.length} wrangler declaration(s) name ` +
            `another account: ${wrong.map(where).join(', ')}. A Worker deployed to a second ` +
            `account is invisible to this app's promotion, its rollback and its live proof -- ` +
            `and a deploy against it looks like a deploy that did nothing.`,
          wrong[0].rel,
        )
      }
      return check(
        '12.5',
        name,
        STATUS_PASS,
        scan.accounts.length === 0
          ? `deployment.accountId is ${declared} and no wrangler config in ${scanned} pins an ` +
              `account_id, so the account comes from the environment at deploy time -- ${tierTwo}`
          : `all ${scan.accounts.length} account_id declaration(s) across ${scanned} name ` +
              `deployment.accountId (${declared}) -- ${tierTwo}`,
        scan.wranglerRel ?? undefined,
      )
    }
    // The paved path deliberately omits `account_id`: it comes from
    // CLOUDFLARE_ACCOUNT_ID at deploy time, and the generator refuses to
    // fabricate live account metadata.
    const unasked =
      'deployment.accountId is not declared, so this checks internal consistency ONLY: it does ' +
      'not and cannot decide whether that account is the Narduk Enterprises one. Declare ' +
      'deployment.accountId to have it checked'
    if (scan.accountIds.length === 0) {
      return check(
        '12.5',
        name,
        STATUS_NA,
        `no wrangler config in ${scanned} declares an account_id, so the account comes from the ` +
          `environment at deploy time -- ${unasked}; ${tierTwo}`,
        scan.wranglerRel ?? undefined,
      )
    }
    if (scan.accountIds.length > 1) {
      return check(
        '12.5',
        name,
        STATUS_FAIL,
        `${scan.accounts.length} account_id declaration(s) across ${scanned} name ` +
          `${scan.accountIds.length} different accounts (${scan.accounts.map(where).join(', ')}); ` +
          `one app deploys to one account`,
        scan.accounts[0].rel,
      )
    }
    return check(
      '12.5',
      name,
      STATUS_PASS,
      `every account_id across ${scanned} is ${scan.accountIds[0]} -- ${unasked}; ${tierTwo}`,
      scan.wranglerRel ?? undefined,
    )
  })
}

/**
 * 12.6 -- the app and its wrangler config agree about public exposure.
 *
 * Design §2.2 tier 1: "`preview_urls`/`workers_dev` agree between
 * `Config/cloudflare-app.json` and `wrangler.json`". These are the two flags
 * that decide whether a Worker is reachable outside its own custom domain, and
 * item 1.4 already refuses `true` on an authenticated-public app. This is the
 * other half: whatever the app declared, the config Wrangler actually reads must
 * match it -- including by silence, since Cloudflare's default for both is
 * `true`. An app that records `workersDev: false` in its declaration surface and
 * never says so in wrangler ships a live `*.workers.dev` hostname it believes it
 * does not have.
 */
function evaluate126(scan: DeploymentScan): FoundationSubCheck {
  const name = 'workers_dev and preview_urls agree with the app declaration'
  return onlyWhenValid('12.6', name, scan, () => {
    const keys = EXPOSURE_FLAGS.filter((key) => scan.declaredExposure[key] !== undefined)
    if (keys.length === 0) {
      return check(
        '12.6',
        name,
        STATUS_NA,
        `${CLOUDFLARE_APP_FILE} declares neither worker.workersDev nor worker.previewUrls, so ` +
          `there is nothing for the wrangler config to agree with`,
        scan.configFile,
      )
    }
    if (!scan.wranglerRel) {
      return check('12.6', name, STATUS_UNKNOWN, 'no wrangler config found at a known path')
    }
    const disagreements: string[] = []
    for (const key of keys) {
      const want = scan.declaredExposure[key]
      const set = scan.exposureFlags.filter((flag) => flag.key === key)
      if (set.length === 0) {
        if (want !== WRANGLER_EXPOSURE_DEFAULT) {
          disagreements.push(
            `worker.${EXPOSURE_DECLARATION_KEYS[key]} is ${String(want)} but ${scan.wranglerRel} ` +
              `never sets ${key}, and Cloudflare defaults it to ` +
              `${String(WRANGLER_EXPOSURE_DEFAULT)}`,
          )
        }
        continue
      }
      for (const flag of set) {
        if (flag.value !== want) {
          disagreements.push(
            `worker.${EXPOSURE_DECLARATION_KEYS[key]} is ${String(want)} but ${flag.rel} sets ` +
              `${key}=${String(flag.value)} at ${flag.scope}`,
          )
        }
      }
    }
    if (disagreements.length > 0) {
      return check(
        '12.6',
        name,
        STATUS_FAIL,
        `${disagreements.join('; ')}. Wrangler reads the config, not the declaration: where they ` +
          `disagree the declaration is the one that is wrong about production.`,
        scan.wranglerRel,
      )
    }
    return check(
      '12.6',
      name,
      STATUS_PASS,
      `${keys.map((key) => `${key}=${String(scan.declaredExposure[key])}`).join(', ')} in ` +
        `${scan.wranglerRel} matches ${CLOUDFLARE_APP_FILE}`,
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
    evaluate126(scan),
  ]
}
