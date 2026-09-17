/**
 * `narduk-app deploy versions-promote` and `narduk-app deploy rollback`
 * -- the promote half of the Narduk deployment standard (deployment-standard
 * design §1.5, §6.1, §6.3; company-hq#745).
 *
 * The standard is "Cloudflare builds, GitHub promotes": Workers Builds runs
 * `wrangler versions upload` on every branch, so a push produces a version that
 * serves no traffic, and a GitHub Actions job deploys that exact version at
 * 100% only after `ci / Required` is green on that exact main SHA.
 *
 * HOW A COMMIT IS LINKED TO A VERSION -- verified, and not what the design assumed
 * -------------------------------------------------------------------------------
 * The design's §6.1 pseudocode reads "the version whose upload annotation/commit
 * == $GITHUB_SHA". No such field exists. Read live on 2026-09-17 against the
 * deployed `buoys` Worker:
 *
 *   wrangler versions list --name buoys --json
 *   -> metadata: { created_on, source: "wrangler", author_id, author_email, has_preview }
 *      annotations: { "workers/alias": "...", "workers/triggered_by": "version_upload" }
 *
 * There is no commit SHA anywhere in a version, and Cloudflare's own Versions
 * API reference documents no annotation fields at all. So the link is not
 * discovered -- it is *made*: `wrangler versions upload --tag <sha>` writes
 * `annotations["workers/tag"]`, which is the only commit-shaped handle a
 * version can carry. `narduk-app deploy versions-upload` now sets that tag
 * automatically from `WORKERS_CI_COMMIT_SHA` inside a Workers Build (see
 * `./deploy.ts`), and this module resolves a SHA back to a version id by
 * reading it.
 *
 * KNOWN WINDOW: `wrangler versions list` returns the 10 most recent versions
 * and takes no paging flag (`wrangler versions list --help`, wrangler 4.133.0).
 * On a repository with many branch builds a main version can fall out of that
 * window before the promote job runs. That is reported as its own outcome --
 * `version-not-found`, with the number of versions actually searched -- rather
 * than as a generic failure, because the remedy (re-run the build, or promote
 * by explicit `--version-id`) is different.
 *
 * WHY THIS GUARD IS NOT `isWorkersBuildDeployAllowed`
 * ---------------------------------------------------
 * That guard requires `WORKERS_CI*`, i.e. it refuses to run anywhere except
 * inside a Cloudflare build. A promote runs in GitHub Actions, where none of
 * those are set, so reusing it would force every promote through the
 * `NARDUK_ALLOW_LOCAL_WRANGLER_DEPLOY=1` escape hatch -- which would quietly
 * license local production deploys estate-wide. Promotion carries its own
 * Actions-context guard with its own, separate override
 * (`NARDUK_ALLOW_MANUAL_PROMOTE=1`) for deliberate recovery work.
 */

import { spawnSync } from 'node:child_process'

import { readJsonc, resolveWranglerConfigPath } from './deploy.js'

import type { DeployEnv } from './deploy.js'

export type PromoteAction = 'versions-promote' | 'rollback'

/**
 * A Worker version as `wrangler versions list --json` returns it.
 *
 * `number` is Cloudflare's own "sequential version number" (Versions list API
 * reference, read 2026-09-17) and is what orders two versions of the same
 * Worker. `metadata.created_on` was read live off `buoys` the same day and is
 * the fallback when a payload carries no `number`; the ordering guard refuses
 * rather than guesses when neither can order a pair.
 */
export interface WorkerVersion {
  id: string
  number?: number
  metadata?: {
    created_on?: string
    source?: string
    author_email?: string
    has_preview?: boolean
  }
  annotations?: Record<string, string>
}

/** A deployment as `wrangler deployments list --json` returns it. */
export interface WorkerDeployment {
  id: string
  source?: string
  strategy?: string
  created_on?: string
  annotations?: Record<string, string>
  versions: Array<{ version_id: string; percentage: number }>
}

/** The annotation key `wrangler versions upload --tag` writes. */
export const VERSION_TAG_ANNOTATION = 'workers/tag'
export const TRIGGERED_BY_ANNOTATION = 'workers/triggered_by'
export const VERSION_MESSAGE_ANNOTATION = 'workers/message'
/** Prefix this tool puts on every rollback deployment message, so a later
 * rollback can recognise one it made and refuse to roll *forward*. */
export const ROLLBACK_MESSAGE_PREFIX = 'narduk-app rollback'

/**
 * Distinct exit codes, so a workflow step can branch on the failure class.
 *
 * The split that matters to a promote job is 1/2 versus 5: a `refused` or
 * `usage` exit means nothing was attempted and production is untouched, while
 * `wranglerFailed` means a `versions deploy` or `rollback` was in flight when it
 * died and the traffic state is unknown. A workflow that cannot tell those
 * apart must either ignore a real half-applied deploy or roll production back
 * every time a flag is mistyped. Every code here is reachable and tested
 * (`tests/promote.test.ts`, "every documented exit code is reachable").
 */
export const PROMOTE_EXIT = {
  ok: 0,
  /** The Actions/branch/event guard refused. Nothing was attempted. */
  refused: 1,
  /** Bad arguments or unresolvable Worker name. Nothing was attempted. */
  usage: 2,
  /** No version carries this commit's tag inside the searched window. */
  versionNotFound: 3,
  /** More than one version carries this commit's tag. */
  ambiguousVersion: 4,
  /** Wrangler itself failed. Traffic state unknown if it died mid-deploy. */
  wranglerFailed: 5,
  /** The rollback target is already the live version, or cannot be resolved safely. */
  rollbackRefused: 6,
  /** The target version is older than the one already serving production. */
  stalePromote: 7,
  /** The target version was not built from the production branch. */
  branchMismatch: 8,
} as const

const TRUTHY = new Set(['1', 'true', 'yes', 'on'])
const SHA_PATTERN = /^[a-f\d]{7,64}$/iu

function isTruthy(value: string | undefined): boolean {
  return Boolean(value && TRUTHY.has(value.trim().toLowerCase()))
}

/**
 * The promote override. Separate from `NARDUK_ALLOW_LOCAL_WRANGLER_DEPLOY` on
 * purpose: one of them licenses a local *build* deploy, the other licenses a
 * production promotion, and an operator should never grant the second by
 * reaching for the first.
 */
export function isManualPromoteAllowed(env: DeployEnv = process.env): boolean {
  return isTruthy(env.NARDUK_ALLOW_MANUAL_PROMOTE)
}

/**
 * True only inside a GitHub Actions run. `GITHUB_ACTIONS` alone is trivially
 * forgeable locally, so this also wants the run identity that a real Actions
 * job always has -- the same shape of attestation `isWorkersBuildDeployAllowed`
 * demands of a Cloudflare build.
 *
 * WHAT THIS DOES NOT PROVE: that `ci / Required` is green on this commit. That
 * is an assertion about GitHub's check state, and reading it needs a token this
 * command is deliberately never given. The workflow step ordering is what
 * supplies it; this guard proves only the execution context.
 */
export function isActionsPromoteAllowed(env: DeployEnv = process.env): boolean {
  return (
    isTruthy(env.CI) &&
    isTruthy(env.GITHUB_ACTIONS) &&
    Boolean(env.GITHUB_RUN_ID?.trim()) &&
    Boolean(env.GITHUB_REPOSITORY?.trim()) &&
    Boolean(env.GITHUB_WORKFLOW?.trim())
  )
}

/**
 * The Actions events that may promote. A `pull_request` or
 * `pull_request_target` run carries a contributor's ref, so a workflow holding
 * the promote credential must not be reachable from one; anything unrecognised
 * is refused rather than assumed benign.
 */
export const PROMOTE_EVENTS = new Set([
  'push',
  'workflow_run',
  'workflow_dispatch',
  'repository_dispatch',
  'schedule',
  'release',
])

export type ContextRefusal = { reason: string } | null

/**
 * The ref and event half of the guard, separate from the "are we in Actions"
 * half because it is the half that is opt-in: it can only compare against a
 * production branch the caller names (`--production-branch`, or
 * `NARDUK_PROMOTE_PRODUCTION_BRANCH`, which `Config/cloudflare-app.json`
 * supplies through the workflow). Without one, no ref comparison is possible
 * and the command says so rather than implying it made one.
 */
export function checkPromoteContext(
  env: DeployEnv,
  productionBranch: string | null,
): ContextRefusal {
  const event = env.GITHUB_EVENT_NAME?.trim()
  if (event && !PROMOTE_EVENTS.has(event)) {
    return {
      reason:
        `refusing to promote from a ${event} event. A workflow holding the promote ` +
        `credential must run on one of: ${[...PROMOTE_EVENTS].sort().join(', ')}.`,
    }
  }
  if (!productionBranch) return null
  const ref = env.GITHUB_REF_NAME?.trim()
  if (!ref) {
    return {
      reason:
        `--production-branch ${productionBranch} was declared but GITHUB_REF_NAME is not set, ` +
        'so the ref this run carries cannot be confirmed. Run the promote from GitHub Actions, ' +
        'or drop --production-branch to promote without a ref check.',
    }
  }
  if (ref !== productionBranch) {
    return {
      reason:
        `this run is on ref ${ref}, not the declared production branch ${productionBranch}. ` +
        'Production is promoted from the production branch only; pass --any-branch to override.',
    }
  }
  return null
}

export function getPromoteGuardMessage(action: PromoteAction): string {
  const label = action === 'rollback' ? 'Rollback' : 'Promotion to 100%'
  return (
    `${label} runs in GitHub Actions. This command proves the execution context only -- ` +
    'it does not and cannot read whether the gate check is green on this commit; the ' +
    'workflow must run the promote step only after that gate. ' +
    'Set NARDUK_ALLOW_MANUAL_PROMOTE=1 for deliberate recovery work; ' +
    'NARDUK_ALLOW_LOCAL_WRANGLER_DEPLOY does not grant it.'
  )
}

/* -------------------------------------------------------------------------- */
/* Wrangler seam                                                              */
/* -------------------------------------------------------------------------- */

/** Every Cloudflare interaction goes through this, so tests never touch a network. */
export interface WranglerVersionsClient {
  listVersions: () => Promise<WorkerVersion[]>
  listDeployments: () => Promise<WorkerDeployment[]>
  /** `wrangler versions deploy <id>@100 --yes`. */
  deployVersion: (versionId: string, percentage: number, message?: string) => Promise<void>
  /** `wrangler rollback <id> --yes`. */
  rollback: (versionId: string, message?: string) => Promise<void>
}

/**
 * The process boundary itself, narrowed to what `runWrangler` uses, so a test
 * can drive `createWranglerCli` -- the argv that will run against production
 * Cloudflare -- without a network or a wrangler install.
 */
export interface SpawnResult {
  status: number | null
  signal: NodeJS.Signals | null
  stdout?: string | null
  error?: Error
}

export type SpawnWrangler = (
  command: string,
  args: string[],
  options: {
    cwd: string
    env: NodeJS.ProcessEnv
    stdio: 'inherit' | Array<'ignore' | 'pipe' | 'inherit'>
  },
) => SpawnResult

export interface WranglerCliOptions {
  workerName: string
  accountId?: string
  appDir?: string
  env?: DeployEnv
  /** Injected in tests; `spawnSync` otherwise. */
  spawn?: SpawnWrangler
}

const spawnWranglerSync: SpawnWrangler = (command, args, options) =>
  spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: options.stdio,
    encoding: 'utf8',
  })

function runWrangler(
  options: WranglerCliOptions,
  args: string[],
  capture: boolean,
): { stdout: string } {
  const env = { ...options.env }
  if (options.accountId && !env.CLOUDFLARE_ACCOUNT_ID?.trim()) {
    env.CLOUDFLARE_ACCOUNT_ID = options.accountId
  }
  const spawn = options.spawn ?? spawnWranglerSync
  const result = spawn('pnpm', ['exec', 'wrangler', ...args, '--name', options.workerName], {
    cwd: options.appDir ?? process.cwd(),
    env: env as NodeJS.ProcessEnv,
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
  })
  if (result.error) throw new Error(`Could not run wrangler: ${result.error.message}`)
  if (result.signal) throw new Error(`wrangler ${args[0]} was killed by ${result.signal}`)
  if (result.status !== 0) {
    throw new Error(`wrangler ${args.join(' ')} exited ${String(result.status ?? 'unknown')}`)
  }
  return { stdout: capture ? (result.stdout ?? '') : '' }
}

/**
 * Wrangler prints a banner before JSON on some commands, so take the document
 * from the first `[` or `{` rather than trusting the whole stream to parse.
 */
export function parseWranglerVersionsJson<T>(stdout: string, what: string): T {
  const start = stdout.search(/[[{]/u)
  if (start < 0) throw new Error(`wrangler ${what} returned no JSON`)
  try {
    return JSON.parse(stdout.slice(start)) as T
  } catch (error) {
    throw new Error(
      `Could not parse wrangler ${what} JSON: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

export function createWranglerCli(options: WranglerCliOptions): WranglerVersionsClient {
  const env = options.env ?? process.env
  const bound = { ...options, env }
  return {
    listVersions: async () =>
      parseWranglerVersionsJson<WorkerVersion[]>(
        runWrangler(bound, ['versions', 'list', '--json'], true).stdout,
        'versions list',
      ),
    listDeployments: async () =>
      parseWranglerVersionsJson<WorkerDeployment[]>(
        runWrangler(bound, ['deployments', 'list', '--json'], true).stdout,
        'deployments list',
      ),
    deployVersion: async (versionId, percentage, message) => {
      const args = ['versions', 'deploy', `${versionId}@${String(percentage)}`, '--yes']
      if (message) args.push('--message', message)
      runWrangler(bound, args, false)
    },
    rollback: async (versionId, message) => {
      const args = ['rollback', versionId, '--yes']
      if (message) args.push('--message', message)
      runWrangler(bound, args, false)
    },
  }
}

/** The `account_id` a committed Wrangler config pins, so a promote job needs no second source. */
export function readWranglerAccountId(appDir: string): string | null {
  const path = resolveWranglerConfigPath(appDir)
  if (!path) return null
  const config = readJsonc<{ account_id?: string }>(path)
  return config.account_id?.trim() || null
}

/* -------------------------------------------------------------------------- */
/* Resolution                                                                 */
/* -------------------------------------------------------------------------- */

export type VersionMatch =
  | { kind: 'found'; version: WorkerVersion; searched: number }
  | { kind: 'not-found'; searched: number }
  | { kind: 'ambiguous'; versions: WorkerVersion[]; searched: number }

/**
 * Commit tags are compared as hex prefixes in both directions: narduk-core
 * publishes a 12-character `x-build-version`, `git rev-parse --short` emits 7,
 * and `GITHUB_SHA` is 40. A fixed-width comparison is a gate that never passes.
 */
export function shaMatchesTag(sha: string, tag: string | undefined): boolean {
  if (!tag) return false
  const a = sha.trim().toLowerCase()
  const b = tag.trim().toLowerCase()
  if (!SHA_PATTERN.test(a) || !SHA_PATTERN.test(b)) return false
  return a.startsWith(b) || b.startsWith(a)
}

export function resolveVersionForSha(
  versions: readonly WorkerVersion[],
  sha: string,
): VersionMatch {
  const matches = versions.filter((version) =>
    shaMatchesTag(sha, version.annotations?.[VERSION_TAG_ANNOTATION]),
  )
  if (matches.length === 1) return { kind: 'found', version: matches[0], searched: versions.length }
  if (matches.length === 0) return { kind: 'not-found', searched: versions.length }
  return { kind: 'ambiguous', versions: matches, searched: versions.length }
}

/**
 * Which of two versions is newer: `1` when `a` is newer, `-1` when `b` is,
 * `0` when they are the same version, and `null` when the payload cannot order
 * them at all.
 *
 * `null` is the important return. It is the difference between "this promote is
 * not stale" and "nothing here can tell whether it is stale", and the promote
 * path treats the second as a refusal rather than as permission.
 */
export function compareVersionRecency(a: WorkerVersion, b: WorkerVersion): number | null {
  if (a.id === b.id) return 0
  if (typeof a.number === 'number' && typeof b.number === 'number') {
    return Math.sign(a.number - b.number)
  }
  const aTime = Date.parse(a.metadata?.created_on ?? '')
  const bTime = Date.parse(b.metadata?.created_on ?? '')
  if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) {
    return Math.sign(aTime - bTime)
  }
  return null
}

/**
 * The branch a Workers Build recorded on a version.
 *
 * `narduk-app deploy versions-upload` writes `--message "Workers Builds
 * <branch> @ <sha12>"` from `WORKERS_CI_BRANCH` (`./deploy.ts
 * resolveVersionTagArgs`), and Cloudflare stores that as the `workers/message`
 * annotation. `null` means the version carries no branch this tool can read --
 * which is not the same as "it came from main", and the promote path treats it
 * that way.
 */
export const VERSION_MESSAGE_PREFIX = 'Workers Builds '

export function versionBranch(version: WorkerVersion): string | null {
  const message = version.annotations?.[VERSION_MESSAGE_ANNOTATION]?.trim()
  if (!message?.toLowerCase().startsWith(VERSION_MESSAGE_PREFIX.toLowerCase())) return null
  // Split on the last ` @ `, not a regexp: a branch name may contain anything,
  // and a pattern permissive enough for that backtracks on a crafted message.
  const separator = message.lastIndexOf(' @ ')
  if (separator < 0) return null
  const sha = message.slice(separator + 3).trim()
  if (!SHA_PATTERN.test(sha)) return null
  const branch = message.slice(VERSION_MESSAGE_PREFIX.length, separator).trim()
  return branch || null
}

/**
 * The live deployment. `wrangler deployments list --json` returns the 10 most
 * recent oldest-first (observed live against `buoys`, 2026-09-17), so the last
 * entry is the current one; `created_on` is used as the tiebreak rather than
 * trusting the order.
 */
export function currentDeployment(
  deployments: readonly WorkerDeployment[],
): WorkerDeployment | null {
  if (deployments.length === 0) return null
  return [...deployments].sort((a, b) => (a.created_on ?? '').localeCompare(b.created_on ?? ''))[
    deployments.length - 1
  ]
}

/** The version id serving 100% of traffic, or null when traffic is split. */
export function soleDeployedVersionId(deployment: WorkerDeployment | null): string | null {
  if (!deployment) return null
  const full = deployment.versions.filter((entry) => entry.percentage === 100)
  return full.length === 1 && deployment.versions.length === 1 ? full[0].version_id : null
}

/**
 * Whether this deployment was itself produced by a rollback.
 *
 * Three answers, not two. A deployment carrying no `annotations` object at all
 * tells us nothing about its provenance, and "we cannot see that it was a
 * rollback" is not "it was not a rollback" -- reading it as the latter is what
 * lets a second unnamed rollback roll *forward* into the broken version it
 * just left. Unknown provenance is refused, not assumed benign.
 */
export type RollbackProvenance = 'rollback' | 'not-rollback' | 'unknown'

export function rollbackProvenance(deployment: WorkerDeployment | null): RollbackProvenance {
  if (!deployment) return 'unknown'
  const annotations = deployment.annotations
  if (!annotations || typeof annotations !== 'object') return 'unknown'
  return annotations[TRIGGERED_BY_ANNOTATION] === 'rollback' ||
    (annotations[VERSION_MESSAGE_ANNOTATION] ?? '').startsWith(ROLLBACK_MESSAGE_PREFIX)
    ? 'rollback'
    : 'not-rollback'
}

/** True only when the deployment is *known* to be a rollback. */
export function isRollbackDeployment(deployment: WorkerDeployment | null): boolean {
  return rollbackProvenance(deployment) === 'rollback'
}

export type RollbackTarget =
  | { kind: 'resolved'; versionId: string }
  | { kind: 'no-previous' }
  /** The live deployment is itself a rollback: resolving "previous" again would roll forward. */
  | { kind: 'would-roll-forward'; versionId: string }
  /** The live deployment carries no annotations, so it cannot be ruled out as one. */
  | { kind: 'unknown-provenance'; versionId: string }

/**
 * The version to roll back to when the caller named none: the most recent
 * deployed version that is not the live one.
 *
 * This is the reason `versions-promote` prints `previousVersionId`. Resolving
 * "previous" from history is only correct the first time -- after a rollback,
 * the newest distinct version is the broken one you just left, so a second
 * unnamed rollback would roll *forward* into it. A promote job therefore feeds
 * the id it printed back as `--to`, and the unnamed path refuses as soon as it
 * can see that the live deployment is already a rollback.
 */
export function resolvePreviousVersion(deployments: readonly WorkerDeployment[]): RollbackTarget {
  const ordered = [...deployments].sort((a, b) =>
    (a.created_on ?? '').localeCompare(b.created_on ?? ''),
  )
  const live = ordered.at(-1) ?? null
  if (!live) return { kind: 'no-previous' }
  const liveVersions = new Set(live.versions.map((entry) => entry.version_id))
  for (let index = ordered.length - 2; index >= 0; index -= 1) {
    const candidate = soleDeployedVersionId(ordered[index])
    if (!candidate || liveVersions.has(candidate)) continue
    const provenance = rollbackProvenance(live)
    if (provenance === 'rollback') return { kind: 'would-roll-forward', versionId: candidate }
    if (provenance === 'unknown') return { kind: 'unknown-provenance', versionId: candidate }
    return { kind: 'resolved', versionId: candidate }
  }
  return { kind: 'no-previous' }
}

/* -------------------------------------------------------------------------- */
/* Arguments                                                                  */
/* -------------------------------------------------------------------------- */

export interface PromoteFlags {
  sha: string | null
  versionId: string | null
  workerName: string | null
  accountId: string | null
  percentage: number
  message: string | null
  /** The branch a production version must have been built from. */
  productionBranch: string | null
  /** Promote a version built from any branch. */
  anyBranch: boolean
  /** Promote a version older than the live one -- a deliberate revert. */
  force: boolean
  json: boolean
  dryRun: boolean
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index]
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`)
  return value
}

function requirePercentage(raw: string): number {
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new Error(`--percentage must be an integer 1..100, got ${JSON.stringify(raw)}`)
  }
  return value
}

export function parseVersionsPromoteArgs(args: string[]): PromoteFlags {
  const flags: PromoteFlags = {
    sha: null,
    versionId: null,
    workerName: null,
    accountId: null,
    percentage: 100,
    message: null,
    productionBranch: null,
    anyBranch: false,
    force: false,
    json: false,
    dryRun: false,
  }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--sha') flags.sha = requireValue(args, (index += 1), '--sha')
    else if (arg === '--version-id')
      flags.versionId = requireValue(args, (index += 1), '--version-id')
    else if (arg === '--name') flags.workerName = requireValue(args, (index += 1), '--name')
    else if (arg === '--account-id')
      flags.accountId = requireValue(args, (index += 1), '--account-id')
    else if (arg === '--message') flags.message = requireValue(args, (index += 1), '--message')
    else if (arg === '--production-branch')
      flags.productionBranch = requireValue(args, (index += 1), '--production-branch')
    else if (arg === '--percentage')
      flags.percentage = requirePercentage(requireValue(args, (index += 1), '--percentage'))
    else if (arg === '--any-branch') flags.anyBranch = true
    else if (arg === '--force') flags.force = true
    else if (arg === '--json') flags.json = true
    else if (arg === '--dry-run') flags.dryRun = true
    else throw new Error(`Unknown deploy versions-promote option: ${arg}`)
  }
  if (flags.sha && flags.versionId) {
    throw new Error('Choose either --sha or --version-id, not both')
  }
  if (flags.sha && !SHA_PATTERN.test(flags.sha)) {
    throw new Error(`--sha must be a hex commit SHA, got ${JSON.stringify(flags.sha)}`)
  }
  return flags
}

export interface RollbackFlags {
  to: string | null
  workerName: string | null
  accountId: string | null
  message: string | null
  json: boolean
  dryRun: boolean
}

export function parseRollbackArgs(args: string[]): RollbackFlags {
  const flags: RollbackFlags = {
    to: null,
    workerName: null,
    accountId: null,
    message: null,
    json: false,
    dryRun: false,
  }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--to') flags.to = requireValue(args, (index += 1), '--to')
    else if (arg === '--name') flags.workerName = requireValue(args, (index += 1), '--name')
    else if (arg === '--account-id')
      flags.accountId = requireValue(args, (index += 1), '--account-id')
    else if (arg === '--message') flags.message = requireValue(args, (index += 1), '--message')
    else if (arg === '--json') flags.json = true
    else if (arg === '--dry-run') flags.dryRun = true
    else throw new Error(`Unknown deploy rollback option: ${arg}`)
  }
  return flags
}

/* -------------------------------------------------------------------------- */
/* Results                                                                    */
/* -------------------------------------------------------------------------- */

export type PromoteOutcome =
  | 'promoted'
  | 'already-live'
  | 'version-not-found'
  | 'ambiguous-version'
  | 'guard-refused'
  | 'rolled-back'
  | 'rollback-refused'
  /** The target version is older than, or not orderable against, the live one. */
  | 'stale-promote'
  /** The target version was not built from the production branch. */
  | 'branch-mismatch'
  /** Wrangler exited non-zero. `trafficMayHaveChanged` says whether traffic is at risk. */
  | 'wrangler-failed'
  | 'dry-run'

/** The machine-readable line a workflow step reads. */
export interface PromoteResult {
  action: PromoteAction
  outcome: PromoteOutcome
  worker: string | null
  sha: string | null
  versionId: string | null
  /** The version that was live before this call -- feed it to `rollback --to`. */
  previousVersionId: string | null
  percentage: number | null
  /** How many versions the SHA lookup could see. `wrangler versions list` caps at 10. */
  searchedVersions?: number
  candidates?: string[]
  /**
   * Set only on `wrangler-failed`. `true` means a `versions deploy` or
   * `rollback` was in flight when wrangler died, so the traffic state is
   * unknown and the caller must look before it acts.
   */
  trafficMayHaveChanged?: boolean
  /** Set when `--force` overrode the ordering guard, so the log carries it. */
  forced?: boolean
  detail: string
  exitCode: number
}

export function formatPromoteResult(result: PromoteResult): string {
  const lines = [
    `narduk-app deploy ${result.action} -- ${result.worker ?? '(worker unknown)'}`,
    `  outcome    ${result.outcome}`,
  ]
  if (result.sha) lines.push(`  sha        ${result.sha}`)
  if (result.versionId) lines.push(`  version    ${result.versionId}`)
  if (result.previousVersionId) lines.push(`  previous   ${result.previousVersionId}`)
  if (result.percentage !== null) lines.push(`  traffic    ${String(result.percentage)}%`)
  if (result.searchedVersions !== undefined) {
    lines.push(`  searched   ${String(result.searchedVersions)} most recent versions`)
  }
  if (result.candidates?.length) lines.push(`  candidates ${result.candidates.join(', ')}`)
  if (result.trafficMayHaveChanged !== undefined) {
    lines.push(
      `  traffic risk ${result.trafficMayHaveChanged ? 'YES -- a deploy was in flight' : 'no -- nothing was attempted'}`,
    )
  }
  if (result.forced) {
    lines.push(
      '  !! FORCED   --force overrode the ordering guard: a version older than the one ' +
        'serving production was deployed on purpose.',
    )
  }
  lines.push(`  detail     ${result.detail}`)
  return lines.join('\n')
}

/* -------------------------------------------------------------------------- */
/* Commands                                                                   */
/* -------------------------------------------------------------------------- */

export interface PromoteContext {
  appDir?: string
  env?: DeployEnv
  /** Injected in tests; built from the resolved Worker name otherwise. */
  client?: WranglerVersionsClient
  /** Injected in tests; `readWranglerScriptName` otherwise. */
  resolveWorkerName?: (appDir: string) => string
  resolveAccountId?: (appDir: string) => string | null
}

function resolveWorker(
  flags: { workerName: string | null; accountId: string | null },
  context: PromoteContext,
): { workerName: string; accountId: string | null; appDir: string } {
  const appDir = context.appDir ?? process.cwd()
  const workerName = flags.workerName ?? context.resolveWorkerName?.(appDir) ?? null
  if (!workerName) {
    throw new Error('Could not resolve the Worker name; pass --name <worker>')
  }
  const accountId = flags.accountId ?? context.resolveAccountId?.(appDir) ?? null
  return { workerName, accountId, appDir }
}

function guardRefusal(
  action: PromoteAction,
  worker: string | null,
  detail?: string,
): PromoteResult {
  return {
    action,
    outcome: 'guard-refused',
    worker,
    sha: null,
    versionId: null,
    previousVersionId: null,
    percentage: null,
    detail: detail ?? getPromoteGuardMessage(action),
    exitCode: PROMOTE_EXIT.refused,
  }
}

/**
 * Everything that talks to wrangler runs inside this, so a non-zero wrangler
 * exit becomes a `PromoteResult` with `wranglerFailed` (5) rather than an
 * exception the CLI flattens into 1. `trafficMayHaveChanged` is the whole point
 * of the distinction: a failed `deployments list` changed nothing, a failed
 * `versions deploy` may have changed everything.
 */
async function withWranglerFailure<T>(
  action: PromoteAction,
  worker: string | null,
  phase: string,
  trafficMayHaveChanged: boolean,
  run: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; result: PromoteResult }> {
  try {
    return { ok: true, value: await run() }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      result: {
        action,
        outcome: 'wrangler-failed',
        worker,
        sha: null,
        versionId: null,
        previousVersionId: null,
        percentage: null,
        trafficMayHaveChanged,
        detail:
          `wrangler failed during ${phase}: ${message}. ` +
          (trafficMayHaveChanged
            ? 'A traffic change was in flight, so the live version is unknown: read ' +
              '`wrangler deployments list` before deciding whether to roll back.'
            : 'Nothing was deployed; production is untouched.'),
        exitCode: PROMOTE_EXIT.wranglerFailed,
      },
    }
  }
}

export async function runVersionsPromote(
  flags: PromoteFlags,
  context: PromoteContext = {},
): Promise<PromoteResult> {
  const env = context.env ?? process.env
  if (!isActionsPromoteAllowed(env) && !isManualPromoteAllowed(env)) {
    return guardRefusal('versions-promote', flags.workerName)
  }

  const { workerName, accountId, appDir } = resolveWorker(flags, context)

  // The ref/event half of the guard. Skipped under the manual override, which
  // is the deliberate-recovery path and by definition runs outside Actions.
  const productionBranch =
    flags.productionBranch ?? env.NARDUK_PROMOTE_PRODUCTION_BRANCH?.trim() ?? null
  if (!isManualPromoteAllowed(env)) {
    const refusal = checkPromoteContext(env, productionBranch)
    if (refusal) return guardRefusal('versions-promote', workerName, refusal.reason)
  }

  const client =
    context.client ??
    createWranglerCli({ workerName, accountId: accountId ?? undefined, appDir, env })
  const sha = flags.sha ?? env.GITHUB_SHA?.trim() ?? null
  if (!flags.versionId && !sha) {
    throw new Error('Pass --sha <commit> or --version-id <id> (GITHUB_SHA was not set)')
  }

  const deploymentsRead = await withWranglerFailure(
    'versions-promote',
    workerName,
    'deployments list',
    false,
    async () => client.listDeployments(),
  )
  if (!deploymentsRead.ok) return deploymentsRead.result
  const deployments = deploymentsRead.value
  const live = currentDeployment(deployments)
  const previousVersionId = soleDeployedVersionId(live)

  // One `versions list` serves both the SHA lookup and the ordering guard, so
  // the guard costs no extra call and sees exactly the window the lookup saw.
  const versionsRead = await withWranglerFailure(
    'versions-promote',
    workerName,
    'versions list',
    false,
    async () => client.listVersions(),
  )
  if (!versionsRead.ok) return versionsRead.result
  const versions = versionsRead.value

  let versionId = flags.versionId
  let searchedVersions: number | undefined
  if (!versionId && sha) {
    const match = resolveVersionForSha(versions, sha)
    searchedVersions = match.searched
    if (match.kind === 'not-found') {
      return {
        action: 'versions-promote',
        outcome: 'version-not-found',
        worker: workerName,
        sha,
        versionId: null,
        previousVersionId,
        percentage: null,
        searchedVersions,
        detail:
          `No uploaded version carries workers/tag ${sha} among the ${String(match.searched)} most ` +
          'recent versions. Re-run the Workers Build for this commit, or promote by --version-id. ' +
          '`wrangler versions list` returns at most 10 versions and takes no paging flag.',
        exitCode: PROMOTE_EXIT.versionNotFound,
      }
    }
    if (match.kind === 'ambiguous') {
      return {
        action: 'versions-promote',
        outcome: 'ambiguous-version',
        worker: workerName,
        sha,
        versionId: null,
        previousVersionId,
        percentage: null,
        searchedVersions,
        candidates: match.versions.map((version) => version.id),
        detail:
          `${String(match.versions.length)} versions carry workers/tag ${sha}; refusing to guess. ` +
          'Promote the intended one with --version-id.',
        exitCode: PROMOTE_EXIT.ambiguousVersion,
      }
    }
    versionId = match.version.id
  }

  if (!versionId) throw new Error('Could not resolve a version to promote')

  const target = versions.find((version) => version.id === versionId) ?? null
  const liveVersion = previousVersionId
    ? (versions.find((version) => version.id === previousVersionId) ?? null)
    : null

  const refuse = (
    outcome: 'stale-promote' | 'branch-mismatch',
    exitCode: number,
    detail: string,
  ): PromoteResult => ({
    action: 'versions-promote',
    outcome,
    worker: workerName,
    sha,
    versionId,
    previousVersionId,
    percentage: null,
    searchedVersions,
    detail,
    exitCode,
  })

  // S2: a version built from a feature branch carries the same commit tag as
  // main's build of that commit. Promoting the wrong one is how a branch's code
  // reaches production without ever being on main.
  if (productionBranch && !flags.anyBranch && target) {
    const branch = versionBranch(target)
    if (branch === null) {
      return refuse(
        'branch-mismatch',
        PROMOTE_EXIT.branchMismatch,
        `Version ${versionId} records no branch (no readable ${VERSION_MESSAGE_ANNOTATION} ` +
          `annotation), so it cannot be confirmed as a ${productionBranch} build. Re-run the ` +
          'Workers Build for this commit, or pass --any-branch to promote it anyway.',
      )
    }
    if (branch !== productionBranch) {
      return refuse(
        'branch-mismatch',
        PROMOTE_EXIT.branchMismatch,
        `Version ${versionId} was built from branch ${branch}, not the production branch ` +
          `${productionBranch}. Promote the ${productionBranch} build of this commit, or pass ` +
          '--any-branch.',
      )
    }
  }

  // B1: the ordering guard. Two promotes racing (PRs merged seconds apart, a
  // re-run of an older job, a manual recovery promote) would otherwise let the
  // older commit win simply by finishing last, with outcome `promoted` and exit
  // 0 -- and the live proof passes, because the older version really does serve
  // the SHA that job expects.
  let forced: true | undefined
  if (liveVersion && target && liveVersion.id !== target.id) {
    const order = compareVersionRecency(target, liveVersion)
    if (order === null || order < 0) {
      const detail =
        order === null
          ? `Cannot tell whether version ${versionId} is newer than the live version ` +
            `${previousVersionId}: neither carries a comparable version number or created_on. ` +
            'Refusing rather than risking a silent roll-back of production. Pass --force to ' +
            'deploy it anyway.'
          : `Version ${versionId} is OLDER than the version already serving production ` +
            `(${previousVersionId}). Promoting it would roll production backwards -- this is ` +
            'what a superseded or re-run promote job looks like. Pass --force for a deliberate ' +
            'revert-by-promote.'
      if (!flags.force) return refuse('stale-promote', PROMOTE_EXIT.stalePromote, detail)
      forced = true
      console.warn(`[promote] !! FORCED PAST THE ORDERING GUARD -- ${detail}`)
    }
  }

  if (previousVersionId === versionId && flags.percentage === 100) {
    return {
      action: 'versions-promote',
      outcome: 'already-live',
      worker: workerName,
      sha,
      versionId,
      previousVersionId,
      percentage: 100,
      searchedVersions,
      detail: 'This version already serves 100% of traffic; nothing to do.',
      exitCode: PROMOTE_EXIT.ok,
    }
  }

  if (flags.dryRun) {
    return {
      action: 'versions-promote',
      outcome: 'dry-run',
      worker: workerName,
      sha,
      versionId,
      previousVersionId,
      percentage: flags.percentage,
      searchedVersions,
      detail: `Would run: wrangler versions deploy ${versionId}@${String(flags.percentage)}`,
      exitCode: PROMOTE_EXIT.ok,
    }
  }

  const deployed = await withWranglerFailure(
    'versions-promote',
    workerName,
    `versions deploy ${versionId}@${String(flags.percentage)}`,
    true,
    async () =>
      client.deployVersion(
        versionId,
        flags.percentage,
        flags.message ?? (sha ? `narduk-app promote ${sha}` : undefined),
      ),
  )
  if (!deployed.ok) return { ...deployed.result, sha, versionId, previousVersionId }
  return {
    action: 'versions-promote',
    outcome: 'promoted',
    worker: workerName,
    sha,
    versionId,
    previousVersionId,
    percentage: flags.percentage,
    searchedVersions,
    forced,
    detail: `Deployed version ${versionId} at ${String(flags.percentage)}%.`,
    exitCode: PROMOTE_EXIT.ok,
  }
}

export async function runRollback(
  flags: RollbackFlags,
  context: PromoteContext = {},
): Promise<PromoteResult> {
  const env = context.env ?? process.env
  if (!isActionsPromoteAllowed(env) && !isManualPromoteAllowed(env)) {
    return guardRefusal('rollback', flags.workerName)
  }

  const { workerName, accountId, appDir } = resolveWorker(flags, context)
  const client =
    context.client ??
    createWranglerCli({ workerName, accountId: accountId ?? undefined, appDir, env })

  const deploymentsRead = await withWranglerFailure(
    'rollback',
    workerName,
    'deployments list',
    false,
    async () => client.listDeployments(),
  )
  if (!deploymentsRead.ok) return deploymentsRead.result
  const deployments = deploymentsRead.value
  const live = currentDeployment(deployments)
  const liveVersionId = soleDeployedVersionId(live)

  const refuse = (detail: string, versionId: string | null): PromoteResult => ({
    action: 'rollback',
    outcome: 'rollback-refused',
    worker: workerName,
    sha: null,
    versionId,
    previousVersionId: liveVersionId,
    percentage: null,
    detail,
    exitCode: PROMOTE_EXIT.rollbackRefused,
  })

  let target = flags.to
  if (!target) {
    const resolved = resolvePreviousVersion(deployments)
    if (resolved.kind === 'no-previous') {
      return refuse(
        'No earlier deployed version to roll back to. Pass --to <version-id> if one exists ' +
          'outside the 10 deployments wrangler reports.',
        null,
      )
    }
    if (resolved.kind === 'would-roll-forward') {
      return refuse(
        'The live deployment is itself a rollback, so the newest earlier version is the one ' +
          'that was just rolled back from; rolling back again would roll forward into it. ' +
          'Pass --to <version-id> explicitly (a promote prints previousVersionId for this).',
        resolved.versionId,
      )
    }
    if (resolved.kind === 'unknown-provenance') {
      return refuse(
        'The live deployment carries no annotations, so it cannot be ruled out as a rollback -- ' +
          'and if it is one, the newest earlier version is the broken one it left, so an unnamed ' +
          'rollback would roll forward into it. Unknown provenance is refused, not assumed ' +
          'benign. Pass --to <version-id> explicitly (a promote prints previousVersionId).',
        resolved.versionId,
      )
    }
    target = resolved.versionId
  }

  if (liveVersionId === target) {
    return refuse(
      `Version ${target} already serves 100% of traffic; refusing a no-op rollback.`,
      target,
    )
  }

  if (flags.dryRun) {
    return {
      action: 'rollback',
      outcome: 'dry-run',
      worker: workerName,
      sha: null,
      versionId: target,
      previousVersionId: liveVersionId,
      percentage: 100,
      detail: `Would run: wrangler rollback ${target}`,
      exitCode: PROMOTE_EXIT.ok,
    }
  }

  const versionId = target
  const rolled = await withWranglerFailure(
    'rollback',
    workerName,
    `rollback ${versionId}`,
    true,
    async () =>
      client.rollback(versionId, flags.message ?? `${ROLLBACK_MESSAGE_PREFIX} to ${versionId}`),
  )
  if (!rolled.ok) return { ...rolled.result, versionId: target, previousVersionId: liveVersionId }
  return {
    action: 'rollback',
    outcome: 'rolled-back',
    worker: workerName,
    sha: null,
    versionId: target,
    previousVersionId: liveVersionId,
    percentage: 100,
    detail: `Rolled back to version ${target}.`,
    exitCode: PROMOTE_EXIT.ok,
  }
}
