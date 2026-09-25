/**
 * Occasional lifecycle operations around deploy:dev. Every provider mutation is
 * journaled first and every command is resumable: re-running it continues after
 * the last confirmed step. Nothing restores automation on a timer or in cleanup.
 */
import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { hostname } from 'node:os'
import { join, resolve } from 'node:path'

import type { DevelopmentComponent } from './development-config.js'
import {
  describeOutcome,
  rollBackDevelopmentTarget,
  runDevelopmentDeploy,
  type DevelopmentContext,
  type DevelopmentReceipt,
} from './development-deploy.js'
import { DevelopmentGitHub, type SavedDevelopmentWorkflow } from './development-github.js'
import {
  assessDevelopmentMigrations,
  developmentReceiptPath,
  planDevelopmentRollback,
  type RollbackPlan,
} from './development-guards.js'
import { readDevelopmentSecret } from './development-process.js'
import { DevelopmentCloudflare } from './development-provider.js'
import {
  describeScriptTriggerMismatch,
  readSourceScriptTriggers,
  scriptTriggerMismatch,
  type ScriptTriggerMismatch,
} from './development-script-triggers.js'
import {
  activationPath,
  assertPublisher,
  developmentGit,
  loadDevelopmentProject,
  readActivation,
  targetsFor,
  toolVersion,
  writeActivation,
  repositoryKey,
  type ActivationRecord,
  type DevelopmentProject,
} from './development-records.js'
import {
  acquireTargetLocks,
  developmentStateDirectory,
  readPrivateJson,
  targetLockPath,
  writePrivateJson,
  type TargetLockRecord,
} from './development-state.js'
import {
  drainDeployedValidations,
  readValidationHistory,
  type ValidationHistoryEntry,
} from './development-validation.js'
import { runVerifyLive } from './verify-live.js'

export type DevelopmentGitHubClient = Pick<
  DevelopmentGitHub,
  | 'saveWorkflows'
  | 'holdWorkflow'
  | 'settleWorkflows'
  | 'inspectWorkflow'
  | 'restoreWorkflow'
  | 'requestValidation'
  | 'verifyValidation'
  | 'workflows'
  | 'openRedMainIssues'
  | 'requestDeployedValidation'
  | 'activeValidationRuns'
  | 'cancelRun'
  | 'deleteValidationRef'
> & { branchHead?: (branch: string) => string }
export type DevelopmentBuildsClient = Pick<
  DevelopmentCloudflare,
  | 'workerTag'
  | 'triggers'
  | 'saveTriggers'
  | 'retireTrigger'
  | 'createTrigger'
  | 'restoreVariables'
  | 'inspect'
  | 'scriptTriggers'
>

export interface LifecycleContext extends DevelopmentContext {
  github?: (repository: string) => DevelopmentGitHubClient
  builds?: (component: DevelopmentComponent) => DevelopmentBuildsClient
  /** Operator command runner for `exec`; inherits the operator's environment. */
  exec?: (argv: string[], cwd: string) => number
  deploy?: typeof runDevelopmentDeploy
}

interface Resolved {
  env: NodeJS.ProcessEnv
  stateDirectory: string
  log: (message: string) => void
  project: DevelopmentProject
  github: DevelopmentGitHubClient
  builds: (id: string) => DevelopmentBuildsClient
}

function resolveContext(context: LifecycleContext): Resolved {
  const env = context.env ?? process.env
  const project = loadDevelopmentProject(context.cwd)
  const readSecret = context.readSecret ?? readDevelopmentSecret
  const cache = new Map<string, DevelopmentBuildsClient>()
  return {
    env,
    stateDirectory: context.stateDirectory ?? developmentStateDirectory(env),
    log: context.log ?? ((message: string) => console.error(message)),
    project,
    github: context.github?.(project.repository) ?? new DevelopmentGitHub(project.repository),
    builds: (id) => {
      const component = project.development.components[id]
      if (!cache.has(id))
        cache.set(
          id,
          context.builds?.(component) ?? new DevelopmentCloudflare(component, readSecret),
        )
      return cache.get(id)!
    },
  }
}

export interface ScriptTriggerCheck {
  mismatches: ScriptTriggerMismatch[]
  /** Why declared or live triggers could not be read; a mismatch is then unknown, not absent. */
  unknown?: string
}

/** The checkout's declared crons/routes against the live script (narduk-libs#756). */
async function checkScriptTriggers(
  project: DevelopmentProject,
  id: string,
  client: DevelopmentBuildsClient,
): Promise<ScriptTriggerCheck> {
  const component = project.development.components[id]
  try {
    const declared = readSourceScriptTriggers(join(project.checkout, component.wranglerConfig))
    return { mismatches: scriptTriggerMismatch(declared, await client.scriptTriggers()) }
  } catch (error) {
    return { mismatches: [], unknown: error instanceof Error ? error.message : String(error) }
  }
}

function describeScriptTriggerCheck(check: ScriptTriggerCheck): string {
  if (check.unknown) return `script triggers unknown: ${check.unknown}`
  if (!check.mismatches.length) return 'script triggers match the checkout'
  return `script triggers MISMATCH: ${check.mismatches.map(describeScriptTriggerMismatch).join('; ')}`
}

function lockTargets(record: ActivationRecord, operation: string, stateDirectory: string) {
  return acquireTargetLocks(
    Object.values(record.components).map(({ accountId, workerName }) => ({
      accountId,
      workerName,
    })),
    operation,
    activationPath(record.repository, stateDirectory),
    stateDirectory,
  )
}

function step(record: ActivationRecord, name: string): boolean {
  return record.journal.includes(name)
}

function assertPriorWorkflows(
  saved: SavedDevelopmentWorkflow[],
  retiredWorkflows: readonly string[],
  acceptPriorState: boolean | undefined,
): SavedDevelopmentWorkflow[] {
  const ambiguous = DevelopmentGitHub.ambiguousPriorWorkflows(saved, retiredWorkflows)
  if (ambiguous.length && !acceptPriorState)
    throw new Error(DevelopmentGitHub.describeAmbiguousPriorWorkflows(ambiguous))
  return ambiguous
}

function recordAcceptedPriorWorkflows(
  record: ActivationRecord,
  accepted: SavedDevelopmentWorkflow[],
  stateDirectory: string,
): void {
  if (!accepted.length) return
  record.acceptedPriorWorkflows = [
    ...new Set([
      ...(record.acceptedPriorWorkflows ?? []),
      ...accepted.map((workflow) => workflow.path),
    ]),
  ]
  writeActivation(
    record,
    stateDirectory,
    'accepted-prior-state',
    record.acceptedPriorWorkflows.join(','),
  )
}

// ─── entry ────────────────────────────────────────────────────────────────────

export interface EnterFlags {
  targetSet?: string
  approvalRef: string
  publisher: string
  refresh: boolean
  dryRun: boolean
  /** Record an already-disabled held workflow as the intended restore state. */
  acceptPriorState?: boolean
}

export async function runDevelopmentEnter(
  flags: EnterFlags,
  context: LifecycleContext = {},
): Promise<ActivationRecord> {
  const { stateDirectory, log, project, github, builds } = resolveContext(context)
  const targetSet = flags.targetSet ?? project.development.defaultTargetSet
  const targets = targetsFor(project, targetSet)
  const existing = readActivation(project.repository, stateDirectory)
  if (existing && existing.mode !== 'entering' && !(existing.mode === 'active' && flags.refresh))
    throw new Error(`Development mode is already ${existing.mode} for ${project.repository}`)
  if (flags.refresh && existing?.mode !== 'active')
    throw new Error('--refresh re-verifies an active enrollment; run enter without it first')
  if (existing && (existing.targetSet !== targetSet || existing.approvalRef !== flags.approvalRef))
    throw new Error('Resume with the same --target-set and --approval-ref that started entry')
  const automation = project.development.automation
  log(
    `[development] enter ${project.repository} target-set=${targetSet} approval=${flags.approvalRef}`,
  )
  if (flags.dryRun) {
    const workflows = github.saveWorkflows(automation)
    const retired = new Set(automation.retiredWorkflows)
    const known = new Set((existing?.workflows ?? []).map((workflow) => workflow.id))
    for (const workflow of workflows) {
      const ambiguous =
        !known.has(workflow.id) &&
        workflow.previousState.startsWith('disabled_') &&
        !retired.has(workflow.path)
      log(
        `[development]   hold workflow ${workflow.path} (${workflow.previousState})${
          ambiguous ? ' — AMBIGUOUS prior state' : ''
        }`,
      )
    }
    assertPriorWorkflows(
      workflows.filter((workflow) => !known.has(workflow.id)),
      automation.retiredWorkflows,
      flags.acceptPriorState,
    )
    for (const path of [automation.manualValidationWorkflow, ...automation.independentWorkflows])
      log(`[development]   keep workflow ${path}`)
    for (const writer of automation.continuingWriters)
      log(`[development]   keep writer ${writer.id} at ${writer.revision.slice(0, 12)}`)
    for (const { id, target } of targets) {
      const client = builds(id)
      const saved = await client.saveTriggers(await client.workerTag())
      log(
        `[development]   ${target.workerName}: retire ${saved.length} build trigger(s) [${saved
          .map((trigger) => trigger.definition.trigger_name)
          .join(', ')}]`,
      )
      log(
        `[development]   ${target.workerName}: ${describeScriptTriggerCheck(await checkScriptTriggers(project, id, client))}`,
      )
    }
    log('[development] dry run: no provider state was changed')
    return existing ?? newRecord(project, targetSet, flags)
  }
  if (!existing) {
    // Refuse before writing an `entering` record so a first-time enter that
    // hits ambiguous prior state does not leave a file later resume would
    // keep failing on.
    assertPriorWorkflows(
      github.saveWorkflows(automation),
      automation.retiredWorkflows,
      flags.acceptPriorState,
    )
  }
  const record = existing ?? newRecord(project, targetSet, flags)
  if (!existing) writeActivation(record, stateDirectory, 'enter-started', flags.approvalRef)
  const lock = lockTargets(record, 'development-enter', stateDirectory)
  try {
    if (flags.refresh) {
      const current = github.saveWorkflows(automation)
      const added = current.filter(
        (workflow) => !record.workflows.some((saved) => saved.id === workflow.id),
      )
      recordAcceptedPriorWorkflows(
        record,
        assertPriorWorkflows(added, automation.retiredWorkflows, flags.acceptPriorState),
        stateDirectory,
      )
      for (const workflow of added) {
        record.workflows.push(workflow)
        writeActivation(record, stateDirectory, 'hold-added', workflow.path)
      }
      record.journal = record.journal.filter((name) => name !== 'held' && name !== 'verified')
    }
    if (!step(record, 'saved')) {
      const workflows = github.saveWorkflows(automation)
      recordAcceptedPriorWorkflows(
        record,
        assertPriorWorkflows(workflows, automation.retiredWorkflows, flags.acceptPriorState),
        stateDirectory,
      )
      record.workflows = workflows
      for (const { id } of targets) {
        const client = builds(id)
        const tag = await client.workerTag()
        record.components[id].tag = tag
        record.triggers[id] = await client.saveTriggers(tag)
      }
      record.journal.push('saved')
      writeActivation(record, stateDirectory, 'settings-saved')
    }
    if (!step(record, 'held')) {
      // The production branch as this checkout knows it before anything is
      // held: everything in it was pushed while normal delivery still ran.
      if (
        record.mode === 'entering' &&
        !record.migrationBaseline &&
        !record.workflows.some((workflow) => workflow.held) &&
        !Object.values(record.triggers).some((triggers) =>
          triggers.some((trigger) => trigger.retired),
        )
      )
        recordMigrationBaseline(project, record, log)
      for (const workflow of record.workflows) {
        if (workflow.held) continue
        github.holdWorkflow(workflow)
        workflow.held = true
        writeActivation(record, stateDirectory, 'workflow-held', workflow.path)
      }
      for (const { id } of targets) {
        const client = builds(id)
        const present = new Set(
          (await client.triggers(record.components[id].tag!)).map((trigger) => trigger.id),
        )
        for (const trigger of record.triggers[id]) {
          if (trigger.retired) continue
          if (present.has(trigger.originalId)) await client.retireTrigger(trigger.originalId)
          trigger.retired = true
          writeActivation(record, stateDirectory, 'trigger-retired', trigger.originalId)
        }
      }
      record.journal.push('held')
      writeActivation(record, stateDirectory)
    }
    if (!step(record, 'settled')) {
      record.pendingRuns = github.settleWorkflows(record.workflows)
      writeActivation(record, stateDirectory)
      if (record.pendingRuns.length)
        throw new Error(
          `${record.pendingRuns.length} held run(s) are still settling (credentialed writers finish; others were cancelled). Inspect them, then re-run development enter to resume.`,
        )
      record.journal.push('settled')
      writeActivation(record, stateDirectory, 'runs-settled')
    }
    if (!step(record, 'verified')) {
      for (const workflow of record.workflows) {
        if (!github.inspectWorkflow(workflow).state.startsWith('disabled_'))
          throw new Error(`Hold is not in effect for ${workflow.path}`)
      }
      for (const { id } of targets) {
        const client = builds(id)
        if ((await client.triggers(record.components[id].tag!)).length)
          throw new Error(`${id} still has Workers Builds triggers; the hold is incomplete`)
        record.expectedServing[id] = (await client.inspect()).versionId
      }
      record.journal.push('verified')
    }
    if (!record.migrationBaseline) recoverMigrationBaseline(project, record, log)
    // Report, not refuse: a mismatch predates enrollment, and the first deploy applies the declared triggers.
    for (const { id, target } of targets)
      log(
        `[development]   ${target.workerName}: ${describeScriptTriggerCheck(await checkScriptTriggers(project, id, builds(id)))}`,
      )
    record.mode = 'active'
    record.configDigest = project.configDigest
    record.toolVersion = toolVersion()
    writeActivation(record, stateDirectory, flags.refresh ? 'refreshed' : 'active', flags.publisher)
    log(
      `[development] active: ${record.publisher} publishes ${project.repository} from ${record.checkout}`,
    )
    return record
  } finally {
    lock.release()
  }
}

function newRecord(
  project: DevelopmentProject,
  targetSet: string,
  flags: EnterFlags,
): ActivationRecord {
  return {
    schemaVersion: 1,
    repository: project.repository,
    checkout: project.checkout,
    targetSet,
    components: Object.fromEntries(
      targetsFor(project, targetSet).map(({ id, target }) => [id, target]),
    ),
    approvalRef: flags.approvalRef,
    publisher: flags.publisher,
    workstation: hostname(),
    toolVersion: toolVersion(),
    configDigest: project.configDigest,
    mode: 'entering',
    journal: [],
    workflows: [],
    triggers: {},
    pendingRuns: [],
    expectedServing: {},
    knownGood: [],
    appliedMigrations: [],
    validations: [],
    history: [],
  }
}

/**
 * Pin the production branch as this checkout has it fetched. Called only on a
 * fresh entry before anything is held: a ref read then holds only commits
 * pushed while normal delivery (and its own 12.9 check) still ran. No fetch
 * here; a stale ref only makes the check stricter.
 */
function recordMigrationBaseline(
  project: DevelopmentProject,
  record: ActivationRecord,
  log: (message: string) => void,
): void {
  const branch = project.deployment.productionBranch
  try {
    const commit = developmentGit(project.checkout, [
      'rev-parse',
      '--verify',
      '--quiet',
      `refs/remotes/origin/${branch}^{commit}`,
    ])
    record.migrationBaseline = { commit, recordedAt: new Date().toISOString(), source: 'hold' }
  } catch {
    log(
      `[development] WARNING: origin/${branch} is not fetched; development migrations will re-check every tracked file`,
    )
  }
}

/**
 * An enrollment without a baseline (entered before it existed, or unfetched
 * at entry) recovers one from this checkout's reflog of origin/<branch>: the
 * newest value fetched in a whole second before `enter-started`, so before
 * the hold. Never the current ref: a file that landed while the hold was on
 * skipped the held CI and its 12.9 check. When the reflog does not reach back
 * that far, or history no longer starts at `enter-started`, nothing is
 * recorded and every tracked file stays judged.
 */
function recoverMigrationBaseline(
  project: DevelopmentProject,
  record: ActivationRecord,
  log: (message: string) => void,
): void {
  const branch = project.deployment.productionBranch
  const started = record.history[0]
  const cutoff =
    started?.event === 'enter-started' ? Math.floor(Date.parse(started.at) / 1000) : Number.NaN
  let entries = ''
  if (Number.isFinite(cutoff)) {
    try {
      entries = developmentGit(project.checkout, [
        'reflog',
        'show',
        '--date=unix',
        '--format=%H%x09%gd',
        `refs/remotes/origin/${branch}`,
      ])
    } catch {
      entries = ''
    }
  }
  for (const line of entries.split('\n')) {
    const [commit = '', selector = ''] = line.split('\t')
    const at = Number(/@\{(\d+)\}$/u.exec(selector)?.[1])
    if (/^[a-f0-9]{40}$/u.test(commit) && at < cutoff) {
      record.migrationBaseline = {
        commit,
        recordedAt: new Date().toISOString(),
        source: 'reflog',
      }
      log(
        `[development] migration baseline: origin/${branch} was ${commit.slice(0, 12)} before this enrollment began`,
      )
      return
    }
  }
  log(
    `[development] WARNING: this checkout has no record of origin/${branch} from before this enrollment began; development migrations will re-check every tracked file`,
  )
}

// ─── status / resolve ─────────────────────────────────────────────────────────

export interface StatusReport {
  repository: string
  mode: 'normal' | ActivationRecord['mode']
  record?: ActivationRecord
  lastReceipt?: Pick<DevelopmentReceipt, 'buildId' | 'outcome' | 'baseCommit' | 'dirty' | 'timings'>
  remote?: Record<
    string,
    {
      servingVersionId: string
      expected?: string
      unexpected: boolean
      triggers?: number
      scriptTriggers?: ScriptTriggerCheck
    }
  >
  workflows?: Array<{ path: string; state: string }>
  /** The newest automatic validation push after a verified deploy. */
  autoValidation?: ValidationHistoryEntry
}

export async function runDevelopmentStatus(
  flags: { remote: boolean },
  context: LifecycleContext = {},
): Promise<StatusReport> {
  const { stateDirectory, project, github, builds } = resolveContext(context)
  const record = readActivation(project.repository, stateDirectory)
  const report: StatusReport = {
    repository: project.repository,
    mode: record?.mode ?? 'normal',
    record,
  }
  if (record?.lastReceipt && existsSync(record.lastReceipt)) {
    const receipt = readPrivateJson(record.lastReceipt) as DevelopmentReceipt
    report.lastReceipt = {
      buildId: receipt.buildId,
      outcome: receipt.outcome,
      baseCommit: receipt.baseCommit,
      dirty: receipt.dirty,
      timings: receipt.timings,
    }
  }
  if (record)
    report.autoValidation = readValidationHistory(stateDirectory, project.repository).at(-1)
  if (flags.remote && record) {
    report.remote = {}
    for (const id of Object.keys(record.components)) {
      const client = builds(id)
      const serving = (await client.inspect()).versionId
      report.remote[id] = {
        servingVersionId: serving,
        expected: record.expectedServing[id],
        unexpected: Boolean(record.expectedServing[id] && serving !== record.expectedServing[id]),
        triggers: record.components[id].tag
          ? (await client.triggers(record.components[id].tag)).length
          : undefined,
        scriptTriggers: await checkScriptTriggers(project, id, client),
      }
    }
    report.workflows = record.workflows.map((workflow) => ({
      path: workflow.path,
      state: github.inspectWorkflow(workflow).state,
    }))
  }
  return report
}

export function formatStatus(report: StatusReport): string {
  if (!report.record)
    return `${report.repository}: normal delivery (not enrolled in development mode on this workstation)`
  const record = report.record
  const lines = [
    `${report.repository}: development ${record.mode}`,
    `  publisher ${record.publisher} on ${record.workstation}, checkout ${record.checkout}`,
    `  target set ${record.targetSet}: ${Object.values(record.components)
      .map((component) => component.workerName)
      .join(', ')}`,
    `  approval ${record.approvalRef}`,
  ]
  if (record.mode === 'entering' || record.mode === 'exiting' || record.mode === 'restoring')
    lines.push(`  incomplete transition; completed steps: ${record.journal.join(', ') || 'none'}`)
  if (record.pin)
    lines.push(`  FEEDBACK PIN: ${record.pin.scenario} (since ${record.pin.pinnedAt})`)
  if (record.pendingAttempt)
    lines.push(`  UNRESOLVED ATTEMPT ${record.pendingAttempt.buildId}: run development resolve`)
  if (report.lastReceipt)
    lines.push(
      `  last deploy ${report.lastReceipt.buildId}: ${describeOutcome(report.lastReceipt.outcome)} (base ${report.lastReceipt.baseCommit.slice(0, 12)}${report.lastReceipt.dirty ? ' + local changes' : ''})`,
    )
  const auto = report.autoValidation
  if (auto?.failed)
    lines.push(
      `  last automatic validation: ${auto.sha.slice(0, 12)} (${auto.buildId}) NOT PUSHED after ${auto.failed.attempts} attempt(s): ${auto.failed.error}; run development validate`,
    )
  else if (auto)
    lines.push(
      `  last automatic validation: ${auto.sha.slice(0, 12)} (${auto.buildId}) via ${auto.validationRef}${auto.supersededAt ? ', superseded' : ''}`,
    )
  for (const [id, version] of Object.entries(record.expectedServing))
    lines.push(`  ${id} expected serving ${version}`)
  for (const [id, remote] of Object.entries(report.remote ?? {})) {
    lines.push(
      `  ${id} actually serving ${remote.servingVersionId}${remote.unexpected ? ' — UNEXPECTED' : ''}; build triggers ${String(remote.triggers ?? '?')}`,
    )
    if (remote.scriptTriggers)
      lines.push(`  ${id} ${describeScriptTriggerCheck(remote.scriptTriggers)}`)
  }
  for (const workflow of report.workflows ?? [])
    lines.push(`  workflow ${workflow.path}: ${workflow.state}`)
  for (const workflow of record.workflows) {
    if (!workflow.desiredState.startsWith('disabled_')) continue
    const accepted = record.acceptedPriorWorkflows?.includes(workflow.path)
    lines.push(
      `  workflow ${workflow.path}: exit restores ${workflow.desiredState}${
        accepted ? ' (accepted prior state at entry)' : ''
      }`,
    )
  }
  if (record.appliedMigrations.length)
    lines.push(
      `  applied unmerged migrations: ${record.appliedMigrations.map((m) => m.commit.slice(0, 12)).join(', ')}`,
    )
  return lines.join('\n')
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** Inspect provider state after an interruption and record what actually serves. */
export async function runDevelopmentResolve(
  flags: { releaseStaleLock: boolean },
  context: LifecycleContext = {},
): Promise<ActivationRecord> {
  const { stateDirectory, log, project, builds } = resolveContext(context)
  const record = readActivation(project.repository, stateDirectory)
  if (!record) throw new Error('Not enrolled in development mode')
  if (flags.releaseStaleLock) {
    for (const target of Object.values(record.components)) {
      const path = targetLockPath(target, stateDirectory)
      if (!existsSync(path)) continue
      const owner = join(path, 'owner.json')
      const lock = existsSync(owner) ? (readPrivateJson(owner) as TargetLockRecord) : undefined
      if (lock && (lock.workstation !== hostname() || processAlive(lock.pid)))
        throw new Error(
          `Lock ${path} belongs to a live or remote process (pid ${lock.pid}); not released`,
        )
      rmSync(path, { recursive: true, force: true })
      log(
        `[development] released stale lock ${path}${lock ? ` (${lock.operation}, pid ${lock.pid})` : ''}`,
      )
      writeActivation(record, stateDirectory, 'stale-lock-released', lock?.operation)
    }
  }
  const lock = lockTargets(record, 'development-resolve', stateDirectory)
  try {
    if (record.pendingAttempt) {
      const attempt = record.pendingAttempt
      const receipt = existsSync(attempt.receipt)
        ? (readPrivateJson(attempt.receipt) as DevelopmentReceipt)
        : undefined
      for (const id of Object.keys(record.components)) {
        const serving = (await builds(id).inspect()).versionId
        record.expectedServing[id] = serving
        if (receipt) receipt.components[id].servingVersionId = serving
        log(`[development] ${id} serves ${serving}`)
      }
      if (receipt) {
        const moved = Object.entries(receipt.components).some(
          ([, component]) => component.servingVersionId === component.candidateVersionId,
        )
        receipt.outcome = moved ? 'unproven' : 'failed-before-traffic'
        receipt.phase = receipt.outcome
        writePrivateJson(attempt.receipt, receipt)
        log(`[development] attempt ${attempt.buildId}: ${describeOutcome(receipt.outcome)}`)
      }
      delete record.pendingAttempt
      record.lastReceipt = attempt.receipt
      writeActivation(record, stateDirectory, 'attempt-resolved', attempt.buildId)
    } else log('[development] no unresolved attempt')
    return record
  } finally {
    lock.release()
  }
}

// ─── pin ─────────────────────────────────────────────────────────────────────

export async function runDevelopmentPin(
  flags: { scenario: string },
  context: LifecycleContext = {},
): Promise<ActivationRecord> {
  const { stateDirectory, log, project, builds } = resolveContext(context)
  const record = activeRecord(project, stateDirectory)
  if (record.pin) throw new Error('A feedback pin is already active')
  if (record.pendingAttempt) throw new Error('Resolve the unfinished attempt before pinning')
  const scenario = readFileSync(
    resolve(context.cwd ?? process.cwd(), flags.scenario),
    'utf8',
  ).trim()
  if (!scenario) throw new Error('The scenario file is empty')
  const lock = lockTargets(record, 'development-pin', stateDirectory)
  try {
    for (const id of Object.keys(record.components)) {
      const serving = (await builds(id).inspect()).versionId
      if (serving !== record.expectedServing[id])
        throw new Error(`${id} serves ${serving}, not the verified ${record.expectedServing[id]}`)
    }
    const receipt =
      record.lastReceipt && existsSync(record.lastReceipt)
        ? (readPrivateJson(record.lastReceipt) as DevelopmentReceipt)
        : undefined
    record.pin = {
      scenario,
      scenarioDigest: createHash('sha256').update(scenario).digest('hex'),
      pinnedAt: new Date().toISOString(),
      versions: { ...record.expectedServing },
      buildId: receipt?.buildId,
    }
    writeActivation(record, stateDirectory, 'pinned', flags.scenario)
    log(
      `[development] feedback pin established on ${receipt?.buildId ?? 'current serving versions'}`,
    )
    return record
  } finally {
    lock.release()
  }
}

export function runDevelopmentUnpin(
  flags: { feedbackRef: string },
  context: LifecycleContext = {},
): ActivationRecord {
  const { stateDirectory, log, project } = resolveContext(context)
  const record = activeRecord(project, stateDirectory)
  if (!record.pin) throw new Error('No feedback pin is active')
  delete record.pin
  writeActivation(record, stateDirectory, 'unpinned', flags.feedbackRef)
  log(`[development] feedback round closed: ${flags.feedbackRef}`)
  return record
}

function activeRecord(project: DevelopmentProject, stateDirectory: string): ActivationRecord {
  const record = readActivation(project.repository, stateDirectory)
  if (!record || record.mode !== 'active')
    throw new Error(
      record ? `Development mode is ${record.mode}` : 'Not enrolled in development mode',
    )
  assertPublisher(record, project)
  return record
}

// ─── authorized operations ────────────────────────────────────────────────────

export interface ExecFlags {
  operation: 'migration' | 'secret-stage' | 'recovery'
  approvalRef: string
  commit?: string
  argv: string[]
}

function runOperator(argv: string[], cwd: string): number {
  const result = spawnSync(argv[0], argv.slice(1), { cwd, stdio: 'inherit', shell: false })
  if (result.error) throw new Error(`Could not start ${argv[0]}`)
  return result.status ?? 1
}

function migrationFiles(project: DevelopmentProject): Array<{ path: string; sha256: string }> {
  const directories = project.development.migrationDirectories
  if (!directories.length)
    throw new Error('Declare deployment.development.migrationDirectories before running migrations')
  const files = developmentGit(project.checkout, ['ls-files', '-z', '--', ...directories])
    .split('\0')
    .filter(Boolean)
    .sort()
  return files.map((path) => ({
    path,
    sha256: createHash('sha256')
      .update(readFileSync(join(project.checkout, path)))
      .digest('hex'),
  }))
}

/** A blob ID at a revision, or undefined when the path is absent there. */
function blobAt(checkout: string, revision: string, path: string): string | undefined {
  try {
    return developmentGit(checkout, ['rev-parse', '--verify', '--quiet', `${revision}:${path}`])
  } catch {
    return undefined
  }
}

/**
 * The promote path's expand-only rule (12.9) on every development-mode
 * migration: refuse before anything runs when a file this run may apply drops
 * or renames what serving code reads, unless it is a reviewed contract
 * migration already landed on the production branch (O-D9).
 */
function expandOnlyMigrations(
  project: DevelopmentProject,
  record: ActivationRecord,
  files: Array<{ path: string; sha256: string }>,
  commit: string,
): 'expand-only' | 'contract' {
  const branch = project.deployment.productionBranch
  const baseline = record.migrationBaseline?.commit
  // An app that declares deployment.migrations (expand-contract) has foundation
  // 12.9 judge every file on every run, so a baseline file that is destructive
  // and unwaived is one normal delivery FAILED (merged under "CI after" while
  // main went red), not one it shipped. Only where 12.9 is NA (migrations
  // undeclared) is the baseline a real exemption.
  const expandContract = Boolean(project.deployment.migrations)
  const assessment = assessDevelopmentMigrations({
    files,
    applied: record.appliedMigrations,
    beforeEnrollment: expandContract
      ? undefined
      : (path) => {
          if (!baseline) return false
          const here = blobAt(project.checkout, commit, path)
          return Boolean(here) && here === blobAt(project.checkout, baseline, path)
        },
    read: (path) => readFileSync(join(project.checkout, path), 'utf8'),
    waivers: project.deployment.migrations?.contractMigrations ?? [],
    landed: (path) => {
      const here = blobAt(project.checkout, commit, path)
      return (
        Boolean(here) && here === blobAt(project.checkout, `refs/remotes/origin/${branch}`, path)
      )
    },
    productionBranch: branch,
  })
  if (assessment.refusals.length)
    throw new Error(
      `Refusing the migration: ${assessment.refusals.join(' | ')}${
        expandContract
          ? ' | This app declares deployment.migrations (expand-contract), so every file is judged, including files already on the production branch before enrollment: a drop or rename there needs its contractMigrations waiver'
          : baseline
            ? ''
            : ` | This enrollment records no pre-enrollment baseline, so files normal delivery already shipped are checked too. development enter --refresh recovers one only from this checkout's reflog of origin/${branch} before the enrollment began (fetching now does not help); otherwise declare the file under deployment.migrations.contractMigrations`
      }`,
    )
  return assessment.contract.length ? 'contract' : 'expand-only'
}

export async function runDevelopmentExec(
  flags: ExecFlags,
  context: LifecycleContext = {},
): Promise<{ exitCode: number; record: ActivationRecord }> {
  const { stateDirectory, log, project, builds } = resolveContext(context)
  const record = readActivation(project.repository, stateDirectory)
  if (!record || !['active', 'exiting'].includes(record.mode))
    throw new Error('Authorized operations run only while development mode is active or exiting')
  assertPublisher(record, project)
  if (record.pin && flags.operation !== 'recovery')
    throw new Error('A feedback pin is active; close the round before changing data or secrets')
  if (!flags.argv.length) throw new Error('Pass the operation command after --')
  let files: Array<{ path: string; sha256: string }> = []
  let migrationCompatibility: 'expand-only' | 'contract' = 'expand-only'
  if (flags.operation === 'migration') {
    const commit = flags.commit
    if (!commit || !/^[a-f0-9]{40}$/u.test(commit))
      throw new Error('Migrations run from a frozen local commit: pass --commit <full sha>')
    const directories = project.development.migrationDirectories
    developmentGit(project.checkout, ['merge-base', '--is-ancestor', commit, 'HEAD'])
    const changed =
      developmentGit(project.checkout, ['diff', '--name-only', commit, '--', ...directories]) ||
      developmentGit(project.checkout, [
        'ls-files',
        '--others',
        '--exclude-standard',
        '--',
        ...directories,
      ])
    if (changed)
      throw new Error('Migration sources differ from the frozen commit; commit them first')
    files = migrationFiles(project)
    migrationCompatibility = expandOnlyMigrations(project, record, files, commit)
  }
  const lock = lockTargets(record, `exec-${flags.operation}`, stateDirectory)
  try {
    writeActivation(record, stateDirectory, `exec-${flags.operation}-started`, flags.approvalRef)
    const exitCode = (context.exec ?? runOperator)(flags.argv, project.checkout)
    if (flags.operation === 'migration') {
      const after = migrationFiles(project)
      if (JSON.stringify(after) !== JSON.stringify(files))
        throw new Error('Migration sources changed while the migration ran; inspect the database')
      const ref = `refs/narduk/development/migrations/${flags.commit!}`
      developmentGit(project.checkout, ['update-ref', ref, flags.commit!])
      // Record even a failed run: a partial application still freezes these bytes.
      record.appliedMigrations.push({
        commit: flags.commit!,
        ref,
        approvalRef: flags.approvalRef,
        appliedAt: new Date().toISOString(),
        files,
        compatibility: migrationCompatibility,
      })
    }
    for (const id of Object.keys(record.components)) {
      const serving = (await builds(id).inspect()).versionId
      if (serving !== record.expectedServing[id])
        log(
          `[development] ${id} now serves ${serving} (was ${record.expectedServing[id] ?? 'unknown'})`,
        )
      record.expectedServing[id] = serving
    }
    writeActivation(
      record,
      stateDirectory,
      `exec-${flags.operation}-exit-${exitCode}`,
      flags.approvalRef,
    )
    return { exitCode, record }
  } finally {
    lock.release()
  }
}

// ─── explicit validation ──────────────────────────────────────────────────────

export function runDevelopmentValidate(
  flags: { ref: string; sha: string; reason: string },
  context: LifecycleContext = {},
): string {
  const { stateDirectory, log, project, github } = resolveContext(context)
  const record = readActivation(project.repository, stateDirectory)
  if (!record) throw new Error('Not enrolled; normal delivery already validates pushes')
  const validationRef = github.requestValidation(
    project.checkout,
    flags.ref,
    flags.sha,
    flags.reason,
    (request) => {
      record.validations.push({
        ref: request.validationRef,
        sha: request.sha,
        reason: request.reason,
        requestedAt: new Date().toISOString(),
      })
      writeActivation(record, stateDirectory, 'validation-requested', request.validationRef)
    },
  )
  log(`[development] full validation requested for ${flags.sha} via ${validationRef}`)
  log(
    `[development] find the run: gh run list --repo ${project.repository} --branch ${validationRef}`,
  )
  return validationRef
}

/**
 * The detached worker deploy:dev starts: push the newest queued deployed
 * commit for full validation and cancel what it supersedes. Exits when the
 * queue is empty; another worker already draining it makes this a no-op.
 */
export function runDevelopmentValidationWorker(context: LifecycleContext = {}): string[] {
  const { stateDirectory, log, project, github } = resolveContext(context)
  return drainDeployedValidations({ repository: project.repository, stateDirectory, github, log })
}

// ─── rollback ─────────────────────────────────────────────────────────────────

/**
 * Move serving back to a known-good build and prove it: the rehearsal command,
 * and the manual path while automatic rollback is off. It refuses exactly
 * where the automatic path pages: across a Durable Object, binding or
 * non-expand-only migration change.
 */
export async function runDevelopmentRollback(
  flags: { to: string; dryRun: boolean },
  context: LifecycleContext = {},
): Promise<RollbackPlan> {
  const { stateDirectory, log, project, builds } = resolveContext(context)
  const record = activeRecord(project, stateDirectory)
  if (record.pin) throw new Error('A feedback pin is active; close it before rolling back')
  if (record.pendingAttempt) throw new Error('Resolve the unfinished attempt before rolling back')
  if (!record.knownGood.includes(flags.to))
    throw new Error(
      `--to must name a known-good build on this workstation: ${record.knownGood.join(', ') || '(none recorded)'}`,
    )
  const components = targetsFor(project, record.targetSet).map(({ id }) => ({
    id,
    component: project.development.components[id],
  }))
  const lock = lockTargets(record, 'development-rollback', stateDirectory)
  try {
    for (const { id } of components) {
      const serving = (await builds(id).inspect()).versionId
      if (serving !== record.expectedServing[id])
        throw new Error(`${id} serves ${serving}, not the recorded ${record.expectedServing[id]}`)
    }
    const current =
      record.lastReceipt && existsSync(record.lastReceipt)
        ? (readPrivateJson(record.lastReceipt) as DevelopmentReceipt)
        : undefined
    const plan = planDevelopmentRollback({
      stateDirectory,
      record,
      targetBuildId: flags.to,
      components: components.map(({ id }) => id),
      current: Object.fromEntries(
        components.map(({ id }) => [id, current?.components[id]?.bindings]),
      ),
    })
    if (plan.kind === 'page')
      throw new Error(`Refusing to roll back to ${flags.to}: ${plan.reasons.join('; ')}`)
    if (components.every(({ id }) => record.expectedServing[id] === plan.versions[id]))
      throw new Error(`${flags.to} already serves; nothing to roll back`)
    if (flags.dryRun) {
      for (const { id } of components)
        log(`[development] would move ${id} ${record.expectedServing[id]} -> ${plan.versions[id]}`)
      return plan
    }
    writeActivation(record, stateDirectory, 'rollback-intent', flags.to)
    const readSecret = context.readSecret ?? readDevelopmentSecret
    const result = await rollBackDevelopmentTarget({
      project,
      components,
      provider: (id) =>
        context.provider?.(project.development.components[id]) ??
        new DevelopmentCloudflare(project.development.components[id], readSecret),
      plan,
      message: `narduk-app development rollback -> ${flags.to}`,
      verify: context.verify ?? ((verifyFlags) => runVerifyLive(verifyFlags)),
      log,
    })
    for (const [id, version] of Object.entries(result.serving)) record.expectedServing[id] = version
    if (!result.proven) {
      writeActivation(record, stateDirectory, 'rollback-unproven', result.failure)
      throw new Error(`Rollback to ${flags.to} is unproven: ${result.failure}`)
    }
    record.knownGood = [flags.to, ...record.knownGood.filter((id) => id !== flags.to)]
    // What serves is the known-good build again; its receipt describes it.
    record.lastReceipt = developmentReceiptPath(stateDirectory, record.repository, flags.to)
    writeActivation(record, stateDirectory, 'rolled-back', flags.to)
    log(`[development] rolled back to ${flags.to} and proved it`)
    return plan
  } finally {
    lock.release()
  }
}

// ─── publisher handoff ────────────────────────────────────────────────────────

export function runDevelopmentHandoff(
  flags: { to: string },
  context: LifecycleContext = {},
): string {
  const { stateDirectory, log, project } = resolveContext(context)
  const record = activeRecord(project, stateDirectory)
  if (record.pendingAttempt) throw new Error('Resolve the unfinished attempt before handing off')
  const lock = lockTargets(record, 'development-handoff', stateDirectory)
  try {
    const bundle = join(
      stateDirectory,
      'handoffs',
      `${repositoryKey(record.repository)}-${new Date().toISOString().replaceAll(/[:.]/gu, '')}.json`,
    )
    record.mode = 'suspended'
    record.handoff = { to: flags.to, suspendedAt: new Date().toISOString(), bundle }
    writeActivation(record, stateDirectory, 'handoff-suspended', flags.to)
    writePrivateJson(bundle, record)
    log(
      `[development] publishing suspended here; transfer ${bundle} to ${flags.to} through approved private custody`,
    )
    log(
      '[development] the new publisher runs: narduk-app development handoff --accept <bundle> --publisher <id>',
    )
    return bundle
  } finally {
    lock.release()
  }
}

export async function runDevelopmentAccept(
  flags: { bundle: string; publisher: string },
  context: LifecycleContext = {},
): Promise<ActivationRecord> {
  const { stateDirectory, log, project, github, builds } = resolveContext(context)
  const record = readPrivateJson(resolve(flags.bundle)) as ActivationRecord
  if (record.schemaVersion !== 1 || record.repository !== project.repository)
    throw new Error('The handoff bundle is for a different repository')
  if (record.mode !== 'suspended' || record.handoff?.to !== flags.publisher)
    throw new Error('The bundle does not transfer custody to this publisher')
  const existing = readActivation(project.repository, stateDirectory)
  if (existing && existing.mode !== 'suspended')
    throw new Error(`This workstation already holds a ${existing.mode} record`)
  for (const workflow of record.workflows) {
    if (!github.inspectWorkflow(workflow).state.startsWith('disabled_'))
      throw new Error(`Hold is not in effect for ${workflow.path}; do not activate`)
  }
  for (const id of Object.keys(record.components)) {
    const client = builds(id)
    if (record.components[id].tag && (await client.triggers(record.components[id].tag)).length)
      throw new Error(`${id} has Workers Builds triggers; the hold is incomplete`)
    const serving = (await client.inspect()).versionId
    if (serving !== record.expectedServing[id])
      throw new Error(`${id} serves ${serving}, not the handed-off ${record.expectedServing[id]}`)
  }
  record.mode = 'active'
  record.publisher = flags.publisher
  record.workstation = hostname()
  record.checkout = project.checkout
  record.configDigest = project.configDigest
  record.toolVersion = toolVersion()
  // Receipts stay with the previous host; the serving versions carry forward.
  record.lastReceipt = undefined
  record.knownGood = []
  delete record.handoff
  writeActivation(record, stateDirectory, 'handoff-accepted', flags.publisher)
  log(
    `[development] ${flags.publisher} now publishes ${project.repository} from ${project.checkout}`,
  )
  return record
}

// ─── return to normal ─────────────────────────────────────────────────────────

export function runDevelopmentExitPrepare(context: LifecycleContext = {}): ActivationRecord {
  const { stateDirectory, log, project } = resolveContext(context)
  const record = activeRecord(project, stateDirectory)
  if (record.pendingAttempt) throw new Error('Resolve the unfinished attempt before exiting')
  if (record.pin) throw new Error('Close the feedback round (development unpin) before exiting')
  record.mode = 'exiting'
  record.journal = record.journal.filter((name) => !name.startsWith('exit-'))
  record.exit = { preparedAt: new Date().toISOString() }
  writeActivation(record, stateDirectory, 'exit-prepared')
  log('[development] development publishing frozen; automation stays held.')
  log('[development] next: integrate with main, push, development validate, review and merge, then')
  log('[development]   development exit --release-sha <merged sha> --validation-run <run id>')
  return record
}

export async function runDevelopmentExitComplete(
  flags: { releaseSha: string; validationRun: string; ownerProofRef?: string },
  context: LifecycleContext = {},
): Promise<ActivationRecord> {
  const resolved = resolveContext(context)
  const { stateDirectory, log, project, github, builds } = resolved
  const record = readActivation(project.repository, stateDirectory)
  if (!record || !['exiting', 'restoring'].includes(record.mode))
    throw new Error('Run development exit --prepare first')
  assertPublisher(record, project)
  if (!step(record, 'exit-validated')) {
    const run = github.verifyValidation(
      flags.validationRun,
      flags.releaseSha,
      project.development.automation,
    )
    const branch = project.deployment.productionBranch
    const head = github.branchHead
      ? github.branchHead(branch)
      : developmentGit(project.checkout, ['ls-remote', 'origin', `refs/heads/${branch}`]).split(
          '\t',
        )[0]
    if (head !== flags.releaseSha)
      throw new Error(
        `${branch} is at ${head}; the release must be the merged head that was validated`,
      )
    record.exit = { ...record.exit!, releaseSha: flags.releaseSha, validationRun: run.id }
    record.journal.push('exit-validated')
    writeActivation(record, stateDirectory, 'exit-validated', run.url)
  }
  if (!step(record, 'exit-deployed')) {
    const status = developmentGit(project.checkout, [
      'status',
      '--porcelain',
      '--untracked-files=all',
    ])
    if (developmentGit(project.checkout, ['rev-parse', 'HEAD']) !== flags.releaseSha || status)
      throw new Error(
        'Check out the exact merged release commit, clean, in the integration checkout',
      )
    const receipt = await (context.deploy ?? runDevelopmentDeploy)(
      { dryRun: false, json: false, releaseSha: flags.releaseSha },
      context,
    )
    const accepted =
      receipt.outcome === 'verified' ||
      (receipt.outcome === 'awaiting-owner' && flags.ownerProofRef)
    if (!accepted)
      throw new Error(
        `Release deployment is ${describeOutcome(receipt.outcome)}; automation stays held. Fix and re-run exit.`,
      )
    const fresh = readActivation(project.repository, stateDirectory)!
    fresh.journal.push('exit-deployed')
    fresh.mode = 'restoring'
    writeActivation(fresh, stateDirectory, 'exit-deployed', receipt.buildId)
    Object.assign(record, fresh)
  }
  const lock = lockTargets(record, 'development-exit', stateDirectory)
  try {
    if (!step(record, 'exit-settled')) {
      const pending = github.settleWorkflows(record.workflows)
      if (pending.length) {
        record.pendingRuns = pending
        writeActivation(record, stateDirectory)
        throw new Error(
          `${pending.length} obsolete run(s) are settling; re-run exit when they finish`,
        )
      }
      record.journal.push('exit-settled')
      writeActivation(record, stateDirectory, 'exit-settled')
    }
    for (const id of Object.keys(record.triggers)) {
      const client = builds(id)
      for (const trigger of record.triggers[id]) {
        if (!trigger.restoredId) {
          // Adopt a trigger created by an interrupted earlier attempt instead of duplicating it.
          const existing = (await client.triggers(record.components[id].tag!)).find(
            (candidate) =>
              candidate.definition.trigger_name === trigger.definition.trigger_name &&
              JSON.stringify(candidate.definition.branch_includes) ===
                JSON.stringify(trigger.definition.branch_includes),
          )
          trigger.restoredId = existing?.id ?? (await client.createTrigger(trigger.definition))
          writeActivation(
            record,
            stateDirectory,
            'trigger-recreated',
            `${trigger.originalId}→${trigger.restoredId}`,
          )
        }
        if (!trigger.variablesRestored) {
          await client.restoreVariables(trigger.restoredId, trigger.variables)
          trigger.variablesRestored = true
          writeActivation(record, stateDirectory, 'trigger-variables-restored', trigger.restoredId)
        }
      }
    }
    for (const workflow of record.workflows) {
      if (workflow.restored) continue
      if (workflow.desiredState.startsWith('disabled_')) {
        const accepted = record.acceptedPriorWorkflows?.includes(workflow.path)
        const retired = project.development.automation.retiredWorkflows.includes(workflow.path)
        log(
          `[development] restoring ${workflow.path} to ${workflow.desiredState}${
            retired ? ' (retired)' : accepted ? ' (accepted prior state at entry)' : ''
          }`,
        )
      }
      github.restoreWorkflow(workflow)
      workflow.restored = true
      writeActivation(
        record,
        stateDirectory,
        'workflow-restored',
        `${workflow.path}=${workflow.desiredState}`,
      )
    }
    const closed = join(
      stateDirectory,
      'activations',
      'closed',
      `${repositoryKey(record.repository)}-${randomUUID()}.json`,
    )
    record.journal.push('exit-restored')
    writeActivation(record, stateDirectory, 'returned-to-normal', flags.releaseSha)
    writePrivateJson(closed, record)
    rmSync(activationPath(record.repository, stateDirectory))
    log(
      `[development] returned to normal delivery at ${flags.releaseSha}; record archived at ${closed}`,
    )
    return record
  } finally {
    lock.release()
  }
}

export function listClosedActivations(stateDirectory = developmentStateDirectory()): string[] {
  const directory = join(stateDirectory, 'activations', 'closed')
  return existsSync(directory) ? readdirSync(directory).map((name) => join(directory, name)) : []
}
