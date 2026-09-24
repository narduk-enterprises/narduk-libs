/**
 * The ordinary loop: guard → inspect → capture → gate → build → assert →
 * upload → promote → triggers → prove, then queue full validation of what
 * now serves. A failed proof rolls back only where the app has switched that
 * on after a live rehearsal, and never across a change a rollback cannot undo.
 */
import { cpSync, existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

import { parse as parseJsonc, type ParseError } from 'jsonc-parser'
import { z } from 'zod'

import { readJsonc, runDeploy } from './deploy.js'
import { healthArgs } from './deployment-config.js'
import { scanPublicAssetsForSecretLeaks } from './deploy-local.js'
import type { DevelopmentComponent, DevelopmentCommand } from './development-config.js'
import { DevelopmentGitHub } from './development-github.js'
import {
  assessRedMain,
  bindingChanges,
  bindingSurface,
  changedSourcePaths,
  matchProtectedPaths,
  planDevelopmentRollback,
  protectedPatterns,
  type BindingSurface,
  type RedMainIssue,
} from './development-guards.js'
import {
  developmentBuildEnvironment,
  developmentSystemEnv,
  prepareDevelopmentDependencies,
  readDevelopmentSecret,
  runDevelopmentCommand,
  type DevelopmentSecretReader,
} from './development-process.js'
import { DevelopmentCloudflare, type DevelopmentProviderState } from './development-provider.js'
import {
  assertPublisher,
  developmentGit,
  loadDevelopmentProject,
  readActivation,
  targetsFor,
  toolVersion,
  writeActivation,
  repositoryKey,
  type ActivationRecord,
  type DevelopmentOutcome,
  type DevelopmentProject,
} from './development-records.js'
import { readDeclaredScriptTriggers, routePattern } from './development-script-triggers.js'
import {
  assertCapturedInputs,
  captureDevelopmentSource,
  newDevelopmentBuildId,
  populateDevelopmentWorkspace,
  type SourceEntry,
  type SourceSnapshot,
} from './development-source.js'
import {
  acquireTargetLocks,
  developmentStateDirectory,
  privateDirectory,
  readPrivateJson,
  writePrivateJson,
} from './development-state.js'
import {
  enqueueDeployedValidation,
  recordDeployedCommit,
  startValidationWorker,
  type DeployedValidationRequest,
} from './development-validation.js'
import { VERSION_MESSAGE_ANNOTATION, VERSION_TAG_ANNOTATION } from './promote.js'
import {
  parseVerifyArgs,
  runVerifyLive,
  type VerifyFlags,
  type VerifyReport,
} from './verify-live.js'

export interface DevelopmentDeployFlags {
  handoff?: string
  /** Internal: exit deploys the exact integrated release while automation stays held. */
  releaseSha?: string
  /** Deploy a capture that changes protected paths; full validation is queued after it. */
  gated?: boolean
  /** The open `red-main` issue this deploy fixes; lifts the 24 h red-main guard. */
  redMainFix?: number
  dryRun: boolean
  json: boolean
}

export function parseDevelopmentDeployArgs(args: string[]): DevelopmentDeployFlags {
  const flags: DevelopmentDeployFlags = { dryRun: false, json: false }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--dry-run') flags.dryRun = true
    else if (arg === '--json') flags.json = true
    else if (arg === '--gated') flags.gated = true
    else if (arg === '--handoff') {
      const value = args[++index]
      if (!value?.trim() || value.startsWith('--')) throw new Error('--handoff requires text')
      flags.handoff = value
    } else if (arg === '--red-main-fix') {
      const value = args[++index]?.replace(/^#/u, '')
      if (!value || !/^[1-9]\d{0,9}$/u.test(value))
        throw new Error('--red-main-fix requires the red-main issue number')
      flags.redMainFix = Number(value)
    } else throw new Error(`Unknown development deploy option: ${arg}`)
  }
  return flags
}

/** Provider seam: the real client or an offline fake with the same surface. */
export type DevelopmentProviderClient = Pick<
  DevelopmentCloudflare,
  'inspect' | 'versions' | 'requiredSecrets' | 'promote'
>

/** The one GitHub read deploy:dev makes. */
export type DevelopmentDeployGitHub = Pick<DevelopmentGitHub, 'openRedMainIssues'>

export interface DevelopmentContext {
  cwd?: string
  env?: NodeJS.ProcessEnv
  stateDirectory?: string
  log?: (message: string) => void
  readSecret?: DevelopmentSecretReader
  provider?: (component: DevelopmentComponent) => DevelopmentProviderClient
  github?: (repository: string) => DevelopmentDeployGitHub
  run?: typeof runDevelopmentCommand
  upload?: typeof runDeploy
  verify?: (flags: VerifyFlags) => Promise<VerifyReport>
  /** Hand the deployed commit to background validation. Default: queue + detached worker. */
  queueValidation?: (request: DeployedValidationRequest) => string
  packageManagerVersion?: string
  now?: () => number
}

export interface ComponentReceipt {
  workerName: string
  accountId: string
  previousVersionId?: string
  candidateVersionId?: string
  servingVersionId?: string
  requiredSecretNames?: string[]
  /** Digests of the captured Wrangler binding declarations; never their values. */
  bindings?: BindingSurface
  proof?: {
    result: string
    attemptsUsed: number
    assertions: Array<{ id: string; status: string }>
  }
  behavior?: 'passed' | 'awaiting-owner' | 'failed'
  /** Script-level crons/routes applied after promote (not Workers Builds triggers). */
  triggers?: { crons?: string[]; routes?: string[] }
  status: 'pending' | 'built' | 'uploaded' | 'promoting' | 'serving' | 'proven' | 'failed'
}

export interface DevelopmentStep {
  name: string
  seconds: number
  status: 'passed' | 'failed'
}

export interface DevelopmentReceipt {
  schemaVersion: 1
  kind: 'development-deploy'
  buildId: string
  repository: string
  targetSet: string
  baseCommit: string
  sourceDigest?: string
  dirty?: boolean
  publisher: string
  toolVersion: string
  startedAt: string
  updatedAt: string
  phase: string
  outcome: DevelopmentOutcome
  productionMayHaveChanged: boolean
  /** Seconds per phase. */
  timings: Record<string, number>
  /** Seconds per step inside the phases: each check, build, upload, proof. */
  steps?: DevelopmentStep[]
  totalSeconds?: number
  dependencies?: { reused: boolean }
  /** The protected-path gate: what changed since the base, and what it matched. */
  gate?: {
    base: string
    changed: number
    protectedPaths: string[]
    bindingChanges: string[]
    gated: boolean
  }
  redMain?: {
    /** clear: no open red-main issue; red: open ones (refused once stale); fix: this deploy names one. */
    status: 'clear' | 'red' | 'fix' | 'unknown'
    open: number[]
    stale: number[]
    fix?: number
  }
  /** Full validation of the deployed commit, queued after a verified deploy. */
  validation?: {
    sha?: string
    source?: 'base-commit' | 'capture-commit'
    status: 'queued' | 'not-queued'
    worker?: string
    error?: string
  }
  rollback?: {
    decision: 'off' | 'page' | 'rolled-back' | 'failed'
    target?: string
    reasons?: string[]
  }
  components: Record<string, ComponentReceipt>
  failure?: string
  handoff?: string
}

const OUTCOME_TEXT: Record<DevelopmentOutcome, string> = {
  verified: 'Verified deployment',
  'awaiting-owner': 'Deployed, awaiting owner behavior proof',
  refused: 'Refused before deployment',
  'failed-before-traffic': 'Failed before traffic movement',
  unproven: 'Partially deployed or serving state unproven',
  'rolled-back': 'Proof failed; rolled back to the last verified build',
}

export function describeOutcome(outcome: DevelopmentOutcome): string {
  return OUTCOME_TEXT[outcome]
}

export function receiptDirectory(stateDirectory: string, repository: string, buildId: string) {
  return join(stateDirectory, 'receipts', repositoryKey(repository), buildId)
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function commandText(command: DevelopmentCommand): string {
  return [command.executable, ...command.args].join(' ')
}

/** Applied migration bytes are immutable; a later snapshot must carry them unchanged. */
export function assertAppliedMigrations(record: ActivationRecord, snapshot: SourceSnapshot): void {
  const entries = new Map(snapshot.entries.map((entry) => [entry.path, entry]))
  for (const migration of record.appliedMigrations) {
    for (const file of migration.files) {
      const entry = entries.get(file.path)
      if (!entry || entry.kind !== 'file' || entry.digest !== file.sha256)
        throw new Error(
          `Applied migration ${file.path} (commit ${migration.commit.slice(0, 12)}) was edited, renamed or deleted; add a new migration instead`,
        )
    }
  }
}

export function verifyFlagsFor(
  project: DevelopmentProject,
  component: DevelopmentComponent,
  buildId: string,
): VerifyFlags {
  const proof = project.deployment.liveProof
  return parseVerifyArgs([
    '--live',
    component.origins[0],
    '--expect-build-id',
    buildId,
    '--build-version-header',
    proof.buildVersionHeader,
    ...healthArgs(proof),
    '--smoke-path',
    proof.smokePath,
    '--attempts',
    String(proof.attempts),
    '--interval-seconds',
    String(proof.intervalSeconds),
  ])
}

/** Retain serving, previous known-good and unresolved evidence; prune the rest. */
function retain(stateDirectory: string, record: ActivationRecord, keep: string[]): void {
  const base = join(stateDirectory, 'receipts', repositoryKey(record.repository))
  if (!existsSync(base)) return
  const protectedIds = new Set([
    ...keep,
    ...record.knownGood,
    ...(record.pendingAttempt ? [record.pendingAttempt.buildId] : []),
    ...(record.pin?.buildId ? [record.pin.buildId] : []),
  ])
  for (const id of readdirSync(base)) {
    if (!protectedIds.has(id)) rmSync(join(base, id), { recursive: true, force: true })
  }
}

/** Binding digests of every component's captured Wrangler config. */
function captureBindings(
  workspace: string,
  components: Array<{ id: string; component: DevelopmentComponent }>,
): Record<string, BindingSurface> {
  return Object.fromEntries(
    components.map(({ id, component }) => [
      id,
      bindingSurface(readJsonc<unknown>(join(workspace, component.wranglerConfig))),
    ]),
  )
}

/**
 * What changed since the last verified capture on this workstation, or since
 * the merge base with the production branch when there is none (first deploy
 * after enter or handoff). `undefined` when no base can be established.
 */
function changesSinceBase(
  stateDirectory: string,
  project: DevelopmentProject,
  record: ActivationRecord,
  snapshot: SourceSnapshot,
):
  | { base: string; paths: string[]; bindings: Record<string, BindingSurface | undefined> }
  | undefined {
  const verified = record.knownGood[0]
  if (verified) {
    const directory = receiptDirectory(stateDirectory, project.repository, verified)
    const manifestPath = join(directory, 'source-manifest.json')
    if (existsSync(manifestPath)) {
      const manifest = readPrivateJson(manifestPath) as { entries: SourceEntry[] }
      const receipt = existsSync(join(directory, 'receipt.json'))
        ? (readPrivateJson(join(directory, 'receipt.json')) as DevelopmentReceipt)
        : undefined
      return {
        base: `last verified ${verified}`,
        paths: changedSourcePaths(manifest.entries, snapshot.entries),
        bindings: Object.fromEntries(
          Object.entries(receipt?.components ?? {}).map(([id, component]) => [
            id,
            component.bindings,
          ]),
        ),
      }
    }
  }
  const branch = project.deployment.productionBranch
  try {
    const base = developmentGit(project.checkout, [
      'merge-base',
      snapshot.baseCommit,
      `refs/remotes/origin/${branch}`,
    ])
    const tracked = developmentGit(project.checkout, [
      'diff',
      '--name-only',
      '-z',
      '--no-renames',
      base,
    ])
    const untracked = developmentGit(project.checkout, [
      'ls-files',
      '--others',
      '--exclude-standard',
      '-z',
    ])
    const bindings: Record<string, BindingSurface | undefined> = {}
    for (const [id, component] of Object.entries(project.development.components)) {
      try {
        const errors: ParseError[] = []
        const config = parseJsonc(
          developmentGit(project.checkout, ['show', `${base}:${component.wranglerConfig}`]),
          errors,
          { allowTrailingComma: true },
        ) as unknown
        bindings[id] = errors.length ? undefined : bindingSurface(config)
      } catch {
        bindings[id] = undefined
      }
    }
    return {
      base: `origin/${branch} merge base ${base.slice(0, 12)}`,
      paths: [...new Set(`${tracked}\0${untracked}`.split('\0').filter(Boolean))].sort(),
      bindings,
    }
  } catch {
    return undefined
  }
}

export interface RollbackResult {
  proven: boolean
  serving: Record<string, string>
  failure?: string
}

/**
 * Move every component back to the known-good build's versions and prove them
 * against that build's ID. The caller holds the target lock and has planned
 * the rollback (planDevelopmentRollback).
 */
export async function rollBackDevelopmentTarget(args: {
  project: DevelopmentProject
  components: Array<{ id: string; component: DevelopmentComponent }>
  provider: (id: string) => DevelopmentProviderClient
  plan: { buildId: string; versions: Record<string, string> }
  message: string
  verify: (flags: VerifyFlags) => Promise<VerifyReport>
  log: (message: string) => void
}): Promise<RollbackResult> {
  const serving: Record<string, string> = {}
  try {
    for (const { id } of args.components) {
      const provider = args.provider(id)
      const target = args.plan.versions[id]
      if ((await provider.inspect()).versionId !== target)
        await provider.promote(target, args.message)
      serving[id] = (await provider.inspect()).versionId
      if (serving[id] !== target) throw new Error(`${id} did not start serving ${target}`)
      args.log(`[development] ${id} serves ${target} (${args.plan.buildId})`)
    }
    for (const { id, component } of args.components) {
      const proof = await args.verify(verifyFlagsFor(args.project, component, args.plan.buildId))
      if (proof.exitCode !== 0 || proof.result !== 'PASS')
        throw new Error(`${id} live proof of ${args.plan.buildId} failed after rollback`)
    }
    return { proven: true, serving }
  } catch (error) {
    return {
      proven: false,
      serving,
      failure: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function runDevelopmentDeploy(
  flags: DevelopmentDeployFlags,
  context: DevelopmentContext = {},
): Promise<DevelopmentReceipt> {
  const env = context.env ?? process.env
  const log = context.log ?? ((message: string) => console.error(message))
  const stateDirectory = context.stateDirectory ?? developmentStateDirectory(env)
  const readSecret = context.readSecret ?? readDevelopmentSecret
  const run = context.run ?? runDevelopmentCommand
  const verify = context.verify ?? ((verifyFlags: VerifyFlags) => runVerifyLive(verifyFlags))
  const now = context.now ?? (() => Date.now())
  const project = loadDevelopmentProject(context.cwd)
  const record = readActivation(project.repository, stateDirectory)
  const allowed = flags.releaseSha ? ['exiting', 'restoring'] : ['active']
  if (!record || !allowed.includes(record.mode))
    throw new Error(
      record
        ? `Development mode is ${record.mode}; deploy:dev runs only while active`
        : 'This repository is not enrolled on this workstation; ask the owner, then run development enter',
    )
  assertPublisher(record, project)
  if (record.pin)
    throw new Error(
      `Feedback pin is active (${record.pin.scenario}); close it with development unpin --feedback-ref <ref>`,
    )
  if (record.pendingAttempt)
    throw new Error(
      `Attempt ${record.pendingAttempt.buildId} is unresolved; run development status --remote and development resolve first`,
    )
  const components = targetsFor(project, record.targetSet).map(({ id }) => ({
    id,
    component: project.development.components[id],
  }))
  const buildId = newDevelopmentBuildId()
  const directory = receiptDirectory(stateDirectory, project.repository, buildId)
  const receiptPath = join(directory, 'receipt.json')
  const receipt: DevelopmentReceipt = {
    schemaVersion: 1,
    kind: 'development-deploy',
    buildId,
    repository: project.repository,
    targetSet: record.targetSet,
    baseCommit: '',
    publisher: record.publisher,
    toolVersion: toolVersion(),
    startedAt: new Date().toISOString(),
    updatedAt: '',
    phase: 'planned',
    outcome: 'refused',
    productionMayHaveChanged: false,
    timings: {},
    steps: [],
    components: Object.fromEntries(
      components.map(({ id, component }) => [
        id,
        { workerName: component.workerName, accountId: component.accountId, status: 'pending' },
      ]),
    ),
    handoff: flags.handoff,
  }
  log(`[deploy:dev] ${project.repository} target-set=${record.targetSet} build=${buildId}`)
  for (const { component } of components)
    log(`[deploy:dev]   ${component.workerName} → ${component.origins.join(', ')}`)
  if (flags.dryRun) {
    log(
      '[deploy:dev] dry run: red-main guard → capture → protected paths → install if changed → checks → build → assert → schema → upload → promote → triggers → proof → queue validation',
    )
    return receipt
  }
  const started = now()
  const seconds = (from: number): number => Math.round((now() - from) / 100) / 10
  const save = (phase: string): void => {
    receipt.phase = phase
    receipt.updatedAt = new Date().toISOString()
    receipt.totalSeconds = seconds(started)
    writePrivateJson(receiptPath, receipt)
  }
  let phaseStarted = now()
  const closePhase = (): void => {
    if (receipt.phase !== 'planned') receipt.timings[receipt.phase] = seconds(phaseStarted)
    phaseStarted = now()
  }
  const phase = (name: string): void => {
    closePhase()
    save(name)
    log(`[deploy:dev] ${name}`)
  }
  /** Time one step inside the current phase; a throw is recorded, then rethrown. */
  const step = async <T>(name: string, work: () => T | Promise<T>): Promise<T> => {
    const from = now()
    try {
      const result = await work()
      receipt.steps!.push({ name, seconds: seconds(from), status: 'passed' })
      return result
    } catch (error) {
      receipt.steps!.push({ name, seconds: seconds(from), status: 'failed' })
      throw error
    }
  }
  privateDirectory(directory)
  const lock = acquireTargetLocks(
    components.map(({ component }) => ({
      accountId: component.accountId,
      workerName: component.workerName,
    })),
    'development-deploy',
    receiptPath,
    stateDirectory,
  )
  const providers = new Map(
    components.map(({ id, component }) => [
      id,
      context.provider?.(component) ?? new DevelopmentCloudflare(component, readSecret),
    ]),
  )
  const serving = new Map<string, DevelopmentProviderState>()
  let snapshotDirectory: string | undefined
  let proofFailed = false
  try {
    if (!flags.releaseSha) {
      phase('guarding')
      await step('red-main', () =>
        guardRedMain(flags, project.repository, receipt, context, now, log),
      )
    }

    phase('inspecting')
    for (const { id } of components) {
      const state = await step(`inspect:${id}`, () => providers.get(id)!.inspect())
      if (record.expectedServing[id] && state.versionId !== record.expectedServing[id])
        throw new Error(
          `${id} serves ${state.versionId}, not the recorded ${record.expectedServing[id]}; inspect the change, then record it with development exec --operation recovery`,
        )
      serving.set(id, state)
      receipt.components[id].previousVersionId = state.versionId
    }

    phase('capturing')
    snapshotDirectory = join(stateDirectory, 'snapshots', buildId)
    const captured = await step('capture', () =>
      captureDevelopmentSource(project.checkout, snapshotDirectory!, {
        additional: project.development.additionalBuildInputs,
      }),
    )
    receipt.baseCommit = captured.baseCommit
    receipt.sourceDigest = captured.digest
    // Porcelain is empty only when the captured bytes are exactly the base commit.
    receipt.dirty = Boolean(runGitStatus(project.checkout))
    if (flags.releaseSha && (receipt.dirty || captured.baseCommit !== flags.releaseSha))
      throw new Error('The release deployment must capture the clean merged release commit')
    writePrivateJson(join(directory, 'source-manifest.json'), captured)
    assertAppliedMigrations(record, captured)

    const workspace = join(stateDirectory, 'workspaces', repositoryKey(project.repository))
    await step('workspace', () => populateDevelopmentWorkspace(captured, workspace))
    const bindings = captureBindings(workspace, components)
    for (const { id } of components) receipt.components[id].bindings = bindings[id]
    // The exit release was validated by CI before exit deploys it.
    if (!flags.releaseSha)
      await step('protected-paths', () =>
        guardProtectedPaths(
          flags,
          project,
          record,
          captured,
          bindings,
          receipt,
          stateDirectory,
          log,
        ),
      )

    phase('dependencies')
    receipt.dependencies = {
      reused: prepareDevelopmentDependencies(
        captured,
        workspace,
        join(stateDirectory, 'cache', repositoryKey(project.repository)),
        project.development.install,
        context.packageManagerVersion ?? packageManagerVersion(project.checkout),
        {
          run,
          env,
          secrets: () =>
            Object.fromEntries(
              Object.entries(project.development.installSecrets).map(([name, selector]) => {
                const value = readSecret(selector)
                if (!value.trim()) throw new Error(`Required install input ${name} is missing`)
                return [name, value]
              }),
            ),
        },
      ).reused,
    }

    phase('checking')
    const checkEnv = {
      ...developmentSystemEnv(env),
      ...components[0].component.buildVariables,
      CI: 'true',
      NUXT_TELEMETRY_DISABLED: '1',
    }
    for (const command of project.development.targetSets[record.targetSet].checks)
      await step(`check:${commandText(command)}`, () => run(command, workspace, checkEnv, { log }))
    assertCapturedInputs(captured, workspace)

    phase('building')
    const secretValues: string[] = []
    for (const { id, component } of components) {
      const buildEnv = developmentBuildEnvironment(component, buildId, readSecret, env)
      for (const name of Object.keys(component.buildSecrets)) secretValues.push(buildEnv[name]!)
      rmSync(join(workspace, component.artifactDirectory), { recursive: true, force: true })
      await step(`build:${id}`, () =>
        run(component.build, workspace, buildEnv, { log, redact: secretValues }),
      )
      assertCapturedInputs(captured, workspace)
      await step(`assert:${id}`, () =>
        run(
          component.assertArtifact,
          workspace,
          {
            ...developmentSystemEnv(env),
            NARDUK_DEVELOPMENT_BUILD_ID: buildId,
            NARDUK_DEVELOPMENT_ARTIFACT_DIR: join(workspace, component.artifactDirectory),
          },
          { log, redact: secretValues },
        ),
      )
      const leaks = scanPublicAssetsForSecretLeaks(
        join(workspace, component.appDir),
        Object.fromEntries(secretValues.map((value, index) => [`secret-${index}`, value])),
      )
      if (leaks.length)
        throw new Error(`A build secret appears in ${id} public assets; refusing upload`)
      receipt.components[id].status = 'built'
    }

    phase('schema')
    for (const { id, component } of components) {
      for (const check of component.schemaChecks) {
        const checkSecrets = Object.fromEntries(
          Object.entries(check.readOnlyCredentials).map(([name, selector]) => [
            name,
            readSecret(selector),
          ]),
        )
        await step(`schema:${id}:${commandText(check.command)}`, () =>
          run(
            check.command,
            workspace,
            { ...developmentSystemEnv(env), CI: 'true', ...checkSecrets },
            { log, redact: Object.values(checkSecrets) },
          ),
        )
      }
    }

    phase('uploading')
    const message = `narduk-app development ${buildId}`
    for (const { id, component } of components) {
      const provider = providers.get(id)!
      const again = await provider.inspect()
      if (again.versionId !== serving.get(id)!.versionId)
        throw new Error(`${id} changed while building; no upload requested`)
      const deployEnv: NodeJS.ProcessEnv = {
        ...developmentSystemEnv(env),
        CLOUDFLARE_ACCOUNT_ID: component.accountId,
        CLOUDFLARE_API_TOKEN: readSecret(component.deploymentCredential),
        NARDUK_ALLOW_LOCAL_WRANGLER_DEPLOY: '1',
        WRANGLER_SEND_METRICS: 'false',
        CI: 'true',
      }
      const upload = context.upload ?? runDeploy
      const status = await step(`upload:${id}`, () =>
        upload(
          ['versions-upload', '--tag', buildId, '--message', message],
          join(workspace, component.appDir),
          deployEnv,
          { keepVars: true },
        ),
      )
      if (status !== 0) throw new Error(`${id} upload failed; no traffic was moved`)
      const matches = (await provider.versions()).filter(
        (version) =>
          version.annotations?.[VERSION_TAG_ANNOTATION] === buildId &&
          version.annotations?.[VERSION_MESSAGE_ANNOTATION] === message,
      )
      if (matches.length !== 1 || !z.uuid().safeParse(matches[0].id).success)
        throw new Error(`Cannot uniquely identify the ${id} upload; no traffic was moved`)
      receipt.components[id].candidateVersionId = matches[0].id
      receipt.components[id].requiredSecretNames = await provider.requiredSecrets(matches[0].id)
      receipt.components[id].status = 'uploaded'
    }

    // Everything is checked, built and uploaded before the first promotion.
    for (const { id } of components) {
      const provider = providers.get(id)!
      const state = await provider.inspect()
      if (state.versionId !== serving.get(id)!.versionId)
        throw new Error(`${id} serving version changed after upload; candidates are stale`)
      if (state.newestVersionId !== receipt.components[id].candidateVersionId)
        throw new Error(
          `A newer ${id} version (secret or configuration change) superseded the candidate; deploy again`,
        )
    }
    record.pendingAttempt = { buildId, receipt: receiptPath, startedAt: receipt.startedAt }
    writeActivation(record, stateDirectory, 'promotion-intent', buildId)
    receipt.productionMayHaveChanged = true
    phase('promoting')
    let awaitingOwner = false
    for (const { id, component } of components) {
      const provider = providers.get(id)!
      const candidate = receipt.components[id].candidateVersionId!
      receipt.components[id].status = 'promoting'
      save('promoting')
      await step(`promote:${id}`, () => provider.promote(candidate, message))
      const deployEnv: NodeJS.ProcessEnv = {
        ...developmentSystemEnv(env),
        CLOUDFLARE_ACCOUNT_ID: component.accountId,
        CLOUDFLARE_API_TOKEN: readSecret(component.deploymentCredential),
        NARDUK_ALLOW_LOCAL_WRANGLER_DEPLOY: '1',
        WRANGLER_SEND_METRICS: 'false',
        CI: 'true',
      }
      const upload = context.upload ?? runDeploy
      const appDir = join(workspace, component.appDir)
      let applyStatus: number
      try {
        applyStatus = await step(`triggers:${id}`, () =>
          upload(['triggers-deploy'], appDir, deployEnv),
        )
      } catch (error) {
        receipt.components[id].status = 'failed'
        throw error
      }
      if (applyStatus !== 0) {
        receipt.components[id].status = 'failed'
        throw new Error(
          `${id} trigger apply failed; inspect script schedules and routes before retrying`,
        )
      }
      const declared = readDeclaredScriptTriggers(appDir)
      receipt.components[id].triggers = {
        crons: declared.triggers.crons,
        routes: declared.triggers.routes?.map(routePattern),
      }
      log(
        `[deploy:dev]   ${id} script triggers from ${declared.source}: crons=${JSON.stringify(declared.triggers.crons ?? '(unchanged)')} routes=${JSON.stringify(receipt.components[id].triggers.routes ?? '(unchanged)')}`,
      )
      const actual = await provider.inspect()
      receipt.components[id].servingVersionId = actual.versionId
      record.expectedServing[id] = actual.versionId
      if (actual.versionId !== candidate)
        throw new Error(`${id} did not start serving the candidate; inspect provider state`)
      receipt.components[id].status = 'serving'
      save('proving')
      const proof = await step(`proof:${id}`, () =>
        verify(verifyFlagsFor(project, component, buildId)),
      )
      receipt.components[id].proof = {
        result: proof.result,
        attemptsUsed: proof.attemptsUsed,
        assertions: proof.assertions.map(({ id: assertion, status }) => ({
          id: assertion,
          status,
        })),
      }
      if (proof.exitCode !== 0 || proof.result !== 'PASS') {
        receipt.components[id].status = 'failed'
        proofFailed = true
        throw new Error(`${id} live proof failed; it serves ${candidate} without proof`)
      }
      if (component.behavior.kind === 'command') {
        const behavior = component.behavior
        try {
          await step(`behavior:${id}`, () =>
            run(
              behavior.command,
              workspace,
              {
                ...developmentSystemEnv(env),
                NARDUK_DEVELOPMENT_BUILD_ID: buildId,
                NARDUK_DEVELOPMENT_ORIGIN: component.origins[0],
              },
              { log },
            ),
          )
          receipt.components[id].behavior = 'passed'
        } catch (error) {
          receipt.components[id].behavior = 'failed'
          proofFailed = true
          throw error
        }
      } else {
        receipt.components[id].behavior = 'awaiting-owner'
        awaitingOwner = true
      }
      receipt.components[id].status = 'proven'
    }
    for (const { id } of components) {
      if (
        (await providers.get(id)!.inspect()).versionId !== receipt.components[id].candidateVersionId
      )
        throw new Error(`${id} changed during live proof; success is unproven`)
    }
    receipt.outcome = awaitingOwner ? 'awaiting-owner' : 'verified'
    delete record.pendingAttempt
    record.lastReceipt = receiptPath
    record.knownGood = [buildId, ...record.knownGood.filter((id) => id !== buildId)].slice(0, 2)
    if (flags.handoff) {
      record.pin = {
        scenario: flags.handoff,
        scenarioDigest: createHash('sha256').update(flags.handoff).digest('hex'),
        pinnedAt: new Date().toISOString(),
        versions: { ...record.expectedServing },
        buildId,
      }
    }
    for (const { component } of components) {
      const artifact = join(workspace, component.artifactDirectory)
      if (existsSync(artifact))
        cpSync(artifact, join(directory, 'artifacts', component.workerName), { recursive: true })
    }
    cpSync(captured.directory, join(directory, 'source'), {
      recursive: true,
      verbatimSymlinks: true,
    })
    // The exit release is already validated; every other verified deploy is
    // validated in full after the fact, without waiting (O-D4).
    if (!flags.releaseSha) {
      try {
        await step('queue-validation', () =>
          queueValidation(flags, project, captured, receipt, context, stateDirectory, env, log),
        )
      } catch {
        // Recorded as not-queued in the receipt; the verified deploy stands.
      }
    }
    closePhase()
    save(receipt.outcome)
    writeActivation(record, stateDirectory, 'deployed', `${buildId} ${receipt.outcome}`)
    retain(stateDirectory, record, [buildId])
    log(`[deploy:dev] ${describeOutcome(receipt.outcome)}: ${buildId}`)
    log(`[deploy:dev] ${formatTimings(receipt)}`)
    if (flags.handoff) log(`[deploy:dev] feedback pin established: ${flags.handoff}`)
    return receipt
  } catch (error) {
    receipt.failure = error instanceof Error ? error.message : String(error)
    closePhase()
    if (!receipt.productionMayHaveChanged) {
      receipt.outcome = receipt.phase === 'uploading' ? 'failed-before-traffic' : 'refused'
    } else {
      receipt.outcome = 'unproven'
      // Record the actual serving state before deciding anything else.
      let servingKnown = false
      try {
        for (const { id } of components) {
          const actual = await providers.get(id)!.inspect()
          receipt.components[id].servingVersionId = actual.versionId
          record.expectedServing[id] = actual.versionId
        }
        delete record.pendingAttempt
        record.lastReceipt = receiptPath
        servingKnown = true
      } catch {
        log('[deploy:dev] serving state could not be read; the attempt stays unresolved')
      }
      let rolledBack = false
      if (proofFailed && servingKnown) {
        const from = now()
        rolledBack = await afterFailedProof(project, record, components, providers, receipt, {
          stateDirectory,
          verify,
          log,
        })
        if (rolledBack) receipt.outcome = 'rolled-back'
        receipt.timings.rollback = seconds(from)
      }
      writeActivation(
        record,
        stateDirectory,
        rolledBack ? 'deploy-rolled-back' : 'deploy-unproven',
        buildId,
      )
    }
    save(receipt.outcome)
    log(`[deploy:dev] ${describeOutcome(receipt.outcome)}: ${receipt.failure}`)
    log(`[deploy:dev] ${formatTimings(receipt)}`)
    log(`[deploy:dev] receipt=${receiptPath}`)
    return receipt
  } finally {
    lock.release()
    if (snapshotDirectory) rmSync(snapshotDirectory, { recursive: true, force: true })
  }
}

/** One line: total, then each phase with its slowest steps. */
export function formatTimings(receipt: DevelopmentReceipt): string {
  const phases = Object.entries(receipt.timings)
    .map(([name, value]) => `${name} ${value}s`)
    .join(', ')
  const slowest = [...(receipt.steps ?? [])]
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, 5)
    .map((item) => `${item.name} ${item.seconds}s${item.status === 'failed' ? ' (failed)' : ''}`)
    .join(', ')
  return `timings: total ${receipt.totalSeconds ?? '?'}s; ${phases}${slowest ? `; slowest: ${slowest}` : ''}`
}

async function guardRedMain(
  flags: DevelopmentDeployFlags,
  repository: string,
  receipt: DevelopmentReceipt,
  context: DevelopmentContext,
  now: () => number,
  log: (message: string) => void,
): Promise<void> {
  let issues: RedMainIssue[]
  try {
    issues = (context.github?.(repository) ?? new DevelopmentGitHub(repository)).openRedMainIssues()
  } catch {
    // Unknown is recorded as unknown. The guard stops red from accumulating;
    // it is not the gate on this deploy, so an unreachable GitHub does not
    // stop the loop.
    receipt.redMain = { status: 'unknown', open: [], stale: [], fix: flags.redMainFix }
    log('[deploy:dev] WARNING: could not read red-main issues; the 24 h red-main guard did not run')
    return
  }
  const assessment = assessRedMain(issues, now(), flags.redMainFix)
  receipt.redMain = {
    status: flags.redMainFix !== undefined ? 'fix' : issues.length ? 'red' : 'clear',
    open: issues.map((issue) => issue.number),
    stale: assessment.stale.map((issue) => issue.number),
    fix: flags.redMainFix,
  }
  if (assessment.refusal) throw new Error(assessment.refusal)
  if (issues.length)
    log(
      `[deploy:dev] main is red: ${issues.map((issue) => `#${issue.number} ${issue.title}`).join('; ')}`,
    )
}

function guardProtectedPaths(
  flags: DevelopmentDeployFlags,
  project: DevelopmentProject,
  record: ActivationRecord,
  snapshot: SourceSnapshot,
  bindings: Record<string, BindingSurface>,
  receipt: DevelopmentReceipt,
  stateDirectory: string,
  log: (message: string) => void,
): void {
  const changes = changesSinceBase(stateDirectory, project, record, snapshot)
  if (!changes) {
    receipt.gate = {
      base: 'unknown',
      changed: 0,
      protectedPaths: [],
      bindingChanges: [],
      gated: Boolean(flags.gated),
    }
    if (!flags.gated)
      throw new Error(
        `No base to diff this capture against (no verified capture here, and origin/${project.deployment.productionBranch} is not fetched); fetch it, or deploy with --gated`,
      )
    return
  }
  const matched = matchProtectedPaths(changes.paths, protectedPatterns(project.development))
  const changedPaths = new Set(changes.paths)
  const bindingReasons: string[] = []
  for (const [id, component] of Object.entries(project.development.components)) {
    if (!bindings[id]) continue
    // An unknown base surface (a receipt from before binding digests, or no
    // config at the base) matters only when the config itself moved.
    if (changes.bindings[id] || changedPaths.has(component.wranglerConfig))
      bindingReasons.push(...bindingChanges(id, changes.bindings[id], bindings[id]))
  }
  receipt.gate = {
    base: changes.base,
    changed: changes.paths.length,
    protectedPaths: matched,
    bindingChanges: bindingReasons,
    gated: Boolean(flags.gated),
  }
  if (!matched.length && !bindingReasons.length) return
  const listed = [
    ...matched.slice(0, 10),
    ...(matched.length > 10 ? [`and ${matched.length - 10} more`] : []),
  ]
  const summary = [...listed, ...bindingReasons].join('; ')
  if (!flags.gated)
    throw new Error(
      `Protected changes since ${changes.base}: ${summary}. These take the gated route: deploy with --gated (full validation is queued after the deploy), or land them through a reviewed pull request`,
    )
  log(`[deploy:dev] gated deploy of protected changes: ${summary}`)
}

function queueValidation(
  flags: DevelopmentDeployFlags,
  project: DevelopmentProject,
  snapshot: SourceSnapshot,
  receipt: DevelopmentReceipt,
  context: DevelopmentContext,
  stateDirectory: string,
  env: NodeJS.ProcessEnv,
  log: (message: string) => void,
): void {
  try {
    const sha = recordDeployedCommit(
      project.checkout,
      snapshot,
      receipt.buildId,
      Boolean(receipt.dirty),
    )
    const request: DeployedValidationRequest = {
      repository: project.repository,
      checkout: project.checkout,
      sha,
      buildId: receipt.buildId,
      reason: `${receipt.outcome} development deploy ${receipt.buildId}${flags.gated ? ' (gated)' : ''}`,
      gated: Boolean(flags.gated),
      queuedAt: new Date().toISOString(),
    }
    const worker =
      context.queueValidation?.(request) ??
      (enqueueDeployedValidation(request, stateDirectory),
      startValidationWorker(request, stateDirectory, env))
    receipt.validation = {
      sha,
      source: sha === snapshot.baseCommit ? 'base-commit' : 'capture-commit',
      status: 'queued',
      worker,
    }
    log(
      `[deploy:dev] full validation of ${sha} queued (${worker}); the deploy does not wait for it`,
    )
  } catch (error) {
    receipt.validation = {
      status: 'not-queued',
      error: error instanceof Error ? error.message : String(error),
    }
    log(
      `[deploy:dev] WARNING: full validation was not queued (${receipt.validation.error}); run development validate`,
    )
    throw error
  }
}

async function afterFailedProof(
  project: DevelopmentProject,
  record: ActivationRecord,
  components: Array<{ id: string; component: DevelopmentComponent }>,
  providers: Map<string, DevelopmentProviderClient>,
  receipt: DevelopmentReceipt,
  context: {
    stateDirectory: string
    verify: (flags: VerifyFlags) => Promise<VerifyReport>
    log: (message: string) => void
  },
): Promise<boolean> {
  const plan = planDevelopmentRollback({
    stateDirectory: context.stateDirectory,
    record,
    targetBuildId: record.knownGood[0],
    components: components.map(({ id }) => id),
    current: Object.fromEntries(components.map(({ id }) => [id, receipt.components[id].bindings])),
  })
  if (plan.kind === 'page') {
    receipt.rollback = { decision: 'page', target: plan.buildId, reasons: plan.reasons }
    context.log(
      `[deploy:dev] PAGE: proof failed and a rollback is not safe: ${plan.reasons.join('; ')}. It is serving; fix forward or decide by hand`,
    )
    return false
  }
  if (!project.development.rollback?.automatic) {
    receipt.rollback = { decision: 'off', target: plan.buildId }
    context.log(
      `[deploy:dev] automatic rollback is off for this app until a live rehearsal (deployment.development.rollback). To roll back now: narduk-app development rollback --to ${plan.buildId}`,
    )
    return false
  }
  context.log(`[deploy:dev] proof failed; rolling back to ${plan.buildId}`)
  const result = await rollBackDevelopmentTarget({
    project,
    components,
    provider: (id) => providers.get(id)!,
    plan,
    message: `narduk-app development rollback ${receipt.buildId} -> ${plan.buildId}`,
    verify: context.verify,
    log: context.log,
  })
  for (const [id, version] of Object.entries(result.serving)) {
    receipt.components[id].servingVersionId = version
    record.expectedServing[id] = version
  }
  if (result.proven) {
    receipt.rollback = { decision: 'rolled-back', target: plan.buildId }
    return true
  }
  receipt.rollback = {
    decision: 'failed',
    target: plan.buildId,
    reasons: [result.failure ?? 'unknown'],
  }
  context.log(`[deploy:dev] PAGE: rollback to ${plan.buildId} did not prove: ${result.failure}`)
  return false
}

function runGitStatus(checkout: string): string {
  return developmentGit(checkout, ['status', '--porcelain', '--untracked-files=all'])
}

function packageManagerVersion(checkout: string): string {
  const pkg = JSON.parse(readFileSync(join(checkout, 'package.json'), 'utf8')) as {
    packageManager?: string
  }
  if (!pkg.packageManager) throw new Error('Declare packageManager in the root package.json')
  return pkg.packageManager
}

export { sha256 as developmentFileDigest }
