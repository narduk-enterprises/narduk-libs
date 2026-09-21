import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

import { z } from 'zod'

import {
  findCloudflareAppConfig,
  readJsonc,
  resolveAppDir,
  resolveWranglerConfigPath,
} from './deploy.js'
import { isNonLocalHttpsUrl } from './deploy-local.js'
import {
  ACCOUNT_ID_PATTERN,
  readDeploymentBlock,
  type DeploymentBlock,
} from './deployment-config.js'

const text = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine((value) => !/\p{Cc}/u.test(value))
const flagsSchema = z
  .strictObject({
    incident: text,
    reason: text,
    operator: text,
    sha: z.string().regex(/^[a-f\d]{40}$/u, 'Use the full 40-character commit SHA'),
    confirmWorker: z.string().regex(/^[a-z\d][a-z\d-]{0,62}$/u),
    baseUrl: z.string().refine((value) => {
      if (!isNonLocalHttpsUrl(value)) return false
      const url = new URL(value)
      return !url.username && !url.password && !url.search && !url.hash && url.pathname === '/'
    }, 'Use a non-local HTTPS origin without credentials, path, query or fragment'),
    dryRun: z.boolean().default(false),
    yes: z.boolean().default(false),
    automationPaused: z.boolean().default(false),
    accessClientIdEnv: z
      .string()
      .regex(/^[A-Z_][A-Z\d_]*$/u)
      .optional(),
    accessClientSecretEnv: z
      .string()
      .regex(/^[A-Z_][A-Z\d_]*$/u)
      .optional(),
  })
  .refine((flags) => Boolean(flags.accessClientIdEnv) === Boolean(flags.accessClientSecretEnv), {
    message: 'Both Access environment variable names are required together',
  })

export type HotfixFlags = z.infer<typeof flagsSchema>

export function parseHotfixArgs(args: string[]): HotfixFlags {
  const values: Record<string, unknown> = {}
  const names: Record<string, string> = {
    '--incident': 'incident',
    '--reason': 'reason',
    '--operator': 'operator',
    '--sha': 'sha',
    '--confirm-worker': 'confirmWorker',
    '--base-url': 'baseUrl',
    '--access-client-id-env': 'accessClientIdEnv',
    '--access-client-secret-env': 'accessClientSecretEnv',
  }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    const boolean = {
      '--dry-run': 'dryRun',
      '--yes': 'yes',
      '--automation-paused': 'automationPaused',
    }[arg]
    const key = boolean ?? names[arg]
    if (!key) throw new Error(`Unknown deploy-hotfix option: ${arg}`)
    if (key in values) throw new Error(`Duplicate deploy-hotfix option: ${arg}`)
    if (boolean) values[key] = true
    else {
      const value = args[++index]
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`)
      values[key] = value
    }
  }
  return flagsSchema.parse(values)
}

/** Git never sees ambient GIT_DIR/GIT_WORK_TREE overrides or a credential. */
export function hotfixGit(cwd: string, args: string[], env: NodeJS.ProcessEnv): string {
  const result = spawnSync('git', args, {
    cwd,
    env: hotfixSystemEnv(env),
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 10 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.error || result.signal || result.status !== 0)
    throw new Error(`Hotfix git ${args[0]} failed`)
  return result.stdout.trim()
}

export function hotfixSystemEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const keys = [
    'PATH',
    'HOME',
    'USER',
    'LOGNAME',
    'SHELL',
    'TMPDIR',
    'TEMP',
    'TMP',
    'SystemRoot',
    'PNPM_HOME',
  ]
  return Object.fromEntries(
    keys.filter((key) => env[key] !== undefined).map((key) => [key, env[key]]),
  )
}

export function hotfixBuildEnv(env: NodeJS.ProcessEnv, flags: HotfixFlags): NodeJS.ProcessEnv {
  const publicEnv = Object.fromEntries(
    Object.entries(env).filter(([key]) => key.startsWith('NUXT_PUBLIC_')),
  )
  return {
    ...hotfixSystemEnv(env),
    ...publicEnv,
    CI: 'true',
    BUILD_VERSION: flags.sha,
    NUXT_PUBLIC_BUILD_VERSION: flags.sha,
    SITE_URL: flags.baseUrl,
    NUXT_PUBLIC_SITE_URL: flags.baseUrl,
  }
}

/** The two app-owned build secrets required by the production Nuxt modules. */
export function hotfixProductionEnv(env: NodeJS.ProcessEnv, flags: HotfixFlags): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {
    ...hotfixBuildEnv(env, flags),
    NARDUK_ALLOW_LOCAL_WRANGLER_DEPLOY: '1',
  }
  for (const key of ['NUXT_OG_IMAGE_SECRET', 'NUXT_SESSION_PASSWORD']) {
    const value = env[key]
    if (value !== undefined) {
      if (value.trim().length < 32 || value.startsWith('narduk-test-only-')) {
        throw new Error(`${key} must be a real production build secret, never a test placeholder`)
      }
      result[key] = value
    }
  }
  return result
}

export interface HotfixPlan {
  repoRoot: string
  appRelative: string
  accountId: string
  workerName: string
  sha: string
  baseUrl: string
  deployment: DeploymentBlock
  evidenceDir: string
}

export function planHotfix(flags: HotfixFlags, cwd = process.cwd(), env = process.env): HotfixPlan {
  flagsSchema.parse(flags)
  if (
    [env.CI, env.GITHUB_ACTIONS, env.WORKERS_CI].some(
      (value) => value && !['0', 'false'].includes(value.toLowerCase()),
    )
  ) {
    throw new Error('deploy-hotfix is for an operator workstation, not CI or Workers Builds')
  }
  const appDir = realpathSync(resolveAppDir(resolve(cwd)))
  const repoRoot = hotfixGit(appDir, ['rev-parse', '--show-toplevel'], env)
  if (
    hotfixGit(
      repoRoot,
      ['status', '--porcelain', '--untracked-files=all', '--ignore-submodules=none'],
      env,
    )
  ) {
    throw new Error(
      'Hotfix requires a clean working tree, including untracked files; commit the patch first',
    )
  }
  if (hotfixGit(repoRoot, ['rev-parse', 'HEAD'], env) !== flags.sha)
    throw new Error('--sha must equal HEAD')
  if (
    hotfixGit(repoRoot, ['ls-files', '--stage'], env)
      .split('\n')
      .some((line) => line.startsWith('160000 '))
  ) {
    throw new Error('Hotfix snapshots do not support Git submodules')
  }
  if (!existsSync(join(repoRoot, 'pnpm-lock.yaml')))
    throw new Error('A committed pnpm-lock.yaml is required')
  const pkg = z
    .object({ scripts: z.record(z.string(), z.string()) })
    .parse(JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')))
  for (const script of ['hotfix:check', 'hotfix:build']) {
    if (!pkg.scripts[script]?.trim())
      throw new Error(`Declare the repository-root ${script} script before adopting deploy-hotfix`)
  }
  const configPath = resolveWranglerConfigPath(appDir)!
  const config = z
    .object({
      name: z.string(),
      account_id: z.string().optional(),
      build: z.object({ command: z.string().optional() }).optional(),
    })
    .parse(readJsonc<unknown>(configPath))
  if (config.build?.command?.trim())
    throw new Error(
      'Move Wrangler build.command into hotfix:build; upload must not rebuild with deployment credentials',
    )
  if (config.name !== flags.confirmWorker)
    throw new Error('--confirm-worker must match the committed Wrangler name')
  const manifestPath = findCloudflareAppConfig(appDir)
  if (!manifestPath) throw new Error('Missing Config/cloudflare-app.json')
  const manifest = readJsonc<unknown>(manifestPath)
  const outcome = readDeploymentBlock(manifest)
  if (outcome.kind !== 'valid')
    throw new Error('Hotfix requires a valid narduk-v1 deployment block')
  const worker = z.object({ worker: z.object({ name: z.string() }) }).parse(manifest).worker
  if (worker.name !== config.name) throw new Error('Manifest and Wrangler Worker names disagree')
  const accountId = outcome.block.accountId ?? config.account_id
  if (!accountId || !ACCOUNT_ID_PATTERN.test(accountId))
    throw new Error('Commit the production account ID in the deployment block or Wrangler config')
  if (
    [config.account_id, env.CLOUDFLARE_ACCOUNT_ID].some(
      (value) => value !== undefined && value !== accountId,
    )
  ) {
    throw new Error('Cloudflare account IDs disagree; refusing a cross-account hotfix')
  }
  if (outcome.block.staging.enabled && outcome.block.staging.workerName === config.name) {
    throw new Error('The hotfix target must be the production Worker')
  }
  const commonDir = resolve(repoRoot, hotfixGit(repoRoot, ['rev-parse', '--git-common-dir'], env))
  return {
    repoRoot,
    appRelative: relative(repoRoot, appDir),
    accountId,
    workerName: config.name,
    sha: flags.sha,
    baseUrl: new URL(flags.baseUrl).origin,
    deployment: outcome.block,
    evidenceDir: join(commonDir, 'narduk', 'hotfix'),
  }
}

export function assertHotfixSnapshot(
  plan: HotfixPlan,
  snapshot: string,
  env: NodeJS.ProcessEnv,
): void {
  if (
    hotfixGit(snapshot, ['rev-parse', 'HEAD'], env) !== plan.sha ||
    hotfixGit(snapshot, ['status', '--porcelain', '--untracked-files=no'], env)
  ) {
    throw new Error('Checks or build changed committed source in the hotfix snapshot')
  }
  const appDir = join(snapshot, plan.appRelative)
  if (
    !existsSync(join(appDir, '.output/server/index.mjs')) ||
    !existsSync(join(appDir, '.output/public'))
  ) {
    throw new Error('hotfix:build did not produce the expected Worker and public assets')
  }
  const path = resolveWranglerConfigPath(appDir)
  if (!path || dirname(path) !== appDir) throw new Error('Snapshot lost its Wrangler config')
}
