/**
 * `narduk-app deploy staging` -- the executor for an enabled
 * `deployment.staging` stage (deployment-standard design §5.2).
 *
 * Staging is one stage inserted before production, never a fork. When
 * `staging.enabled` is true the promote workflow, for the exact commit
 * `ci / Required` proved green:
 *
 *   1. migrates the staging D1 databases
 *      (`narduk-app db migrate-deployment --target staging`, its own credential),
 *   2. builds that commit's staging bundle and runs this command, which uploads
 *      it to `staging.workerName` tagged with the commit, deploys that version at
 *      100%, and proves it live against `https://<staging.hostname>` with the
 *      `deployment.liveProof` settings,
 *   3. then continues to production: in the same job on `auto-after-proof`, or
 *      in a job bound to the named GitHub Environment on `environment`.
 *
 * WHY THIS UPLOADS RATHER THAN PROMOTES A WORKERS BUILDS VERSION
 * -------------------------------------------------------------
 * A Worker version belongs to one script: the version Workers Builds uploaded to
 * the production Worker cannot be deployed to the staging Worker. A staging
 * version therefore has to be uploaded to the staging script itself, and a
 * second Workers Builds trigger per app costs two user-owned Cloudflare tokens
 * against a 50-token cap. So the promote job builds the verified commit and this
 * command uploads it with `--tag <sha>`, the same `workers/tag` annotation a
 * Workers Build writes, under the app's existing promote credential (Workers
 * Scripts Write on the account).
 *
 * WHAT GATES PRODUCTION
 * ---------------------
 * A failed staging proof rolls the staging Worker back to the version it served
 * before and exits non-zero, so the job stops before any production step. And
 * `versions-promote` itself refuses a production promotion while staging is
 * enabled and the staging Worker does not serve a version tagged with the same
 * commit (`checkStagingServesSha` in `./promote.ts`), so a workflow that skipped the stage cannot
 * reach production either.
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'

import { primeAppConfig, requireAppConfigRoot } from './app-config/resolve.js'
import {
  DEPLOY_APP_CONFIG_LOCATE,
  readCloudflareAppConfigDocument,
  readJsonc,
  type DeployEnv,
} from './deploy.js'
import {
  healthArgs,
  readDeploymentBlock,
  PREVIEW_BINDING_KINDS,
  smokeArgs,
  type DeploymentBlock,
} from './deployment-config.js'
import {
  describePreviewPlan,
  planPreviewConfig,
  PREVIEW_RESOURCE_FIELDS,
} from './preview-config.js'
import {
  checkPromoteContext,
  createWranglerCli,
  isActionsPromoteAllowed,
  isManualPromoteAllowed,
  type SpawnWrangler,
  type WranglerVersionsClient,
} from './promote.js'
import {
  formatVerifyReport,
  parseVerifyArgs,
  runVerifyLive,
  type VerifyReport,
} from './verify-live.js'
import { currentDeployment, soleDeployedVersionId } from './worker-deployment.js'

/** The derived staging config, written beside the production wrangler config. */
export const STAGING_CONFIG_FILENAME = '.wrangler.deploy.staging.json'

/** Stateful binding blocks a derived staging config would share with production. */
export const DERIVED_UNISOLATED_BLOCKS = [
  'hyperdrive',
  'vectorize',
  'analytics_engine_datasets',
  'services',
] as const

/** The `--message` a staging upload and deploy carry. */
export const STAGING_MESSAGE_PREFIX = 'narduk-app staging'

export const STAGING_EXIT = {
  ok: 0,
  /** The Actions/branch/event/checkout guard refused. Nothing was attempted. */
  refused: 1,
  /** Bad arguments, or a staging block or config that cannot be deployed. */
  usage: 2,
  /** The staging proof failed. Staging was rolled back when it could be. */
  proofFailed: 4,
  /** Wrangler failed. `trafficMayHaveChanged` says whether staging moved. */
  wranglerFailed: 5,
} as const

export type StagingOutcome =
  /** `staging.enabled` is false: nothing to do, exit 0 so one workflow fits every app. */
  | 'not-enabled'
  | 'dry-run'
  /** Deployed at 100% and proven live. Production may continue. */
  | 'proven'
  | 'proof-failed'
  | 'guard-refused'
  | 'invalid-config'
  | 'wrangler-failed'

export interface StagingResult {
  outcome: StagingOutcome
  worker: string | null
  hostname: string | null
  sha: string | null
  versionId: string | null
  previousVersionId: string | null
  /** The §5.2 gate the workflow applies before production. */
  approval: 'environment' | 'auto-after-proof' | null
  environment: string | null
  /** The wrangler config the upload used, relative to the app directory. */
  config: string | null
  /** Set on `proof-failed`: the version staging was rolled back to, or null. */
  rolledBackTo?: string | null
  trafficMayHaveChanged?: boolean
  proof?: Pick<VerifyReport, 'result' | 'attemptsUsed' | 'egress' | 'exitCode'>
  detail: string
  exitCode: number
}

export interface StagingFlags {
  sha: string
  json: boolean
  dryRun: boolean
}

const FULL_SHA = /^[a-f\d]{40}$/u

export function parseStagingArgs(args: string[]): StagingFlags {
  let sha: string | null = null
  let json = false
  let dryRun = false
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--sha') {
      const value = args[(index += 1)]
      if (!value || value.startsWith('--')) throw new Error('--sha requires a value')
      sha = value.trim().toLowerCase()
    } else if (arg === '--json') json = true
    else if (arg === '--dry-run') dryRun = true
    else throw new Error(`Unknown deploy staging option: ${arg}`)
  }
  if (!sha) throw new Error('--sha <the 40-character commit CI verified> is required')
  if (!FULL_SHA.test(sha)) throw new Error(`--sha must be a 40-character commit SHA, got ${sha}`)
  return { sha, json, dryRun }
}

/* -------------------------------------------------------------------------- */
/* The staging config                                                         */
/* -------------------------------------------------------------------------- */

type WranglerConfig = Record<string, unknown>

export interface StagingConfigPlan {
  /** The config to hand `wrangler --config`. */
  config: WranglerConfig
  /** Absolute path of the committed staging config, or null when derived. */
  committedPath: string | null
}

function resourcesOf(config: WranglerConfig): Map<string, string> {
  const out = new Map<string, string>()
  for (const kind of PREVIEW_BINDING_KINDS) {
    const { block, resource } = PREVIEW_RESOURCE_FIELDS[kind]
    const entries = config[block]
    if (!Array.isArray(entries)) continue
    for (const entry of entries as Array<Record<string, unknown>>) {
      const binding = typeof entry?.binding === 'string' ? entry.binding : '?'
      out.set(
        `${kind}:${binding}`,
        resource.map((field) => `${field}=${String(entry?.[field] ?? '')}`).join(' '),
      )
    }
  }
  return out
}

function routePatterns(config: WranglerConfig): string[] {
  const routes = config.routes
  if (!Array.isArray(routes)) return []
  return routes
    .map((route) =>
      typeof route === 'string'
        ? route
        : typeof (route as Record<string, unknown>)?.pattern === 'string'
          ? ((route as Record<string, unknown>).pattern as string)
          : '',
    )
    .map((pattern) => pattern.replace(/\/\*?$/u, ''))
}

/**
 * The staging Worker's wrangler config, and every reason it must not deploy.
 *
 * `staging.bindings` is the one declaration of staging D1/KV/R2: it is what
 * `db migrate-deployment --target staging` migrates, so the Worker must bind
 * exactly those resources and none of production's (`planPreviewConfig`, the
 * same planner a preview build uses). Without `staging.wranglerConfig` the
 * config is derived: the production config, rebound, renamed to
 * `staging.workerName`, routed to `staging.hostname` as a custom domain. With
 * one -- for an app whose staging also differs in vars, rate-limit namespaces
 * or routes -- the committed file is used as written, after proving it names the
 * staging Worker, the deployment account, a route for the hostname, and the
 * same D1/KV/R2 resources the rebind produces.
 */
export function planStagingConfig(options: {
  root: string
  production: WranglerConfig
  deployment: DeploymentBlock
  read?: (path: string) => WranglerConfig
}): StagingConfigPlan {
  const { root, production, deployment } = options
  const staging = deployment.staging
  if (!staging.enabled || !staging.workerName || !staging.hostname) {
    throw new Error('deployment.staging is not enabled')
  }
  const accountId = deployment.accountId ?? (production.account_id as string | undefined) ?? null
  if (!accountId) {
    throw new Error(
      'The staging deploy needs deployment.accountId or account_id in wrangler config',
    )
  }
  const rebind = planPreviewConfig(production, staging.bindings ?? { d1: [], kv: [], r2: [] })
  if (rebind.status !== 'ready' && rebind.status !== 'no-bindings') {
    throw new Error(
      `staging.bindings cannot isolate staging from production: ` +
        describePreviewPlan(rebind).replaceAll('deployment.previewBindings', 'staging.bindings'),
    )
  }
  const expected = rebind.config ?? production
  if (!staging.wranglerConfig) {
    // Only D1, KV and R2 are rebound. Any other stateful binding would carry
    // production's resource into staging, so it needs a committed config.
    const unisolated: string[] = DERIVED_UNISOLATED_BLOCKS.filter(
      (block) => Array.isArray(production[block]) && (production[block] as unknown[]).length > 0,
    )
    const queues = production.queues as Record<string, unknown[]> | undefined
    if (queues && (queues.producers?.length || queues.consumers?.length)) unisolated.push('queues')
    // A Durable Object bound by script_name lives in another Worker (production's).
    const dos = production.durable_objects as
      { bindings?: Array<{ script_name?: string }> } | undefined
    if (dos?.bindings?.some((binding) => binding.script_name)) unisolated.push('durable_objects')
    if (unisolated.length > 0) {
      throw new Error(
        `the production config binds ${unisolated.join(', ')}, which a derived staging config ` +
          'cannot rebind; commit a staging config and name it in staging.wranglerConfig',
      )
    }
    const config = JSON.parse(JSON.stringify(expected)) as WranglerConfig
    delete config.env
    config.name = staging.workerName
    config.account_id = accountId
    config.routes = [{ pattern: staging.hostname, custom_domain: true }]
    config.keep_vars = true
    return { config, committedPath: null }
  }
  const committedPath = resolve(root, staging.wranglerConfig)
  const config = (options.read ?? readJsonc<WranglerConfig>)(committedPath)
  const problems: string[] = []
  if (config.name !== staging.workerName) {
    problems.push(`its name is ${JSON.stringify(config.name)}, not ${staging.workerName}`)
  }
  if (config.account_id !== undefined && config.account_id !== accountId) {
    problems.push(`its account_id ${String(config.account_id)} is not the deployment account`)
  }
  if (config.env !== undefined) {
    problems.push('it carries an env block; staging is a separate Worker, never env.staging')
  }
  if (!routePatterns(config).includes(staging.hostname)) {
    problems.push(`it routes no pattern to ${staging.hostname}`)
  }
  const want = resourcesOf(expected)
  const have = resourcesOf(config)
  for (const [binding, resource] of want) {
    if (have.get(binding) !== resource) {
      problems.push(
        `${binding} binds ${have.get(binding) ?? 'nothing'}; staging.bindings says ${resource}`,
      )
    }
  }
  for (const binding of have.keys()) {
    if (!want.has(binding)) problems.push(`${binding} is bound but production has no such binding`)
  }
  if (problems.length > 0) {
    throw new Error(`staging.wranglerConfig ${staging.wranglerConfig}: ${problems.join('; ')}`)
  }
  return { config: { ...config, account_id: accountId }, committedPath }
}

/* -------------------------------------------------------------------------- */
/* The command                                                                */
/* -------------------------------------------------------------------------- */

export interface StagingContext {
  appDir?: string
  env?: DeployEnv
  /** Injected in tests; `wrangler` through `pnpm exec` otherwise. */
  spawn?: SpawnWrangler
  /** Injected in tests; `createWranglerCli` for the staging Worker otherwise. */
  client?: WranglerVersionsClient
  /** Injected in tests; `runVerifyLive` otherwise. */
  verify?: (args: string[], env: DeployEnv) => Promise<VerifyReport>
  /** Injected in tests; `git rev-parse HEAD` in the app directory otherwise. */
  headSha?: (appDir: string) => string
  log?: (line: string) => void
}

function baseResult(
  outcome: StagingOutcome,
  detail: string,
  exitCode: number,
  partial: Partial<StagingResult> = {},
): StagingResult {
  return {
    outcome,
    worker: null,
    hostname: null,
    sha: null,
    versionId: null,
    previousVersionId: null,
    approval: null,
    environment: null,
    config: null,
    ...partial,
    detail,
    exitCode,
  }
}

const UUID = /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/iu

/** The version id from wrangler's `WRANGLER_OUTPUT_FILE_PATH` receipt. */
export function readUploadReceipt(text: string, workerName: string): string {
  const upload = text
    .split('\n')
    .filter((line) => line.trim().startsWith('{'))
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .find((entry) => entry.type === 'version-upload')
  if (!upload) throw new Error('wrangler versions upload wrote no version-upload receipt')
  if (upload.worker_name !== undefined && upload.worker_name !== workerName) {
    throw new Error(
      `wrangler uploaded to ${String(upload.worker_name)}, not the staging Worker ${workerName}`,
    )
  }
  const id = typeof upload.version_id === 'string' ? upload.version_id : ''
  if (!UUID.test(id)) throw new Error('wrangler versions upload returned no valid version id')
  return id
}

export async function runStagingDeploy(
  flags: StagingFlags,
  context: StagingContext = {},
): Promise<StagingResult> {
  const env = context.env ?? process.env
  const appDir = resolve(context.appDir ?? process.cwd())
  const log = context.log ?? ((line: string) => console.error(line))

  let root: string
  let manifest: Record<string, unknown>
  try {
    root = requireAppConfigRoot(appDir, 'cloudflare-app.json', {
      ...DEPLOY_APP_CONFIG_LOCATE,
      env,
    })
    await primeAppConfig({
      ...DEPLOY_APP_CONFIG_LOCATE,
      dir: appDir,
      env,
      files: ['cloudflare-app.json'],
      required: true,
    })
    manifest = readCloudflareAppConfigDocument(appDir, env) as Record<string, unknown>
  } catch (error) {
    return baseResult(
      'invalid-config',
      error instanceof Error ? error.message : String(error),
      STAGING_EXIT.usage,
    )
  }
  const outcome = readDeploymentBlock(manifest)
  if (outcome.kind !== 'valid') {
    return baseResult(
      'invalid-config',
      `Config/cloudflare-app.json has no valid narduk-v1 deployment block (${outcome.kind}).`,
      STAGING_EXIT.usage,
    )
  }
  const deployment = outcome.block
  const staging = deployment.staging
  if (!staging.enabled) {
    return baseResult(
      'not-enabled',
      'deployment.staging.enabled is false: there is no staging stage, production follows CI.',
      STAGING_EXIT.ok,
      { sha: flags.sha },
    )
  }
  const stage: Partial<StagingResult> = {
    worker: staging.workerName ?? null,
    hostname: staging.hostname ?? null,
    sha: flags.sha,
    approval: staging.approval ?? null,
    environment: staging.environment ?? null,
  }

  if (!isActionsPromoteAllowed(env) && !isManualPromoteAllowed(env)) {
    return baseResult(
      'guard-refused',
      'The staging deploy runs only in the GitHub Actions promote workflow ' +
        '(set NARDUK_ALLOW_MANUAL_PROMOTE=1 for deliberate recovery work).',
      STAGING_EXIT.refused,
      stage,
    )
  }
  const refusal = checkPromoteContext(
    env,
    isManualPromoteAllowed(env) ? null : deployment.productionBranch,
  )
  if (refusal) return baseResult('guard-refused', refusal.reason, STAGING_EXIT.refused, stage)
  const head = (
    context.headSha ??
    ((dir: string) =>
      execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim())
  )(appDir)
  if (head.toLowerCase() !== flags.sha) {
    return baseResult(
      'guard-refused',
      `The checkout is at ${head}, not ${flags.sha}: staging deploys the commit CI verified, ` +
        'built from that exact checkout.',
      STAGING_EXIT.refused,
      stage,
    )
  }

  const worker = (manifest.worker ?? {}) as Record<string, unknown>
  const productionPath =
    typeof worker.wranglerConfig === 'string'
      ? resolve(root, worker.wranglerConfig)
      : join(appDir, 'wrangler.json')
  let plan: StagingConfigPlan
  try {
    plan = planStagingConfig({
      root,
      production: readJsonc<WranglerConfig>(productionPath),
      deployment,
    })
  } catch (error) {
    return baseResult(
      'invalid-config',
      error instanceof Error ? error.message : String(error),
      STAGING_EXIT.usage,
      stage,
    )
  }
  const configPath = plan.committedPath ?? join(dirname(productionPath), STAGING_CONFIG_FILENAME)
  const main = typeof plan.config.main === 'string' ? plan.config.main : null
  if (main && !existsSync(resolve(dirname(configPath), main))) {
    return baseResult(
      'invalid-config',
      `The staging bundle ${main} is not built. Build this commit's staging bundle before ` +
        '`narduk-app deploy staging`.',
      STAGING_EXIT.usage,
      { ...stage, config: relative(appDir, configPath) },
    )
  }
  const withConfig = { ...stage, config: relative(appDir, configPath) || configPath }
  if (flags.dryRun) {
    return baseResult(
      'dry-run',
      `Would upload ${flags.sha} to ${staging.workerName}, deploy it at 100% and prove ` +
        `https://${staging.hostname}.`,
      STAGING_EXIT.ok,
      withConfig,
    )
  }

  const accountId = (plan.config.account_id as string | undefined) ?? undefined
  const workerName = staging.workerName!
  const client =
    context.client ??
    createWranglerCli({ workerName, accountId, appDir, env, spawn: context.spawn })
  const failed = (phase: string, error: unknown, moved: boolean, partial = {}): StagingResult =>
    baseResult(
      'wrangler-failed',
      `wrangler failed during ${phase}: ${error instanceof Error ? error.message : String(error)}. ` +
        (moved
          ? `Staging traffic may have moved; read \`wrangler deployments list --name ${workerName}\`. `
          : 'Staging traffic did not move. ') +
        'Production is untouched.',
      STAGING_EXIT.wranglerFailed,
      { ...withConfig, ...partial, trafficMayHaveChanged: moved },
    )

  let previousVersionId: string | null
  try {
    previousVersionId = soleDeployedVersionId(currentDeployment(await client.listDeployments()))
  } catch (error) {
    return failed('deployments list', error, false)
  }

  if (!plan.committedPath) writeFileSync(configPath, `${JSON.stringify(plan.config, null, 2)}\n`)
  const message = `${STAGING_MESSAGE_PREFIX} ${flags.sha}`
  const receiptDir = mkdtempSync(join(tmpdir(), 'narduk-staging-upload-'))
  let versionId: string
  try {
    const receipt = join(receiptDir, 'upload.jsonl')
    const spawn =
      context.spawn ??
      ((command, args, options) =>
        spawnSync(command, args, { ...options, encoding: 'utf8' }) as ReturnType<SpawnWrangler>)
    const runEnv: DeployEnv = { ...env, WRANGLER_OUTPUT_FILE_PATH: receipt }
    if (accountId && !runEnv.CLOUDFLARE_ACCOUNT_ID?.trim()) runEnv.CLOUDFLARE_ACCOUNT_ID = accountId
    const upload = spawn(
      'pnpm',
      [
        'exec',
        'wrangler',
        '--config',
        configPath,
        'versions',
        'upload',
        '--tag',
        flags.sha,
        '--message',
        message,
      ],
      // stdout is captured and replayed on stderr, so `--json` stays one document.
      { cwd: appDir, env: runEnv as NodeJS.ProcessEnv, stdio: ['ignore', 'pipe', 'inherit'] },
    )
    if (upload.stdout) process.stderr.write(upload.stdout)
    if (upload.error) throw upload.error
    if (upload.status !== 0) {
      throw new Error(`wrangler versions upload exited ${String(upload.status ?? upload.signal)}`)
    }
    versionId = readUploadReceipt(readFileSync(receipt, 'utf8'), workerName)
  } catch (error) {
    return failed('versions upload', error, false, { previousVersionId })
  } finally {
    rmSync(receiptDir, { recursive: true, force: true })
  }
  log(`narduk-app deploy staging: uploaded ${versionId} to ${workerName} tagged ${flags.sha}`)

  try {
    await client.deployVersion(versionId, 100, message)
  } catch (error) {
    return failed('versions deploy', error, true, { versionId, previousVersionId })
  }

  const proofArgs = [
    '--live',
    `https://${staging.hostname}`,
    '--expect-sha',
    flags.sha,
    '--build-version-header',
    deployment.liveProof.buildVersionHeader,
    ...healthArgs(deployment.liveProof),
    ...smokeArgs(deployment.liveProof),
    '--attempts',
    String(deployment.liveProof.attempts),
    '--interval-seconds',
    String(deployment.liveProof.intervalSeconds),
  ]
  const verify =
    context.verify ??
    ((args: string[], proofEnv: DeployEnv) =>
      runVerifyLive(parseVerifyArgs(args), { env: proofEnv }))
  let report: VerifyReport
  try {
    report = await verify(proofArgs, env)
    log(formatVerifyReport(report))
  } catch (error) {
    // A proof that could not run is a proof that did not pass.
    log(`narduk-app deploy staging: the live proof did not run: ${String(error)}`)
    report = {
      result: 'FAIL',
      attemptsUsed: 0,
      egress: 'direct',
      exitCode: STAGING_EXIT.proofFailed,
    } as VerifyReport
  }
  const proof = {
    result: report.result,
    attemptsUsed: report.attemptsUsed,
    egress: report.egress,
    exitCode: report.exitCode,
  }
  const deployed = { ...withConfig, versionId, previousVersionId, proof }
  if (report.result === 'PASS') {
    return baseResult(
      'proven',
      `${workerName} serves ${flags.sha} at https://${staging.hostname}; production may continue ` +
        (staging.approval === 'environment'
          ? `once the ${staging.environment} environment's reviewers approve.`
          : 'now (auto-after-proof).'),
      STAGING_EXIT.ok,
      deployed,
    )
  }
  let rolledBackTo: string | null = null
  if (previousVersionId && previousVersionId !== versionId) {
    try {
      await client.deployVersion(previousVersionId, 100, `${STAGING_MESSAGE_PREFIX} rollback`)
      rolledBackTo = previousVersionId
    } catch (error) {
      log(`narduk-app deploy staging: rollback to ${previousVersionId} failed: ${String(error)}`)
    }
  }
  return baseResult(
    'proof-failed',
    `The staging proof against https://${staging.hostname} failed, so production does not ` +
      'continue. ' +
      (rolledBackTo
        ? `Staging was rolled back to ${rolledBackTo}.`
        : 'Staging was NOT rolled back (no single previous version, or the rollback failed).'),
    STAGING_EXIT.proofFailed,
    { ...deployed, rolledBackTo },
  )
}

export function formatStagingResult(result: StagingResult): string {
  const lines = [
    `narduk-app deploy staging -- ${result.worker ?? '(no staging Worker)'}`,
    `  outcome    ${result.outcome}`,
  ]
  if (result.hostname) lines.push(`  hostname   ${result.hostname}`)
  if (result.sha) lines.push(`  sha        ${result.sha}`)
  if (result.config) lines.push(`  config     ${result.config}`)
  if (result.versionId) lines.push(`  version    ${result.versionId}`)
  if (result.previousVersionId) lines.push(`  previous   ${result.previousVersionId}`)
  if (result.approval) {
    lines.push(
      `  approval   ${result.approval}${result.environment ? ` (${result.environment})` : ''}`,
    )
  }
  if (result.proof) {
    lines.push(
      `  proof      ${result.proof.result} after ${String(result.proof.attemptsUsed)} attempt(s), ` +
        `egress ${result.proof.egress}`,
    )
  }
  lines.push(`  detail     ${result.detail}`)
  return lines.join('\n')
}

/** The step outputs a promote workflow branches on. */
export function writeStagingStepOutputs(
  result: StagingResult,
  env: DeployEnv = process.env,
): boolean {
  const file = env.GITHUB_OUTPUT?.trim()
  if (!file) return false
  const lines = [
    `outcome=${result.outcome}`,
    `enabled=${result.outcome === 'not-enabled' ? 'false' : 'true'}`,
    `version_id=${result.versionId ?? ''}`,
    `previous_version_id=${result.previousVersionId ?? ''}`,
    `approval=${result.approval ?? ''}`,
    `environment=${result.environment ?? ''}`,
  ]
  try {
    writeFileSync(file, `${lines.join('\n')}\n`, { flag: 'a' })
    return true
  } catch {
    return false
  }
}
