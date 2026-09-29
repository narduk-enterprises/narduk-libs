import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { z } from 'zod'

import { findCloudflareAppConfig, readJsonc, resolveWranglerConfigPath } from './deploy.js'
import {
  ACCOUNT_ID_PATTERN,
  readDeploymentBlock,
  type DeploymentBlock,
} from './deployment-config.js'
import { currentDeployment, soleDeployedVersionId, type WranglerVersionsClient } from './promote.js'

/**
 * Helpers `narduk-app ship` (src/ship.ts) and `narduk-app deploy` share: the
 * scrubbed build environment, the committed production target, the built-output
 * and secret-leak gates, and the sole-deployment read. They lived in the
 * deploy-local, deploy-hotfix and development modules until those were removed.
 */

/** The build identity the ship build environment pins. */
export interface BuildIdentity {
  sha: string
  baseUrl: string
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

export function hotfixBuildEnv(env: NodeJS.ProcessEnv, flags: BuildIdentity): NodeJS.ProcessEnv {
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
export function assertProductionBuildSecret(key: string, value: string): void {
  if (
    ['NUXT_OG_IMAGE_SECRET', 'NUXT_SESSION_PASSWORD'].includes(key) &&
    (value.trim().length < 32 || value.startsWith('narduk-test-only-'))
  ) {
    throw new Error(`${key} must be a real production build secret, never a test placeholder`)
  }
}

export function hotfixProductionEnv(
  env: NodeJS.ProcessEnv,
  flags: BuildIdentity,
): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {
    ...hotfixBuildEnv(env, flags),
    NARDUK_ALLOW_LOCAL_WRANGLER_DEPLOY: '1',
  }
  for (const key of ['NUXT_OG_IMAGE_SECRET', 'NUXT_SESSION_PASSWORD']) {
    const value = env[key]
    if (value !== undefined) {
      assertProductionBuildSecret(key, value)
      result[key] = value
    }
  }
  return result
}

export interface ProductionTarget {
  accountId: string
  workerName: string
  deployment: DeploymentBlock
  /** The raw Config/cloudflare-app.json, for callers that read more of it. */
  manifest: unknown
}

/** The committed production Worker a local publish targets: one account, one name, narduk-v1. */
export function readProductionTarget(appDir: string, env: NodeJS.ProcessEnv): ProductionTarget {
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
      'Move Wrangler build.command into the build script; upload must not rebuild with deployment credentials',
    )
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
    throw new Error('Cloudflare account IDs disagree; refusing a cross-account publish')
  }
  if (outcome.block.staging.enabled && outcome.block.staging.workerName === config.name) {
    throw new Error('The publish target must be the production Worker')
  }
  return { accountId, workerName: config.name, deployment: outcome.block, manifest }
}

export function assertHotfixSnapshot(
  plan: { sha: string; appRelative: string },
  snapshot: string,
  env: NodeJS.ProcessEnv,
): void {
  if (
    hotfixGit(snapshot, ['rev-parse', 'HEAD'], env) !== plan.sha ||
    hotfixGit(snapshot, ['status', '--porcelain', '--untracked-files=no'], env)
  ) {
    throw new Error('Checks or build changed committed source in the ship snapshot')
  }
  const appDir = join(snapshot, plan.appRelative)
  if (
    !existsSync(join(appDir, '.output/server/index.mjs')) ||
    !existsSync(join(appDir, '.output/public'))
  ) {
    throw new Error('ship:build did not produce the expected Worker and public assets')
  }
  const path = resolveWranglerConfigPath(appDir)
  if (!path || dirname(path) !== appDir) throw new Error('Snapshot lost its Wrangler config')
}

function listPublicAssetFiles(publicDir: string): string[] {
  if (!existsSync(publicDir)) return []
  const files: string[] = []
  for (const entry of readdirSync(publicDir)) {
    const path = join(publicDir, entry)
    if (statSync(path).isDirectory()) files.push(...listPublicAssetFiles(path))
    else if (/\.(?:css|cjs|html|js|json|mjs|map|svg|txt)$/iu.test(entry)) files.push(path)
  }
  return files
}

export function scanPublicAssetsForSecretLeaks(
  appDir: string,
  secrets: Record<string, string>,
): string[] {
  const outputDir = join(appDir, '.output', 'public')
  const needles = Object.entries(secrets).filter(([, value]) => value.length >= 8)
  const hits: string[] = []
  for (const path of listPublicAssetFiles(outputDir)) {
    const content = readFileSync(path, 'utf8')
    for (const [key, value] of needles) {
      if (content.includes(value)) hits.push(`${key} appears in ${path}`)
    }
  }
  return hits
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

/** The single version serving 100%, from a fresh listing; split or ambiguous traffic refuses. */
export async function readDeployment(client: WranglerVersionsClient) {
  const rows = deploymentSchema.parse(await client.listDeployments())
  const current = currentDeployment(rows)
  if (!current || !soleDeployedVersionId(current))
    throw new Error(
      'A local publish requires an existing single-version deployment at 100%; split traffic is unsupported',
    )
  if (rows.filter((row) => row.created_on === current.created_on).length !== 1)
    throw new Error('Current deployment is ambiguous')
  return current
}
