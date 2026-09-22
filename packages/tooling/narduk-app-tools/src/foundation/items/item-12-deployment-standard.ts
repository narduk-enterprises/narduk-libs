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
 *
 * **How 12.4 reaches PASS with branch builds on** (narduk-libs#473). A
 * `previewBindings` entry that names its preview resource (KV `id`, D1
 * `database_id` + `database_name`, R2 `bucket_name`) is consumed: `narduk-app
 * deploy versions-upload` on a non-production branch uploads with
 * `.wrangler.deploy.preview.json`, every binding rebound. 12.4 runs the same
 * planner (`planPreviewConfig`) against the app's own config, so its PASS
 * describes the config the build would upload, not the declaration. A bare
 * binding name is still only a declaration (narduk-libs#451 defect 4): the
 * build cannot rebind it and uploads production bindings, so that path stays
 * UNKNOWN ("declared, not enforced"). A green sub-check must never stand for an
 * isolation that does not exist.
 */

import { posix } from 'node:path'

import { flattenWranglerDeployConfig } from '../../deploy.js'
import {
  DEPLOYMENT_STANDARD,
  PREVIEW_BINDING_KINDS,
  STANDARD_DEPLOY_COMMAND,
  BUILD_VERSION_HEADER,
  previewBindingName,
  readDeploymentBlock,
  type DeploymentBlock,
  type DeploymentBlockOutcome,
  type PreviewBindingKind,
} from '../../deployment-config.js'
import {
  describePreviewPlan,
  planPreviewConfig,
  PREVIEW_CONFIG_FILENAME,
  type PreviewConfigPlan,
} from '../../preview-config.js'
import {
  contractEvidenceIssues,
  contractOwnedBindings,
  ownershipCoverageIssues,
  type DatabaseOwnershipEntry,
} from '../../database-ownership.js'
import {
  findDestructiveStatements,
  type DestructiveStatement,
} from '../../migration-compatibility.js'
import {
  checksumMigrationSql,
  isAppSource,
  MIGRATION_FILENAME,
  parseMigrationConfig,
} from '../../migrations.js'
import { check } from '../schema.js'
import {
  allDeps,
  collectPackages,
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
  'deployment.previewBindings isolates a preview only when every entry names its preview ' +
    'resource: narduk-app deploy versions-upload then uploads a non-production branch with ' +
    `${PREVIEW_CONFIG_FILENAME}, and 12.4 checks that exact config. A bare binding name is a ` +
    'declaration the build cannot act on, so the preview keeps production bindings and 12.4 ' +
    'reports UNKNOWN (narduk-libs#451, #473). A repository read cannot prove the preview ' +
    'resources exist on Cloudflare.',
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

/* -------------------------------------------------------------------------- */
/* Workers Cache (12.7, narduk-libs#435)                                        */
/* -------------------------------------------------------------------------- */

export const NARDUK_CORE_PACKAGE = '@narduk-enterprises/narduk-core'

/**
 * The first narduk-core that keeps every response Workers Cache must not store
 * out of it: thrown 4xx/5xx/429 are `private, no-store` (#429, 2.2.3),
 * preference-shaped responses are (#427/#386), SSR HTML under a nonce CSP is
 * (#435, 2.2.4), a route with no posture is private (2.5.0), and a thrown error
 * answered as JSON is too (#493, 2.10.0). Below this, `"cache": { "enabled":
 * true }` stores Nitro's `no-cache` API errors, and older still replays one
 * visitor's CSP nonce to everyone.
 */
export const EDGE_CACHE_MIN_NARDUK_CORE = '2.10.0'

/** One scope of one wrangler config that turns Workers Cache on. */
export interface EdgeCacheSwitch {
  rel: string
  scope: string
}

export function edgeCacheScopesFromJson(config: unknown): string[] {
  const out: string[] = []
  for (const [prefix, scope] of wranglerScopes(config)) {
    const cache = scope.cache
    if (isRecord(cache) && cache.enabled === true) {
      out.push(prefix === '' ? '(top level)' : prefix)
    }
  }
  return out
}

/** `[cache]` / `[env.<name>.cache]` tables with `enabled = true`. */
export function edgeCacheScopesFromToml(text: string): string[] {
  const out: string[] = []
  let table = ''
  for (const line of text.split(/\r?\n/u)) {
    const header = /^\s*\[\[?([^\]]+)\]\]?\s*$/u.exec(line)
    if (header) {
      table = header[1].trim()
      continue
    }
    if (!/^\s*enabled\s*=\s*true\b/u.test(line)) continue
    if (table === 'cache') out.push('(top level)')
    else if (/^env\.[^.]+\.cache$/u.test(table)) out.push(table.slice(0, -'.cache'.length))
  }
  return out
}

export function edgeCacheSwitches(repo: AppRepo, rels: readonly string[]): EdgeCacheSwitch[] {
  const out: EdgeCacheSwitch[] = []
  for (const rel of rels) {
    const text = repo.read(rel)
    if (text === null) continue
    const scopes = rel.endsWith('.toml')
      ? edgeCacheScopesFromToml(text)
      : edgeCacheScopesFromJson(parseJson(text))
    for (const scope of scopes) out.push({ rel, scope })
  }
  return out
}

/** Where narduk-core is declared, and with what spec. First package.json wins. */
export function declaredNardukCore(repo: AppRepo): { rel: string; spec: string } | null {
  for (const { rel, pkg } of collectPackages(repo)) {
    const spec = allDeps(pkg)[NARDUK_CORE_PACKAGE]
    if (spec) return { rel, spec }
  }
  return null
}

/**
 * The lowest version a dependency spec can resolve to, or null when the spec
 * does not name one (`workspace:*`, a git URL, a tag). Item 2.2 already holds
 * estate packages to exact pins, so in practice this is the pin itself.
 */
export function specFloor(spec: string): [number, number, number] | null {
  const match = /^\s*(?:[=^~]|>=)?v?(\d+)\.(\d+)\.(\d+)/u.exec(spec)
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function atLeast(version: [number, number, number], minimum: string): boolean {
  const floor = minimum.split('.').map(Number)
  for (let index = 0; index < 3; index += 1) {
    if (version[index] !== floor[index]) return version[index] > floor[index]
  }
  return true
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
  /** `previewBindings` entries that name no production binding of their kind
   * -- a typo, or a binding since removed. Same condition as `uncovered`. */
  stale: BindingsByKind
  /** What a non-production branch build would upload. Null unless the block is
   * valid AND non-production branch builds are on. */
  preview: PreviewScan | null
  /** Every `account_id` declaration in the checkout, with its file. */
  accounts: DeclaredAccount[]
  /** The distinct account ids among them. */
  accountIds: string[]
  /** `workers_dev` / `preview_urls` as the app's own wrangler config sets them. */
  exposureFlags: DeclaredFlag[]
  /** `worker.workersDev` / `worker.previewUrls` from Config/cloudflare-app.json. */
  declaredExposure: Partial<Record<ExposureFlag, boolean>>
  /** Every wrangler scope that sets `cache.enabled: true` (12.7). */
  edgeCache: EdgeCacheSwitch[]
  /** The app's narduk-core dependency, if it declares one (12.7). */
  nardukCore: { rel: string; spec: string } | null
  migrationSources?: Array<{ binding: string; path: string; exists: boolean }>
  /** `deployment.databaseOwnership`, when the block is valid and declares it. */
  databaseOwnership?: DatabaseOwnershipEntry[] | null
  /** Contract-owned entries naming a file or verify script that is not there. */
  ownershipEvidence?: string[]
  /** What 12.9 reads: the app-owned migration SQL the declared manifests name. */
  migrationCompatibility?: MigrationCompatibilityScan | null
}

export interface MigrationFileScan {
  /** Checkout-relative path. */
  rel: string
  /** The checksum the migration ledger records for this file. */
  sha256: string
  destructive: DestructiveStatement[]
}

export interface MigrationCompatibilityScan {
  /** Every app-owned migration file, once, in path order. */
  files: MigrationFileScan[]
  /** Package-owned sources, `binding: source`. Their SQL ships in a package
   * and is not this checkout's to review. */
  packageSources: string[]
  /** Manifests or directories this read could not follow, with why. */
  unreadable: string[]
}

export interface PreviewScan {
  /** Why the build's generator cannot cover this checkout's bindings. When any
   * exist, `plan` is null: a partial answer would read as a whole one. */
  blockers: string[]
  plan: PreviewConfigPlan | null
}

/**
 * Plans the preview config exactly as `narduk-app deploy versions-upload` does:
 * the app's own JSON/JSONC config, flattened the way the build flattens it, with
 * every scope of that config counted as production for the reuse check.
 */
export function scanPreview(
  repo: AppRepo,
  wranglerRel: string | null,
  wranglerRels: readonly string[],
  previewBindings: DeploymentBlock['previewBindings'],
): PreviewScan {
  const blockers: string[] = []
  if (!wranglerRel) {
    blockers.push('the app has no wrangler config of its own for narduk-app deploy to rewrite')
  } else if (wranglerRel.endsWith('.toml')) {
    blockers.push(
      `${wranglerRel} is TOML, and narduk-app deploy reads wrangler.json or wrangler.jsonc only`,
    )
  }
  for (const rel of wranglerRels) {
    if (rel === wranglerRel) continue
    const bound = productionBindings(repo, rel)
    const names = PREVIEW_BINDING_KINDS.flatMap((kind) => bound[kind].map((b) => `${kind}:${b}`))
    if (names.length > 0) {
      blockers.push(
        `${rel} binds ${names.join(', ')}, and the preview generator rewrites only the app's own ` +
          `config${wranglerRel ? ` (${wranglerRel})` : ''}`,
      )
    }
  }
  if (blockers.length > 0 || !wranglerRel) return { blockers, plan: null }
  const raw = parseJson(repo.read(wranglerRel))
  if (!isRecord(raw)) {
    return { blockers: [`${wranglerRel} could not be parsed`], plan: null }
  }
  const deployConfig = flattenWranglerDeployConfig(raw) as Record<string, unknown>
  return { blockers, plan: planPreviewConfig(deployConfig, previewBindings, [raw]) }
}

/** A checkout-relative path, normalised, or null when it leaves the checkout. */
function checkoutRel(path: string): string | null {
  if (posix.isAbsolute(path)) return null
  const normalised = posix.normalize(path)
  return normalised === '..' || normalised.startsWith('../') ? null : normalised
}

/**
 * Reads every app-owned migration the declared source manifests name, the way
 * `discoverMigrations` finds them, and classifies each statement (12.9).
 */
export function scanMigrationCompatibility(
  repo: AppRepo,
  databases: ReadonlyArray<{ binding: string; sources: string }>,
): MigrationCompatibilityScan {
  const files = new Map<string, MigrationFileScan>()
  const packageSources: string[] = []
  const unreadable: string[] = []
  for (const database of databases) {
    const manifestRel = checkoutRel(database.sources)
    const text = manifestRel === null ? null : repo.read(manifestRel)
    if (manifestRel === null || text === null) {
      unreadable.push(`${database.binding}: ${database.sources} is not a file in this checkout`)
      continue
    }
    let sources
    try {
      sources = parseMigrationConfig(parseJson(text)).sources
    } catch (error) {
      unreadable.push(`${database.binding}: ${manifestRel}: ${(error as Error).message}`)
      continue
    }
    for (const source of sources) {
      if (!isAppSource(source.source)) {
        packageSources.push(`${database.binding}: ${source.source}`)
        continue
      }
      const directory = checkoutRel(posix.join(posix.dirname(manifestRel), source.path))
      if (directory === null) {
        unreadable.push(
          `${database.binding}: source ${source.source} directory ${source.path} leaves the checkout`,
        )
        continue
      }
      // A missing directory holds no migrations: nothing to classify. The
      // runner refuses it at migrate time; this rule has nothing to say.
      if (!repo.exists(directory)) continue
      for (const rel of repo.walk(directory, ['.sql'], 0)) {
        if (files.has(rel) || !MIGRATION_FILENAME.test(posix.basename(rel))) continue
        const sql = repo.read(rel)
        if (sql === null) continue
        files.set(rel, {
          rel,
          sha256: checksumMigrationSql(sql),
          destructive: findDestructiveStatements(sql),
        })
      }
    }
  }
  return {
    files: [...files.values()].sort((left, right) => left.rel.localeCompare(right.rel)),
    packageSources,
    unreadable,
  }
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
  const stale = emptyBindings()
  let preview: PreviewScan | null = null
  if (outcome.kind === 'valid' && outcome.block.nonProductionBranchBuilds) {
    for (const kind of PREVIEW_BINDING_KINDS) {
      const declared = outcome.block.previewBindings[kind].map(previewBindingName)
      const covered = new Set(declared)
      const bound = new Set(production[kind])
      uncovered[kind] = production[kind].filter((name) => !covered.has(name))
      stale[kind] = sortedUnique(declared.filter((name) => !bound.has(name)))
    }
    preview = scanPreview(repo, wranglerRel, wranglerRels, outcome.block.previewBindings)
  }
  const accounts = declaredAccounts(repo, wranglerRels)
  return {
    configFile: CLOUDFLARE_APP_FILE,
    wranglerRel,
    wranglerRels,
    outcome,
    production,
    uncovered,
    stale,
    preview,
    accounts,
    accountIds: sortedUnique(accounts.map((entry) => entry.accountId)),
    exposureFlags: declaredExposureFlags(repo, wranglerRel),
    declaredExposure: declaredExposure(cloudflareApp),
    edgeCache: edgeCacheSwitches(repo, wranglerRels),
    nardukCore: declaredNardukCore(repo),
    migrationSources:
      outcome.kind === 'valid'
        ? (outcome.block.migrations?.databases ?? []).map((entry) => ({
            binding: entry.binding,
            path: entry.sources,
            exists: repo.read(entry.sources) !== null,
          }))
        : [],
    migrationCompatibility:
      outcome.kind === 'valid' && outcome.block.migrations
        ? scanMigrationCompatibility(repo, outcome.block.migrations.databases)
        : null,
    databaseOwnership: outcome.kind === 'valid' ? (outcome.block.databaseOwnership ?? null) : null,
    ownershipEvidence:
      outcome.kind === 'valid' && outcome.block.databaseOwnership
        ? contractEvidenceIssues({
            entries: outcome.block.databaseOwnership,
            read: (rel) => repo.read(rel),
            packageJsonRels: collectPackages(repo).map((found) => found.rel),
          })
        : [],
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
          `production data. Create a preview resource per binding and name it under ` +
          `deployment.previewBindings (KV "id", D1 "database_id" and "database_name", R2 ` +
          `"bucket_name"), or set nonProductionBranchBuilds to false.`,
        scan.wranglerRel ?? undefined,
      )
    }
    const stale = PREVIEW_BINDING_KINDS.flatMap((kind) =>
      scan.stale[kind].map((binding) => `${kind}:${binding}`),
    )
    if (stale.length > 0) {
      return check(
        '12.4',
        name,
        STATUS_FAIL,
        `deployment.previewBindings names ${stale.join(', ')}, which no wrangler config in ` +
          `${scanned} binds under that kind. A preview entry must carry the exact name of the ` +
          `production binding it replaces; a name that matches nothing replaces nothing, and ` +
          `usually means a typo or a binding since removed.`,
        scan.configFile,
      )
    }
    const covered = PREVIEW_BINDING_KINDS.flatMap((kind) => scan.production[kind])
    if (covered.length === 0) {
      // Nothing to isolate: the verdict rests on the wrangler configs alone.
      return check(
        '12.4',
        name,
        STATUS_PASS,
        `nonProductionBranchBuilds is true and ${scanned} declare(s) no D1, KV or R2 ` +
          `binding, so a preview has no production state to reach`,
        scan.wranglerRel ?? undefined,
      )
    }
    const preview = scan.preview
    if (!preview || preview.blockers.length > 0 || !preview.plan) {
      return check(
        '12.4',
        name,
        STATUS_UNKNOWN,
        `nonProductionBranchBuilds is true and deployment.previewBindings covers every ` +
          `production D1/KV/R2 binding by name, but narduk-app deploy cannot generate a preview ` +
          `config for all of them: ${(preview?.blockers ?? ['no preview scan']).join('; ')}. ` +
          `Those bindings are declared, not enforced: a branch build still reaches the ` +
          `production resource.`,
        scan.wranglerRel ?? undefined,
      )
    }
    const { plan } = preview
    if (plan.status === 'unsafe' || plan.status === 'uncovered') {
      return check(
        '12.4',
        name,
        STATUS_FAIL,
        `nonProductionBranchBuilds is true and ${describePreviewPlan(plan)}. A preview bound ` +
          `to that resource reads and writes production data, so narduk-app deploy refuses to ` +
          `rebind it and uploads the production config instead. Point each entry at a resource ` +
          `created for previews.`,
        scan.configFile,
      )
    }
    if (plan.status === 'declared-only') {
      // narduk-libs#451 defect 4: a bare name is a declaration the build cannot
      // act on, so the runtime is identical to declaring nothing.
      return check(
        '12.4',
        name,
        STATUS_UNKNOWN,
        `nonProductionBranchBuilds is true and ${describePreviewPlan(plan)}, so narduk-app ` +
          `deploy cannot build ${PREVIEW_CONFIG_FILENAME} and a branch build uploads with ` +
          `.wrangler.deploy.production.json -- every binding still resolves to the production ` +
          `resource. This sub-check therefore reports "declared, not enforced": it is ` +
          `unproven, not safe. Add each preview resource to its entry, or set ` +
          `nonProductionBranchBuilds to false.`,
        scan.configFile,
      )
    }
    if (plan.status === 'no-bindings') {
      return check(
        '12.4',
        name,
        STATUS_PASS,
        `nonProductionBranchBuilds is true and the config a branch build uploads (` +
          `${scan.wranglerRel ?? 'the app config'}, flattened) binds no D1, KV or R2 binding`,
        scan.wranglerRel ?? undefined,
      )
    }
    return check(
      '12.4',
      name,
      STATUS_PASS,
      `nonProductionBranchBuilds is true and narduk-app deploy versions-upload uploads a ` +
        `non-production branch with ${PREVIEW_CONFIG_FILENAME}, which rebinds all ` +
        `${plan.rebound.length} D1/KV/R2 binding(s) to resources that are not production ones: ` +
        `${plan.rebound.join(', ')}`,
      scan.configFile,
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

/**
 * 12.7 -- Workers Cache is on only against a narduk-core that keeps
 * uncacheable responses out of it (narduk-libs#435).
 *
 * Not gated on a valid `deployment` block, and not softened by rollout mode:
 * like 12.4, the failure is live data crossing between visitors -- a stored
 * `no-cache` error page, or one visitor's CSP nonce replayed to everyone --
 * not a missing declaration. What it cannot see: whether the running Worker
 * actually HITs. That is `narduk-app verify --live --edge-cache-path`.
 */
function evaluate127(scan: DeploymentScan): FoundationSubCheck {
  const name = 'Workers Cache enabled only on a narduk-core with the no-store guards'
  if (scan.edgeCache.length === 0) {
    return check(
      '12.7',
      name,
      STATUS_NA,
      'no wrangler config sets "cache": { "enabled": true }, so Cloudflare runs the Worker on ' +
        'every request and setCacheProfile edge headers (CDN-Cache-Control, Cache-Tag) are inert',
      scan.wranglerRel ?? undefined,
    )
  }
  const where = scan.edgeCache.map((entry) => `${entry.rel} ${entry.scope}`).join(', ')
  const core = scan.nardukCore
  if (!core) {
    return check(
      '12.7',
      name,
      STATUS_UNKNOWN,
      `Workers Cache is on (${where}) but no package.json declares ${NARDUK_CORE_PACKAGE}, so ` +
        `nothing proves thrown errors and nonce-CSP HTML ship private, no-store`,
      scan.edgeCache[0].rel,
    )
  }
  const floor = specFloor(core.spec)
  if (!floor) {
    return check(
      '12.7',
      name,
      STATUS_UNKNOWN,
      `Workers Cache is on (${where}) and ${core.rel} declares ${NARDUK_CORE_PACKAGE} as ` +
        `${JSON.stringify(core.spec)}, which names no version to compare with ` +
        `${EDGE_CACHE_MIN_NARDUK_CORE}`,
      core.rel,
    )
  }
  if (!atLeast(floor, EDGE_CACHE_MIN_NARDUK_CORE)) {
    return check(
      '12.7',
      name,
      STATUS_FAIL,
      `Workers Cache is on (${where}) but ${core.rel} resolves ${NARDUK_CORE_PACKAGE} ` +
        `${core.spec}, older than ${EDGE_CACHE_MIN_NARDUK_CORE}. That core lets Cloudflare store ` +
        `thrown 4xx/5xx/429 (Nitro's no-cache, narduk-libs#429, and on JSON routes #493) and ` +
        `nonce-CSP SSR HTML (narduk-libs#435). Upgrade narduk-core or turn the cache block off.`,
      core.rel,
    )
  }
  return check(
    '12.7',
    name,
    STATUS_PASS,
    `Workers Cache is on (${where}) with ${NARDUK_CORE_PACKAGE} ${core.spec} >= ` +
      `${EDGE_CACHE_MIN_NARDUK_CORE}. A route of the app's own that writes a response without ` +
      `Cache-Control is still stored (a 200 for 2 hours, by Cloudflare's heuristic), so every ` +
      `route needs a posture (docs/workers-cache.md). This is a repository read: prove a real ` +
      `HIT with ` +
      `narduk-app verify --live <production-url> --edge-cache-path <live-route>`,
    scan.edgeCache[0].rel,
  )
}

function evaluate128(scan: DeploymentScan): FoundationSubCheck {
  const name = 'D1 deployment migration ownership is declared'
  return onlyWhenValid('12.8', name, scan, () => {
    if (scan.production.d1.length === 0)
      return check('12.8', name, STATUS_NA, 'No D1 bindings declared')
    if (scan.outcome.kind !== 'valid') throw new Error('unreachable')
    const { migrations, promotion, databaseOwnership } = scan.outcome.block
    const ownership = databaseOwnership ?? null
    const sources = scan.migrationSources ?? []
    // The same rule `planDeploymentMigrations` refuses on, so a green 12.8 and
    // a runnable migration plan can never disagree about who owns a schema.
    const coverage = ownershipCoverageIssues({
      bindings: scan.production.d1,
      ownership,
      migrated: sources.map((source) => source.binding),
      hasMigrationsBlock: Boolean(migrations),
    })
    if (coverage.length > 0) {
      return check(
        '12.8',
        name,
        STATUS_FAIL,
        `Every D1 binding needs exactly one schema owner: a deployment.migrations entry with ` +
          `expand-contract compatibility and a source manifest, or a deployment.databaseOwnership ` +
          `entry declaring it contract-owned. ${coverage.join('; ')}`,
        scan.configFile,
      )
    }
    const evidence = scan.ownershipEvidence ?? []
    if (evidence.length > 0) {
      return check(
        '12.8',
        name,
        STATUS_FAIL,
        `A contract-owned database is only declared if its contract and its verification ` +
          `command exist: ${evidence.join('; ')}`,
        scan.configFile,
      )
    }
    if (
      migrations &&
      (!migrations.credential.startsWith('cloudflare/') ||
        migrations.credential === promotion.credential)
    ) {
      return check(
        '12.8',
        name,
        STATUS_FAIL,
        'Migration and promotion must name different Cloudflare credential selectors',
        scan.configFile,
      )
    }
    if (sources.some((source) => !source.exists)) {
      return check(
        '12.8',
        name,
        STATUS_FAIL,
        `Every migration-owned D1 binding requires an existing source manifest; missing: ` +
          `${sources
            .filter((source) => !source.exists)
            .map((source) => `${source.binding} -> ${source.path}`)
            .join(', ')}`,
        scan.configFile,
      )
    }
    const contract = ownership ? [...contractOwnedBindings(ownership)] : []
    const contractNote =
      contract.length > 0
        ? ` ${contract.join(', ')} is contract-owned and is never migrated: the migration runner ` +
          `refuses it even when asked directly, and its schema is proved by the declared ` +
          `verification command, not by this ledger.`
        : ''
    return check(
      '12.8',
      name,
      STATUS_PASS,
      `D1 schema ownership declared for every binding.${contractNote} Remote parity is NOT ` +
        `proven here: run db migrate-deployment --target production --check before promotion; ` +
        `preview readiness requires its own target check.`,
      scan.configFile,
    )
  })
}

/** How many offending statements a verdict lists before summarising the rest. */
const LISTED_STATEMENTS = 10

const DESTRUCTIVE_WORDING: Record<DestructiveStatement['kind'], string> = {
  'drop-table': 'drops table',
  'drop-view': 'drops view',
  'drop-column': 'drops a column of',
  'rename-table': 'renames table',
  'rename-column': 'renames a column of',
}

/** 12.9 -- declared expand-contract migrations are expand-only (#399). */
function evaluate129(scan: DeploymentScan): FoundationSubCheck {
  const name = 'D1 migrations are expand-only, or a reviewed contract migration'
  return onlyWhenValid('12.9', name, scan, () => {
    if (scan.outcome.kind !== 'valid') throw new Error('unreachable')
    const migrations = scan.outcome.block.migrations
    const read = scan.migrationCompatibility
    if (!migrations || !read) {
      return check('12.9', name, STATUS_NA, 'No deployment.migrations declared', scan.configFile)
    }
    if (read.unreadable.length > 0) {
      return check(
        '12.9',
        name,
        STATUS_UNKNOWN,
        `Could not read every declared migration source, so the rule is unchecked: ` +
          `${read.unreadable.join('; ')}`,
        scan.configFile,
      )
    }
    const byRel = new Map(read.files.map((file) => [file.rel, file]))
    const waived = new Set<string>()
    const stale: string[] = []
    for (const waiver of migrations.contractMigrations ?? []) {
      const rel = checkoutRel(waiver.path)
      const file = rel === null ? undefined : byRel.get(rel)
      if (!file) {
        stale.push(`${waiver.path} is not an app migration file any declared source names`)
      } else if (file.sha256 !== waiver.sha256) {
        stale.push(
          `${waiver.path} no longer has the reviewed checksum (now ${file.sha256}); applied ` +
            `migration SQL is immutable, so review the change and pin the new checksum`,
        )
      } else if (file.destructive.length === 0) {
        stale.push(`${waiver.path} drops and renames nothing, so it needs no waiver`)
      } else {
        waived.add(file.rel)
      }
    }
    const offending = read.files.filter(
      (file) => file.destructive.length > 0 && !waived.has(file.rel),
    )
    if (offending.length > 0 || stale.length > 0) {
      const statements = offending.flatMap((file) =>
        file.destructive.map(
          (found) => `${file.rel}:${found.line} ${DESTRUCTIVE_WORDING[found.kind]} ${found.object}`,
        ),
      )
      const listed = statements.slice(0, LISTED_STATEMENTS)
      if (statements.length > listed.length) {
        listed.push(`and ${statements.length - listed.length} more`)
      }
      const parts: string[] = []
      if (offending.length > 0) {
        const waivers = offending.map((file) => ({
          path: file.rel,
          sha256: file.sha256,
          reason: '<why no serving or rollback-target version still reads it>',
        }))
        parts.push(
          `deployment.migrations declares expand-contract, but these statements remove or ` +
            `rename what the serving Worker or a rollback target may still read: ` +
            `${listed.join('; ')}. \`narduk-app deploy rollback\` restores code, never a ` +
            `schema. Expand instead (add, backfill, switch code), or, once no version inside ` +
            `the rollback window reads it, declare the file a reviewed contract migration under ` +
            `deployment.migrations.contractMigrations: ${JSON.stringify(waivers)}`,
        )
      }
      if (stale.length > 0)
        parts.push(`Contract-migration waivers that cover nothing: ${stale.join('; ')}`)
      return check('12.9', name, STATUS_FAIL, parts.join(' '), scan.configFile)
    }
    const waivedNote =
      waived.size > 0
        ? ` ${waived.size} reviewed contract migration(s) are waived by checksum.`
        : ''
    const packageNote =
      read.packageSources.length > 0
        ? ` Package-owned sources are not read here (${read.packageSources.join(', ')}).`
        : ''
    return check(
      '12.9',
      name,
      STATUS_PASS,
      `${read.files.length} app migration file(s) drop and rename nothing.${waivedNote}` +
        `${packageNote} This is a statement classifier: a data rewrite or a new constraint ` +
        `the previous code cannot satisfy is not detected.`,
      scan.configFile,
    )
  })
}

/** 12.10 -- the declared rollback mode is one something honours (#399). */
function evaluate1210(scan: DeploymentScan): FoundationSubCheck {
  const name = 'declared rollback mode is the one that runs'
  return onlyWhenValid('12.10', name, scan, () => {
    if (scan.outcome.kind !== 'valid') throw new Error('unreachable')
    if (scan.outcome.block.rollback.mode === 'auto') {
      return check(
        '12.10',
        name,
        STATUS_FAIL,
        `deployment.rollback.mode is "auto", but nothing reads it: no tool rolls back on its ` +
          `own. A rollback happens only when a person, or a step the app wrote into its own ` +
          `promote job, runs \`narduk-app deploy rollback\`; a failed migration triggers ` +
          `nothing, and no database is ever restored. Set "mode": "manual".`,
        scan.configFile,
      )
    }
    return check(
      '12.10',
      name,
      STATUS_PASS,
      "Rollback is manual: `narduk-app deploy rollback` runs only when a person or the app's " +
        'own promote step invokes it, and it never restores a database.',
      scan.configFile,
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
    evaluate127(scan),
    evaluate128(scan),
    evaluate129(scan),
    evaluate1210(scan),
  ]
}
