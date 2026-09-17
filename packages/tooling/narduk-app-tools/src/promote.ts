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

/** A Worker version as `wrangler versions list --json` returns it. */
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

/** Distinct exit codes, so a workflow step can branch on the failure class. */
export const PROMOTE_EXIT = {
  ok: 0,
  /** Usage, guard refusal, or a missing Worker name/account. */
  refused: 1,
  /** No version carries this commit's tag inside the searched window. */
  versionNotFound: 3,
  /** More than one version carries this commit's tag. */
  ambiguousVersion: 4,
  /** Wrangler itself failed. */
  wranglerFailed: 5,
  /** The rollback target is already the live version, or cannot be resolved safely. */
  rollbackRefused: 6,
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

export function getPromoteGuardMessage(action: PromoteAction): string {
  const label = action === 'rollback' ? 'Rollback' : 'Promotion to 100%'
  return (
    `${label} runs in GitHub Actions, after the gate check is green on this exact commit. ` +
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

export interface WranglerCliOptions {
  workerName: string
  accountId?: string
  appDir?: string
  env?: DeployEnv
}

function runWrangler(
  options: WranglerCliOptions,
  args: string[],
  capture: boolean,
): { stdout: string } {
  const env = { ...options.env }
  if (options.accountId && !env.CLOUDFLARE_ACCOUNT_ID?.trim()) {
    env.CLOUDFLARE_ACCOUNT_ID = options.accountId
  }
  const result = spawnSync('pnpm', ['exec', 'wrangler', ...args, '--name', options.workerName], {
    cwd: options.appDir ?? process.cwd(),
    env: env as NodeJS.ProcessEnv,
    encoding: 'utf8',
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

/** True when this deployment was itself produced by a rollback. */
export function isRollbackDeployment(deployment: WorkerDeployment | null): boolean {
  if (!deployment) return false
  const annotations = deployment.annotations ?? {}
  return (
    annotations[TRIGGERED_BY_ANNOTATION] === 'rollback' ||
    (annotations[VERSION_MESSAGE_ANNOTATION] ?? '').startsWith(ROLLBACK_MESSAGE_PREFIX)
  )
}

export type RollbackTarget =
  | { kind: 'resolved'; versionId: string }
  | { kind: 'no-previous' }
  /** The live deployment is itself a rollback: resolving "previous" again would roll forward. */
  | { kind: 'would-roll-forward'; versionId: string }

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
    return isRollbackDeployment(live)
      ? { kind: 'would-roll-forward', versionId: candidate }
      : { kind: 'resolved', versionId: candidate }
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
  json: boolean
  dryRun: boolean
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index]
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`)
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

function guardRefusal(action: PromoteAction, worker: string | null): PromoteResult {
  return {
    action,
    outcome: 'guard-refused',
    worker,
    sha: null,
    versionId: null,
    previousVersionId: null,
    percentage: null,
    detail: getPromoteGuardMessage(action),
    exitCode: PROMOTE_EXIT.refused,
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
  const client =
    context.client ??
    createWranglerCli({ workerName, accountId: accountId ?? undefined, appDir, env })
  const sha = flags.sha ?? env.GITHUB_SHA?.trim() ?? null
  if (!flags.versionId && !sha) {
    throw new Error('Pass --sha <commit> or --version-id <id> (GITHUB_SHA was not set)')
  }

  const deployments = await client.listDeployments()
  const live = currentDeployment(deployments)
  const previousVersionId = soleDeployedVersionId(live)

  let versionId = flags.versionId
  let searchedVersions: number | undefined
  if (!versionId && sha) {
    const match = resolveVersionForSha(await client.listVersions(), sha)
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

  await client.deployVersion(
    versionId,
    flags.percentage,
    flags.message ?? (sha ? `narduk-app promote ${sha}` : undefined),
  )
  return {
    action: 'versions-promote',
    outcome: 'promoted',
    worker: workerName,
    sha,
    versionId,
    previousVersionId,
    percentage: flags.percentage,
    searchedVersions,
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

  const deployments = await client.listDeployments()
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

  await client.rollback(target, flags.message ?? `${ROLLBACK_MESSAGE_PREFIX} to ${target}`)
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
