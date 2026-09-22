import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { z } from 'zod'

import { runDeploy } from './deploy.js'
import { acquireTargetLocks, developmentStateDirectory } from './development-state.js'
import { scanPublicAssetsForSecretLeaks } from './deploy-local.js'
import {
  assertHotfixSnapshot,
  hotfixBuildEnv,
  hotfixProductionEnv,
  hotfixGit,
  hotfixSystemEnv,
  planHotfix,
  type HotfixFlags,
  type HotfixPlan,
} from './hotfix-plan.js'
import {
  createWranglerCli,
  currentDeployment,
  soleDeployedVersionId,
  VERSION_MESSAGE_ANNOTATION,
  VERSION_TAG_ANNOTATION,
  type WranglerVersionsClient,
} from './promote.js'
import {
  parseVerifyArgs,
  resolveAccessHeaders,
  runVerifyLive,
  type VerifyFlags,
  type VerifyReport,
} from './verify-live.js'

export { parseHotfixArgs } from './hotfix-plan.js'

export interface HotfixContext {
  cwd?: string
  env?: NodeJS.ProcessEnv
  log?: (message: string) => void
  /** Process/provider seams for offline integration tests. */
  run?: (args: string[], cwd: string, env: NodeJS.ProcessEnv) => void
  client?: (appDir: string, plan: HotfixPlan, env: NodeJS.ProcessEnv) => WranglerVersionsClient
  upload?: typeof runDeploy
  verify?: (flags: VerifyFlags, env: NodeJS.ProcessEnv) => Promise<VerifyReport>
}

interface HotfixReceipt {
  schemaVersion: 1
  id: string
  startedAt: string
  updatedAt: string
  incident: string
  reason: string
  operator: string
  sha: string
  workerName: string
  accountId: string
  baseUrl: string
  automationPaused: boolean
  phase: string
  failedPhase?: string
  productionMayHaveChanged: boolean
  previousDeploymentId?: string
  previousVersionId?: string
  versionId?: string
  deploymentId?: string
  proof?: {
    result: string
    exitCode: number
    attemptsUsed: number
    assertions: Array<{ id: string; status: string }>
  }
}

function runPnpm(args: string[], cwd: string, env: NodeJS.ProcessEnv): void {
  const result = spawnSync('pnpm', args, { cwd, env, stdio: 'inherit', timeout: 20 * 60 * 1000 })
  if (result.error || result.signal || result.status !== 0)
    throw new Error(
      `Hotfix pnpm ${args.join(' ')} failed; production was not authorized by this step`,
    )
}

const deploymentSchema = z.array(
  z.object({
    id: z.string().min(1),
    created_on: z.iso.datetime({ offset: true }),
    versions: z
      .array(z.object({ version_id: z.string().min(1), percentage: z.number().min(0).max(100) }))
      .min(1),
  }),
)

async function readDeployment(client: WranglerVersionsClient) {
  const rows = deploymentSchema.parse(await client.listDeployments())
  const current = currentDeployment(rows)
  if (!current || !soleDeployedVersionId(current))
    throw new Error(
      'Hotfix requires an existing single-version deployment at 100%; split traffic is unsupported',
    )
  if (rows.filter((row) => row.created_on === current.created_on).length !== 1)
    throw new Error('Current deployment is ambiguous')
  return current
}

/** One explicit local exception. No GitHub calls, remote migrations, secret reads, or automatic rollback. */
export async function runHotfix(flags: HotfixFlags, context: HotfixContext = {}): Promise<number> {
  const env = context.env ?? process.env
  const log = context.log ?? ((message: string) => console.error(message))
  const plan = planHotfix(flags, context.cwd, env)
  const verifyFlags = parseVerifyArgs([
    '--live',
    plan.baseUrl,
    '--expect-sha',
    plan.sha,
    '--build-version-header',
    plan.deployment.liveProof.buildVersionHeader,
    '--health-path',
    plan.deployment.liveProof.healthPath,
    '--smoke-path',
    plan.deployment.liveProof.smokePath,
    '--attempts',
    String(plan.deployment.liveProof.attempts),
    '--interval-seconds',
    String(plan.deployment.liveProof.intervalSeconds),
    ...(flags.accessClientIdEnv
      ? [
          '--access-client-id-env',
          flags.accessClientIdEnv,
          '--access-client-secret-env',
          flags.accessClientSecretEnv!,
        ]
      : []),
  ])
  log(
    `[hotfix] ${plan.workerName} account=${plan.accountId} sha=${plan.sha} origin=${plan.baseUrl}`,
  )
  log(
    '[hotfix] temporary local clone -> offline frozen install -> hotfix:check -> hotfix:build -> upload -> promote 100% -> live proof',
  )
  if (flags.dryRun) return 0
  if (!flags.yes || !flags.automationPaused)
    throw new Error(
      'Live hotfix requires --yes and --automation-paused; follow docs/local-hotfix.md first',
    )
  if (!env.CLOUDFLARE_API_TOKEN?.trim())
    throw new Error(
      'Inject the registered recovery credential as CLOUDFLARE_API_TOKEN using nvault run',
    )
  resolveAccessHeaders(verifyFlags, env)
  const productionBuildEnv = hotfixProductionEnv(env, flags)

  const id = randomUUID()
  mkdirSync(plan.evidenceDir, { recursive: true, mode: 0o700 })
  const receiptPath = join(plan.evidenceDir, `${id}.json`)
  const lockPath = join(plan.evidenceDir, `${plan.accountId}-${plan.workerName}.lock`)
  const targetLock = acquireTargetLocks(
    [plan],
    'hotfix',
    receiptPath,
    developmentStateDirectory(env),
  )
  // Retain the old clone lock during upgrades; all upgraded writers also share the host target lock.
  let lock: number
  try {
    lock = openSync(lockPath, 'wx', 0o600)
  } catch (error) {
    targetLock.release()
    throw error
  }
  const receipt: HotfixReceipt = {
    schemaVersion: 1,
    id,
    startedAt: new Date().toISOString(),
    updatedAt: '',
    incident: flags.incident,
    reason: flags.reason,
    operator: flags.operator,
    sha: plan.sha,
    workerName: plan.workerName,
    accountId: plan.accountId,
    baseUrl: plan.baseUrl,
    automationPaused: flags.automationPaused,
    phase: 'started',
    productionMayHaveChanged: false,
  }
  const save = (phase: string): void => {
    receipt.phase = phase
    receipt.updatedAt = new Date().toISOString()
    const temp = `${receiptPath}.tmp`
    writeFileSync(temp, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 })
    renameSync(temp, receiptPath)
    log(`[hotfix] ${phase}`)
  }
  let scratch: string | undefined
  try {
    writeFileSync(
      lock,
      JSON.stringify({ pid: process.pid, startedAt: receipt.startedAt, receipt: receiptPath }),
    )
    log(`[hotfix] receipt=${receiptPath}`)
    save('started')
    scratch = mkdtempSync(join(tmpdir(), 'narduk-hotfix-'))
    const snapshot = join(scratch, 'source')
    hotfixGit(
      plan.repoRoot,
      [
        'clone',
        '--local',
        '--no-hardlinks',
        '--no-checkout',
        '--quiet',
        '--',
        plan.repoRoot,
        snapshot,
      ],
      env,
    )
    hotfixGit(snapshot, ['checkout', '--quiet', '--detach', plan.sha], env)
    const appDir = join(snapshot, plan.appRelative)
    // Re-read the committed checkout, closing the source/configuration race and
    // catching local assume-unchanged/skip-worktree edits hidden from status.
    const committed = planHotfix(flags, appDir, env)
    if (
      committed.accountId !== plan.accountId ||
      JSON.stringify(committed.deployment) !== JSON.stringify(plan.deployment)
    ) {
      throw new Error('Working-tree deployment configuration differs from the committed hotfix')
    }
    const buildEnv = hotfixBuildEnv(env, flags)
    const run = context.run ?? runPnpm
    save('installing')
    run(['install', '--offline', '--frozen-lockfile', '--prod=false'], snapshot, {
      ...buildEnv,
      ...(env.NPM_CONFIG_USERCONFIG ? { NPM_CONFIG_USERCONFIG: env.NPM_CONFIG_USERCONFIG } : {}),
      ...(env.GH_PACKAGES_READ ? { GH_PACKAGES_READ: env.GH_PACKAGES_READ } : {}),
    })
    // Observe production before running checks/build, then compare immediately before promotion.
    const deployEnv = {
      ...hotfixSystemEnv(env),
      CLOUDFLARE_ACCOUNT_ID: plan.accountId,
      CLOUDFLARE_API_TOKEN: env.CLOUDFLARE_API_TOKEN,
      NARDUK_ALLOW_LOCAL_WRANGLER_DEPLOY: '1',
      WRANGLER_SEND_METRICS: 'false',
      CI: 'true',
    }
    const client =
      context.client?.(appDir, plan, deployEnv) ??
      createWranglerCli({
        appDir,
        workerName: plan.workerName,
        accountId: plan.accountId,
        env: deployEnv,
      })
    const previous = await readDeployment(client)
    receipt.previousDeploymentId = previous.id
    receipt.previousVersionId = soleDeployedVersionId(previous)!
    save('checking')
    run(['run', 'hotfix:check'], snapshot, buildEnv)
    save('building')
    run(['run', 'hotfix:build'], snapshot, productionBuildEnv)
    assertHotfixSnapshot(plan, snapshot, env)
    const secrets = Object.fromEntries(
      Object.entries(env)
        .filter(([key, value]) => /TOKEN|SECRET|PASSWORD|GH_PACKAGES_READ/u.test(key) && value)
        .map(([key, value]) => [key, value!]),
    )
    if (scanPublicAssetsForSecretLeaks(appDir, secrets).length)
      throw new Error('Credential value found in public assets; refusing upload')
    // Only the provider phase receives the recovery token. Never impersonate Workers Builds.
    if ((await readDeployment(client)).id !== previous.id)
      throw new Error('Production changed during the hotfix; no upload requested')
    const message = `narduk-app hotfix ${id}`
    save('uploading')
    const upload = context.upload ?? runDeploy
    if (
      upload(['versions-upload', '--tag', plan.sha, '--message', message], appDir, deployEnv, {
        keepVars: true,
      }) !== 0
    )
      throw new Error('Hotfix upload failed; no promotion requested')
    const listing = await client.listVersions(100)
    const matches = listing.versions.filter(
      (version) =>
        version.annotations?.[VERSION_TAG_ANNOTATION] === plan.sha &&
        version.annotations?.[VERSION_MESSAGE_ANNOTATION] === message,
    )
    if (matches.length !== 1 || !z.uuid().safeParse(matches[0].id).success)
      throw new Error('Cannot uniquely identify this hotfix upload; no promotion requested')
    receipt.versionId = matches[0].id
    save('uploaded')
    if ((await readDeployment(client)).id !== previous.id)
      throw new Error('Production changed during the hotfix; no promotion requested')
    // Save the intent BEFORE the non-idempotent request: a timeout can mean it applied.
    receipt.productionMayHaveChanged = true
    save('promoting')
    await client.deployVersion(receipt.versionId, 100, message)
    const deployed = await readDeployment(client)
    if (soleDeployedVersionId(deployed) !== receipt.versionId)
      throw new Error(
        'The hotfix is not the active deployment; inspect provider state before retrying',
      )
    receipt.deploymentId = deployed.id
    save('proving')
    const proof = await (
      context.verify ?? ((args, proofEnv) => runVerifyLive(args, { env: proofEnv }))
    )(verifyFlags, env)
    receipt.proof = {
      result: proof.result,
      exitCode: proof.exitCode,
      attemptsUsed: proof.attemptsUsed,
      assertions: proof.assertions.map(({ id: assertionId, status }) => ({
        id: assertionId,
        status,
      })),
    }
    if (proof.exitCode !== 0 || proof.result !== 'PASS')
      throw new Error(
        'Hotfix live proof failed; inspect the receipt and follow the recovery procedure',
      )
    if ((await readDeployment(client)).id !== deployed.id)
      throw new Error('Production changed during live proof; hotfix success is unproven')
    save('passed')
    log(
      `[hotfix] verified ${plan.sha}; merge this commit through the normal PR/release path before resuming automation`,
    )
    return 0
  } catch (error) {
    receipt.failedPhase = receipt.phase
    save('failed')
    log(
      `[hotfix] failed at ${receipt.failedPhase}; production may have changed=${String(receipt.productionMayHaveChanged)}; receipt=${receiptPath}`,
    )
    // External error bodies are deliberately not persisted in an incident receipt.
    throw error
  } finally {
    try {
      closeSync(lock)
      rmSync(lockPath)
    } finally {
      targetLock.release()
    }
    if (scratch) rmSync(scratch, { recursive: true, force: true })
  }
}
