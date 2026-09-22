/** The ordinary loop: capture → gate → build → assert → inspect → upload → promote → prove. */
import { cpSync, existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

import { z } from 'zod'

import { runDeploy } from './deploy.js'
import { scanPublicAssetsForSecretLeaks } from './deploy-local.js'
import type { DevelopmentComponent } from './development-config.js'
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
import {
  assertCapturedInputs,
  captureDevelopmentSource,
  newDevelopmentBuildId,
  populateDevelopmentWorkspace,
  type SourceSnapshot,
} from './development-source.js'
import {
  acquireTargetLocks,
  developmentStateDirectory,
  privateDirectory,
  writePrivateJson,
} from './development-state.js'
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
  dryRun: boolean
  json: boolean
}

export function parseDevelopmentDeployArgs(args: string[]): DevelopmentDeployFlags {
  const flags: DevelopmentDeployFlags = { dryRun: false, json: false }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--dry-run') flags.dryRun = true
    else if (arg === '--json') flags.json = true
    else if (arg === '--handoff') {
      const value = args[++index]
      if (!value?.trim() || value.startsWith('--')) throw new Error('--handoff requires text')
      flags.handoff = value
    } else throw new Error(`Unknown development deploy option: ${arg}`)
  }
  return flags
}

/** Provider seam: the real client or an offline fake with the same surface. */
export type DevelopmentProviderClient = Pick<
  DevelopmentCloudflare,
  'inspect' | 'versions' | 'requiredSecrets' | 'promote'
>

export interface DevelopmentContext {
  cwd?: string
  env?: NodeJS.ProcessEnv
  stateDirectory?: string
  log?: (message: string) => void
  readSecret?: DevelopmentSecretReader
  provider?: (component: DevelopmentComponent) => DevelopmentProviderClient
  run?: typeof runDevelopmentCommand
  upload?: typeof runDeploy
  verify?: (flags: VerifyFlags) => Promise<VerifyReport>
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
  proof?: {
    result: string
    attemptsUsed: number
    assertions: Array<{ id: string; status: string }>
  }
  behavior?: 'passed' | 'awaiting-owner' | 'failed'
  status: 'pending' | 'built' | 'uploaded' | 'promoting' | 'serving' | 'proven' | 'failed'
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
  timings: Record<string, number>
  dependencies?: { reused: boolean }
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

function verifyFlagsFor(
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
    '--health-path',
    proof.healthPath,
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

export async function runDevelopmentDeploy(
  flags: DevelopmentDeployFlags,
  context: DevelopmentContext = {},
): Promise<DevelopmentReceipt> {
  const env = context.env ?? process.env
  const log = context.log ?? ((message: string) => console.error(message))
  const stateDirectory = context.stateDirectory ?? developmentStateDirectory(env)
  const readSecret = context.readSecret ?? readDevelopmentSecret
  const run = context.run ?? runDevelopmentCommand
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
      '[deploy:dev] dry run: capture → install if changed → checks → build → assert → schema → upload → promote → proof',
    )
    return receipt
  }
  const save = (phase: string): void => {
    receipt.phase = phase
    receipt.updatedAt = new Date().toISOString()
    writePrivateJson(receiptPath, receipt)
  }
  let phaseStarted = now()
  const phase = (name: string): void => {
    const previous = receipt.phase
    if (previous !== 'planned')
      receipt.timings[previous] = Math.round((now() - phaseStarted) / 100) / 10
    phaseStarted = now()
    save(name)
    log(`[deploy:dev] ${name}`)
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
  try {
    phase('inspecting')
    for (const { id } of components) {
      const state = await providers.get(id)!.inspect()
      if (record.expectedServing[id] && state.versionId !== record.expectedServing[id])
        throw new Error(
          `${id} serves ${state.versionId}, not the recorded ${record.expectedServing[id]}; inspect the change, then record it with development exec --operation recovery`,
        )
      serving.set(id, state)
      receipt.components[id].previousVersionId = state.versionId
    }

    phase('capturing')
    snapshotDirectory = join(stateDirectory, 'snapshots', buildId)
    const snapshot = captureDevelopmentSource(project.checkout, snapshotDirectory, {
      additional: project.development.additionalBuildInputs,
    })
    receipt.baseCommit = snapshot.baseCommit
    receipt.sourceDigest = snapshot.digest
    // Porcelain is empty only when the captured bytes are exactly the base commit.
    receipt.dirty = Boolean(runGitStatus(project.checkout))
    if (flags.releaseSha && (receipt.dirty || snapshot.baseCommit !== flags.releaseSha))
      throw new Error('The release deployment must capture the clean merged release commit')
    writePrivateJson(join(directory, 'source-manifest.json'), snapshot)
    assertAppliedMigrations(record, snapshot)

    const workspace = join(stateDirectory, 'workspaces', repositoryKey(project.repository))
    populateDevelopmentWorkspace(snapshot, workspace)
    phase('dependencies')
    receipt.dependencies = {
      reused: prepareDevelopmentDependencies(
        snapshot,
        workspace,
        join(stateDirectory, 'cache', repositoryKey(project.repository)),
        project.development.install,
        context.packageManagerVersion ?? packageManagerVersion(project.checkout),
        { run, env },
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
      run(command, workspace, checkEnv, { log })
    assertCapturedInputs(snapshot, workspace)

    phase('building')
    const secretValues: string[] = []
    for (const { id, component } of components) {
      const buildEnv = developmentBuildEnvironment(component, buildId, readSecret, env)
      for (const name of Object.keys(component.buildSecrets)) secretValues.push(buildEnv[name]!)
      rmSync(join(workspace, component.artifactDirectory), { recursive: true, force: true })
      run(component.build, workspace, buildEnv, { log, redact: secretValues })
      assertCapturedInputs(snapshot, workspace)
      run(
        component.assertArtifact,
        workspace,
        {
          ...developmentSystemEnv(env),
          NARDUK_DEVELOPMENT_BUILD_ID: buildId,
          NARDUK_DEVELOPMENT_ARTIFACT_DIR: join(workspace, component.artifactDirectory),
        },
        { log, redact: secretValues },
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
    for (const { component } of components) {
      for (const check of component.schemaChecks) {
        const checkSecrets = Object.fromEntries(
          Object.entries(check.readOnlyCredentials).map(([name, selector]) => [
            name,
            readSecret(selector),
          ]),
        )
        run(
          check.command,
          workspace,
          { ...developmentSystemEnv(env), CI: 'true', ...checkSecrets },
          { log, redact: Object.values(checkSecrets) },
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
      if (
        upload(
          ['versions-upload', '--tag', buildId, '--message', message],
          join(workspace, component.appDir),
          deployEnv,
          { keepVars: true },
        ) !== 0
      )
        throw new Error(`${id} upload failed; no traffic was moved`)
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
      await provider.promote(candidate, message)
      const actual = await provider.inspect()
      receipt.components[id].servingVersionId = actual.versionId
      record.expectedServing[id] = actual.versionId
      if (actual.versionId !== candidate)
        throw new Error(`${id} did not start serving the candidate; inspect provider state`)
      receipt.components[id].status = 'serving'
      save('proving')
      const proof = await (context.verify ?? ((verifyFlags) => runVerifyLive(verifyFlags)))(
        verifyFlagsFor(project, component, buildId),
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
        throw new Error(`${id} live proof failed; it serves ${candidate} without proof`)
      }
      if (component.behavior.kind === 'command') {
        try {
          run(
            component.behavior.command,
            workspace,
            {
              ...developmentSystemEnv(env),
              NARDUK_DEVELOPMENT_BUILD_ID: buildId,
              NARDUK_DEVELOPMENT_ORIGIN: component.origins[0],
            },
            { log },
          )
          receipt.components[id].behavior = 'passed'
        } catch (error) {
          receipt.components[id].behavior = 'failed'
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
    cpSync(snapshotDirectory, join(directory, 'source'), {
      recursive: true,
      verbatimSymlinks: true,
    })
    phase(receipt.outcome)
    writeActivation(record, stateDirectory, 'deployed', `${buildId} ${receipt.outcome}`)
    retain(stateDirectory, record, [buildId])
    log(`[deploy:dev] ${describeOutcome(receipt.outcome)}: ${buildId}`)
    if (flags.handoff) log(`[deploy:dev] feedback pin established: ${flags.handoff}`)
    return receipt
  } catch (error) {
    receipt.failure = error instanceof Error ? error.message : String(error)
    if (!receipt.productionMayHaveChanged) {
      receipt.outcome = receipt.phase === 'uploading' ? 'failed-before-traffic' : 'refused'
    } else {
      receipt.outcome = 'unproven'
      // Record the actual serving state; do not replay writes or roll back automatically.
      try {
        for (const { id } of components) {
          const actual = await providers.get(id)!.inspect()
          receipt.components[id].servingVersionId = actual.versionId
          record.expectedServing[id] = actual.versionId
        }
        delete record.pendingAttempt
        record.lastReceipt = receiptPath
      } catch {
        log('[deploy:dev] serving state could not be read; the attempt stays unresolved')
      }
      writeActivation(record, stateDirectory, 'deploy-unproven', buildId)
    }
    save(receipt.outcome)
    log(`[deploy:dev] ${describeOutcome(receipt.outcome)}: ${receipt.failure}`)
    log(`[deploy:dev] receipt=${receiptPath}`)
    return receipt
  } finally {
    lock.release()
    if (snapshotDirectory) rmSync(snapshotDirectory, { recursive: true, force: true })
  }
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
