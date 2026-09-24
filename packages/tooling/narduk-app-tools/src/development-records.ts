/** Host-private activation records. Configuration declares capability; this grants custody. */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { hostname } from 'node:os'
import { join, relative } from 'node:path'

import type { DevelopmentConfig } from './development-config.js'
import type { SavedDevelopmentWorkflow } from './development-github.js'
import type { SavedDevelopmentTrigger } from './development-provider.js'
import { developmentSystemEnv } from './development-process.js'
import {
  declarationDigest,
  developmentStateDirectory,
  readPrivateJson,
  writePrivateJson,
  type DeploymentTarget,
} from './development-state.js'
import { findCloudflareAppConfig, readJsonc } from './deploy.js'
import { readDeploymentBlock, type DeploymentBlock } from './deployment-config.js'

export type DevelopmentMode = 'entering' | 'active' | 'suspended' | 'exiting' | 'restoring'
export type DevelopmentOutcome =
  'verified' | 'awaiting-owner' | 'refused' | 'failed-before-traffic' | 'unproven' | 'rolled-back'

export interface AppliedMigration {
  commit: string
  ref: string
  approvalRef: string
  appliedAt: string
  files: Array<{ path: string; sha256: string }>
  /**
   * What the expand-only rule (12.9) found in the files this run applied.
   * Absent on records written before the rule ran here, which rollback treats
   * as unknown, never as expand-only.
   */
  compatibility?: 'expand-only' | 'contract'
}

export interface ActivationRecord {
  schemaVersion: 1
  repository: string
  checkout: string
  targetSet: string
  components: Record<string, DeploymentTarget & { tag?: string }>
  approvalRef: string
  publisher: string
  workstation: string
  toolVersion: string
  configDigest: string
  mode: DevelopmentMode
  /** Completed entry/exit steps; re-running the command resumes after the last one. */
  journal: string[]
  workflows: SavedDevelopmentWorkflow[]
  triggers: Record<string, SavedDevelopmentTrigger[]>
  pendingRuns: Array<{ id: number; path: string }>
  expectedServing: Record<string, string>
  lastReceipt?: string
  knownGood: string[]
  pin?: {
    scenario: string
    scenarioDigest: string
    pinnedAt: string
    versions: Record<string, string>
    buildId?: string
  }
  pendingAttempt?: { buildId: string; receipt: string; startedAt: string }
  appliedMigrations: AppliedMigration[]
  /**
   * The production-branch commit this checkout had fetched before the hold
   * took effect. Migration files byte-identical there landed through normal
   * delivery, whose promote path already applied the expand-only rule, so
   * development mode does not re-judge them. `hold`: read on a fresh entry
   * before anything was held. `reflog`: recovered by `enter --refresh` from the
   * checkout's reflog, as of a whole second before `enter-started`. Never the
   * ref as fetched during the hold, and never moved once recorded.
   */
  migrationBaseline?: { commit: string; recordedAt: string; source?: 'hold' | 'reflog' }
  validations: Array<{ ref: string; sha: string; reason: string; requestedAt: string }>
  handoff?: { to: string; suspendedAt: string; bundle: string }
  exit?: { preparedAt: string; releaseSha?: string; validationRun?: number }
  history: Array<{ at: string; event: string; detail?: string }>
  /** Held paths whose already-disabled live state was explicitly accepted at entry. */
  acceptedPriorWorkflows?: string[]
}

export interface DevelopmentProject {
  checkout: string
  repository: string
  manifestPath: string
  deployment: DeploymentBlock
  development: DevelopmentConfig
  configDigest: string
}

// Options that make git run another program. No development operation needs
// them, so refuse them anywhere in the argument list rather than trust callers.
const EXECUTING_GIT_OPTION = /^(?:--upload-pack|--receive-pack|--exec|-u$|-c$|--config)/u

export function developmentGit(cwd: string, args: string[]): string {
  if (args.some((arg) => EXECUTING_GIT_OPTION.test(arg)))
    throw new Error('Refusing a git option that executes another program')
  const result = spawnSync('git', args, {
    cwd,
    env: { ...developmentSystemEnv(), GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' },
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.error || result.signal || result.status !== 0) throw new Error(`git ${args[0]} failed`)
  return result.stdout.trim()
}

/** owner/name from the origin remote; no network access. */
export function originRepository(checkout: string): string {
  // Read the stored URL, not `git remote get-url`, which applies `url.*.insteadOf`
  // rewrites (token-bearing HTTPS in this agent, and many CI checkouts).
  const url = developmentGit(checkout, ['config', '--get', 'remote.origin.url'])
  const match =
    /^(?:git@github\.com:|ssh:\/\/git@github\.com\/|https:\/\/(?:[\w.-]+(?::[^@/]+)?@)?github\.com\/)([\w.-]+\/[\w.-]+?)(?:\.git)?$/u.exec(
      url,
    )
  if (!match) throw new Error('The origin remote is not a GitHub repository')
  return match[1]
}

export function loadDevelopmentProject(cwd = process.cwd()): DevelopmentProject {
  const checkout = realpathSync(developmentGit(cwd, ['rev-parse', '--show-toplevel']))
  const manifestPath = findCloudflareAppConfig(checkout)
  if (!manifestPath || relative(checkout, manifestPath) !== join('Config', 'cloudflare-app.json'))
    throw new Error('Development mode requires a repository-root Config/cloudflare-app.json')
  const outcome = readDeploymentBlock(readJsonc<unknown>(manifestPath))
  if (outcome.kind !== 'valid')
    throw new Error('Development mode requires a valid narduk-v1 deployment block')
  const development = outcome.block.development
  if (!development)
    throw new Error('This app declares no deployment.development capability; use normal delivery')
  for (const component of Object.values(development.components)) {
    if (!existsSync(join(checkout, component.wranglerConfig)))
      throw new Error(`Declared Wrangler config is missing: ${component.wranglerConfig}`)
    const wrangler = readJsonc<{ name?: string; account_id?: string }>(
      join(checkout, component.wranglerConfig),
    )
    if (wrangler.name !== component.workerName)
      throw new Error(`Wrangler name disagrees with the declared Worker ${component.workerName}`)
    if (wrangler.account_id && wrangler.account_id !== component.accountId)
      throw new Error(`Wrangler account disagrees for ${component.workerName}`)
  }
  return {
    checkout,
    repository: originRepository(checkout),
    manifestPath,
    deployment: outcome.block,
    development,
    configDigest: declarationDigest(development),
  }
}

export function toolVersion(): string {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    version: string
  }
  return pkg.version
}

export function repositoryKey(repository: string): string {
  return repository.replaceAll('/', '__').toLowerCase()
}

export function activationPath(repository: string, stateDirectory: string): string {
  return join(stateDirectory, 'activations', `${repositoryKey(repository)}.json`)
}

export function readActivation(
  repository: string,
  stateDirectory = developmentStateDirectory(),
): ActivationRecord | undefined {
  const path = activationPath(repository, stateDirectory)
  if (!existsSync(path)) return undefined
  const record = readPrivateJson(path) as ActivationRecord
  if (record.schemaVersion !== 1 || record.repository !== repository)
    throw new Error(`Unrecognized activation record: ${path}`)
  return record
}

export function writeActivation(
  record: ActivationRecord,
  stateDirectory = developmentStateDirectory(),
  event?: string,
  detail?: string,
): void {
  if (event) record.history.push({ at: new Date().toISOString(), event, detail })
  record.history = record.history.slice(-200)
  writePrivateJson(activationPath(record.repository, stateDirectory), record)
}

export function targetsFor(
  project: DevelopmentProject,
  targetSet = project.development.defaultTargetSet,
): Array<{ id: string; target: DeploymentTarget }> {
  const set = project.development.targetSets[targetSet]
  if (!set) throw new Error(`Unknown target set: ${targetSet}`)
  return set.components.map((id) => {
    const component = project.development.components[id]
    return { id, target: { accountId: component.accountId, workerName: component.workerName } }
  })
}

/** The recorded publisher on this workstation, from the recorded integration checkout. */
export function assertPublisher(record: ActivationRecord, project: DevelopmentProject): void {
  if (record.workstation !== hostname())
    throw new Error(
      `Publisher custody belongs to workstation ${record.workstation}; transfer it with development handoff`,
    )
  if (record.checkout !== project.checkout)
    throw new Error(
      `Publish from the recorded integration checkout ${record.checkout}; feed other worktrees into it with commits`,
    )
  if (record.configDigest !== project.configDigest)
    throw new Error(
      'The development declaration changed since enrollment; run development enter --refresh to re-verify holds',
    )
}
