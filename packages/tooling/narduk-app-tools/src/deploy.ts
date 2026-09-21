import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { parse, printParseErrorCode, type ParseError } from 'jsonc-parser'

import { readDeploymentBlock } from './deployment-config.js'
import {
  describePreviewPlan,
  planPreviewConfig,
  PREVIEW_CONFIG_FILENAME,
} from './preview-config.js'

export type DeployAction = 'deploy' | 'versions-upload'
export type DeployEnv = Record<string, string | undefined>

interface WranglerConfig {
  [key: string]: unknown
  assets?: Record<string, unknown>
  env?: Record<string, unknown>
  main?: string
}

const TRUTHY = new Set(['1', 'true', 'yes', 'on'])
const RETIRED_ENVIRONMENTS = new Set(['preview', 'staging'])

function isTruthy(value: string | undefined): boolean {
  return Boolean(value && TRUTHY.has(value.trim().toLowerCase()))
}

export function isLocalDeployAllowed(env: DeployEnv = process.env): boolean {
  return isTruthy(env.NARDUK_ALLOW_LOCAL_WRANGLER_DEPLOY)
}

export function isWorkersBuildDeployAllowed(env: DeployEnv = process.env): boolean {
  return (
    isTruthy(env.CI) &&
    isTruthy(env.WORKERS_CI) &&
    Boolean(env.WORKERS_CI_BUILD_UUID?.trim()) &&
    /^[a-f\d]{7,64}$/iu.test(env.WORKERS_CI_COMMIT_SHA?.trim() ?? '') &&
    Boolean(env.WORKERS_CI_BRANCH?.trim())
  )
}

export function getDeployGuardMessage(action: DeployAction): string {
  const label = action === 'deploy' ? 'wrangler deploy' : 'wrangler versions upload'
  return `Local ${label} is disabled by default. Push to the configured Workers Builds branch, or set NARDUK_ALLOW_LOCAL_WRANGLER_DEPLOY=1 for intentional recovery work.`
}

export function parseDeployArgs(args: string[]): {
  action: DeployAction
  passthroughArgs: string[]
} {
  const [first, ...rest] = args
  const passthroughArgs = rest[0] === '--' ? rest.slice(1) : rest
  if (passthroughArgs.includes('--')) {
    throw new Error('A bare -- is not allowed inside Wrangler deploy arguments')
  }
  if (first === 'versions-upload') return { action: 'versions-upload', passthroughArgs }
  if (first === 'deploy') return { action: 'deploy', passthroughArgs }
  throw new Error('Usage: narduk-app deploy <deploy|versions-upload> [args...]')
}

export function isDryRunDeploy(args: readonly string[]): boolean {
  return args.includes('--dry-run')
}

export function readJsonc<T>(path: string): T {
  const errors: ParseError[] = []
  const value = parse(readFileSync(path, 'utf8'), errors, {
    allowEmptyContent: false,
    allowTrailingComma: true,
    disallowComments: false,
  }) as T
  if (errors.length > 0) {
    const details = errors
      .map((error) => `${printParseErrorCode(error.error)} at offset ${error.offset}`)
      .join(', ')
    throw new Error(`Could not parse Wrangler config ${path}: ${details}`)
  }
  return value
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function hasFlag(args: readonly string[], flag: string): boolean {
  return args.some((arg) => arg === flag || arg.startsWith(`${flag}=`))
}

/**
 * The commit tag that makes a promotion possible.
 *
 * A Worker version carries no commit field: read live on 2026-09-17,
 * `wrangler versions list --name buoys --json` returns only
 * `metadata.{created_on,source,author_id,author_email,has_preview}` and
 * `annotations.{workers/alias,workers/triggered_by}`, and Cloudflare's Versions
 * API reference documents no annotation fields at all. The single
 * commit-shaped handle a version can hold is `annotations["workers/tag"]`,
 * written by `wrangler versions upload --tag` (and `wrangler deploy --tag`).
 *
 * So the build stamps it. Inside a Workers Build, `WORKERS_CI_COMMIT_SHA` is
 * the commit being built, and `narduk-app deploy versions-upload` passes it as
 * `--tag` unless the caller supplied one; `narduk-app deploy versions-promote`
 * then resolves a SHA back to a version id by reading that annotation. Without
 * this, the promote half of the standard has no input at all.
 */
export function resolveVersionTagArgs(
  passthroughArgs: readonly string[],
  env: DeployEnv = process.env,
): string[] {
  if (hasFlag(passthroughArgs, '--tag')) return []
  const sha = env.WORKERS_CI_COMMIT_SHA?.trim() ?? ''
  if (!/^[a-f\d]{7,64}$/iu.test(sha)) return []
  const args = ['--tag', sha.toLowerCase()]
  const branch = env.WORKERS_CI_BRANCH?.trim()
  if (branch && !hasFlag(passthroughArgs, '--message')) {
    args.push('--message', `Workers Builds ${branch} @ ${sha.slice(0, 12).toLowerCase()}`)
  }
  return args
}

export function hasExplicitWranglerEnvTarget(args: string[]): boolean {
  return args.some(
    (arg) => arg === '--env' || arg.startsWith('--env=') || arg === '-e' || arg.startsWith('-e='),
  )
}

export function flattenWranglerDeployConfig(
  config: WranglerConfig,
  options: { preserveNamedEnvironments?: boolean } = {},
): WranglerConfig {
  const result = JSON.parse(JSON.stringify(config)) as WranglerConfig
  if (!result.env || typeof result.env !== 'object') return result
  if (!options.preserveNamedEnvironments) {
    delete result.env
    return result
  }
  const env = Object.fromEntries(
    Object.entries(result.env).filter(([name]) => !RETIRED_ENVIRONMENTS.has(name)),
  )
  if (Object.keys(env).length > 0) result.env = env
  else delete result.env
  return result
}

/** The redirect file Wrangler reads when it is run without `--config`. */
function deployRedirectPath(appDir: string): string {
  return join(appDir, '.wrangler', 'deploy', 'config.json')
}

/**
 * `Config/cloudflare-app.json`, found from the app directory upward. A Workers
 * Build may run from `apps/web` while the declaration lives at the repository
 * root, so the walk climbs until it finds the file or reaches the repository
 * root (a directory holding `.git`), and gives up after a few levels rather than
 * reading some unrelated checkout's declaration.
 */
export function findCloudflareAppConfig(appDir: string): string | null {
  let dir = resolve(appDir)
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = join(dir, 'Config', 'cloudflare-app.json')
    if (existsSync(candidate)) return candidate
    if (existsSync(join(dir, '.git'))) return null
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
  return null
}

/**
 * Which config `versions-upload` hands Wrangler (narduk-libs#473, design §3.3
 * option A).
 *
 * A Workers Build on a branch other than `deployment.productionBranch` uploads
 * a version that serves a preview URL. Uploaded with the production config,
 * that version binds production D1, KV and R2. So when the app's deployment
 * block names a preview resource for every one of those bindings, this writes
 * `.wrangler.deploy.preview.json` with each rebound and returns it.
 *
 * Everything else keeps the production config, unchanged from earlier
 * releases: the production branch, a run outside Workers Builds (no
 * `WORKERS_CI_BRANCH`), an app with no valid `narduk-v1` block, and an explicit
 * `--env` target. A preview that cannot be fully rebound also keeps it, and
 * says so on stderr, because a half-rebound preview mixes preview and
 * production state under the same keys. `deploy` always keeps it: it serves
 * production traffic and must bind production.
 */
export function selectDeployConfig(options: {
  action: DeployAction
  appDir: string
  sourceConfigPath: string
  productionConfigPath: string
  passthroughArgs: readonly string[]
  env?: DeployEnv
  log?: (line: string) => void
}): string {
  const env = options.env ?? process.env
  const log = options.log ?? ((line: string) => console.error(line))
  const production = options.productionConfigPath
  if (options.action !== 'versions-upload') return production
  const branch = env.WORKERS_CI_BRANCH?.trim()
  if (!branch) return production
  const appFile = findCloudflareAppConfig(options.appDir)
  if (!appFile) return production
  let outcome: ReturnType<typeof readDeploymentBlock>
  try {
    outcome = readDeploymentBlock(readJsonc<unknown>(appFile))
  } catch (error) {
    log(
      `narduk-app deploy: WARNING -- could not read ${appFile} ` +
        `(${error instanceof Error ? error.message : String(error)}), so branch ${branch} ` +
        'uploads with the production config.',
    )
    return production
  }
  if (outcome.kind !== 'valid') return production
  const { productionBranch, previewBindings } = outcome.block
  if (branch === productionBranch) return production
  const warn = (why: string): string => {
    log(
      `narduk-app deploy: WARNING -- non-production branch ${branch} uploads with the ` +
        `PRODUCTION bindings, because ${why}. This preview reads and writes production data. ` +
        'Name a preview resource for every D1/KV/R2 binding under deployment.previewBindings ' +
        '(narduk-libs#473).',
    )
    return production
  }
  if (hasExplicitWranglerEnvTarget([...options.passthroughArgs])) {
    return warn('an explicit --env target was passed and the preview config is top-level only')
  }
  const plan = planPreviewConfig(readJsonc<Record<string, unknown>>(production), previewBindings, [
    readJsonc<unknown>(options.sourceConfigPath),
  ])
  if (plan.status === 'no-bindings') return production
  if (plan.status !== 'ready' || !plan.config) return warn(describePreviewPlan(plan))
  const previewPath = join(options.appDir, PREVIEW_CONFIG_FILENAME)
  writeJson(previewPath, plan.config)
  writeJson(deployRedirectPath(options.appDir), { configPath: `../../${PREVIEW_CONFIG_FILENAME}` })
  log(
    `narduk-app deploy: non-production branch ${branch} -- uploading with ` +
      `${PREVIEW_CONFIG_FILENAME}; ${plan.rebound.join(', ')}`,
  )
  return previewPath
}

export function writeFlattenedWranglerDeployConfig(
  configPath: string,
  options: { preserveNamedEnvironments?: boolean; keepVars?: boolean } = {},
): string {
  if (!existsSync(configPath)) throw new Error(`Wrangler config not found at ${configPath}`)
  const appDir = dirname(configPath)
  const outputPath = join(appDir, '.wrangler.deploy.production.json')
  const redirectPath = deployRedirectPath(appDir)
  const config = flattenWranglerDeployConfig(readJsonc<WranglerConfig>(configPath), options)
  config.main = '.output/server/index.mjs'
  config.assets = { ...(config.assets ?? {}), directory: '.output/public' }
  // Wrangler 4.90.1 versions upload supports this config key; the equivalent
  // CLI flag was only added in 4.92.0. Never mutate committed source for it.
  if (options.keepVars) config.keep_vars = true
  writeJson(outputPath, config)
  writeJson(redirectPath, { configPath: '../../.wrangler.deploy.production.json' })
  return outputPath
}

export function buildWranglerCommandArgs(options: {
  action: DeployAction
  hasGeneratedConfig: boolean
  hasOutputEntrypoint: boolean
  passthroughArgs: string[]
  sourceConfigPath: string | null
  appDir?: string
  env?: DeployEnv
}): string[] {
  const command = options.action === 'deploy' ? ['deploy'] : ['versions', 'upload']
  const keepVars = options.action === 'deploy' ? ['--keep-vars'] : []
  const envTarget = hasExplicitWranglerEnvTarget(options.passthroughArgs) ? [] : ['--env=']
  const tag = resolveVersionTagArgs(options.passthroughArgs, options.env ?? process.env)
  const appDir = options.appDir ?? process.cwd()
  if (options.sourceConfigPath) {
    return [
      'exec',
      'wrangler',
      '--config',
      options.sourceConfigPath,
      ...command,
      ...envTarget,
      ...keepVars,
      ...tag,
      ...options.passthroughArgs,
    ]
  }
  if (options.hasGeneratedConfig) {
    return [
      'exec',
      'wrangler',
      '--config',
      join(appDir, '.output', 'server', 'wrangler.json'),
      ...command,
      ...envTarget,
      ...keepVars,
      ...tag,
      ...options.passthroughArgs,
    ]
  }
  if (options.hasOutputEntrypoint) {
    return [
      'exec',
      'wrangler',
      '--cwd',
      join(appDir, '.output'),
      ...command,
      'server/index.mjs',
      '--assets',
      'public',
      ...keepVars,
      ...tag,
      ...options.passthroughArgs,
    ]
  }
  throw new Error(`No deployable build output found in ${appDir}; run the app build first.`)
}

export function runDeploy(
  args: string[],
  appDir = process.cwd(),
  env: DeployEnv = process.env,
  options: { keepVars?: boolean } = {},
): number {
  const { action, passthroughArgs } = parseDeployArgs(args)
  if (
    !isDryRunDeploy(passthroughArgs) &&
    !isWorkersBuildDeployAllowed(env) &&
    !isLocalDeployAllowed(env)
  ) {
    console.error(getDeployGuardMessage(action))
    return 1
  }
  const configPath = resolveWranglerConfigPath(appDir)
  const outputEntrypoint = join(appDir, '.output', 'server', 'index.mjs')
  const productionConfigPath =
    configPath && existsSync(outputEntrypoint)
      ? writeFlattenedWranglerDeployConfig(configPath, {
          preserveNamedEnvironments: hasExplicitWranglerEnvTarget(passthroughArgs),
          keepVars: options.keepVars,
        })
      : null
  if (options.keepVars && !productionConfigPath)
    throw new Error('Preserving hotfix vars requires a source Wrangler config and built output')
  const sourceConfigPath =
    configPath && productionConfigPath
      ? selectDeployConfig({
          action,
          appDir,
          sourceConfigPath: configPath,
          productionConfigPath,
          passthroughArgs,
          env,
        })
      : productionConfigPath
  const commandArgs = buildWranglerCommandArgs({
    action,
    appDir,
    hasGeneratedConfig: existsSync(join(appDir, '.output', 'server', 'wrangler.json')),
    hasOutputEntrypoint: existsSync(outputEntrypoint),
    passthroughArgs,
    sourceConfigPath,
    env,
  })
  const result = spawnSync('pnpm', commandArgs, { cwd: appDir, env, stdio: 'inherit' })
  if (result.error) {
    console.error(`Could not run pnpm: ${result.error.message}`)
    return 1
  }
  if (result.signal) return 1
  return result.status ?? 1
}

export function resolveAppDir(cwd: string): string {
  if (resolveWranglerConfigPath(cwd)) return resolve(cwd)
  const nested = join(cwd, 'apps', 'web')
  if (resolveWranglerConfigPath(nested)) return resolve(nested)
  throw new Error(
    'Could not locate wrangler.jsonc or wrangler.json. Run from the app directory or repository root.',
  )
}

export function resolveWranglerConfigPath(appDir: string): string | null {
  for (const filename of ['wrangler.jsonc', 'wrangler.json']) {
    const path = join(appDir, filename)
    if (existsSync(path)) return path
  }
  return null
}

export function readWranglerScriptName(appDir: string): string {
  const path = resolveWranglerConfigPath(appDir)
  if (!path) throw new Error(`Missing Wrangler config in ${appDir}`)
  const config = readJsonc<{ name?: string }>(path)
  if (!config.name?.trim()) throw new Error(`Missing name in ${path}`)
  return config.name.trim()
}
