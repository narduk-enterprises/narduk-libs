import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

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
  return isTruthy(env.SKIP_DEPENDENCY_INSTALL) || isTruthy(env.NARDUK_ALLOW_LOCAL_WRANGLER_DEPLOY)
}

export function getDeployGuardMessage(action: DeployAction): string {
  const label = action === 'deploy' ? 'wrangler deploy' : 'wrangler versions upload'
  return `Local ${label} is disabled by default. Push to the configured build branch, or set NARDUK_ALLOW_LOCAL_WRANGLER_DEPLOY=1 for intentional recovery work.`
}

export function parseDeployArgs(args: string[]): {
  action: DeployAction
  passthroughArgs: string[]
} {
  const [first, ...rest] = args
  if (first === 'versions-upload') return { action: 'versions-upload', passthroughArgs: rest }
  if (first === 'deploy') return { action: 'deploy', passthroughArgs: rest }
  return { action: 'deploy', passthroughArgs: args }
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
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

export function writeFlattenedWranglerDeployConfig(
  configPath: string,
  options: { preserveNamedEnvironments?: boolean } = {},
): string {
  if (!existsSync(configPath)) throw new Error(`Wrangler config not found at ${configPath}`)
  const appDir = dirname(configPath)
  const outputPath = join(appDir, '.wrangler.deploy.production.json')
  const redirectPath = join(appDir, '.wrangler', 'deploy', 'config.json')
  const config = flattenWranglerDeployConfig(readJson<WranglerConfig>(configPath), options)
  config.main = '.output/server/index.mjs'
  config.assets = { ...(config.assets ?? {}), directory: '.output/public' }
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
}): string[] {
  const command = options.action === 'deploy' ? ['deploy'] : ['versions', 'upload']
  const keepVars = options.action === 'deploy' ? ['--keep-vars'] : []
  const envTarget = hasExplicitWranglerEnvTarget(options.passthroughArgs) ? [] : ['--env=']
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
      ...options.passthroughArgs,
    ]
  }
  throw new Error(`No deployable build output found in ${appDir}; run the app build first.`)
}

export function runDeploy(
  args: string[],
  appDir = process.cwd(),
  env: DeployEnv = process.env,
): number {
  const { action, passthroughArgs } = parseDeployArgs(args)
  if (!isLocalDeployAllowed(env)) {
    console.error(getDeployGuardMessage(action))
    return 1
  }
  const configPath = join(appDir, 'wrangler.json')
  const outputEntrypoint = join(appDir, '.output', 'server', 'index.mjs')
  const sourceConfigPath =
    existsSync(configPath) && existsSync(outputEntrypoint)
      ? writeFlattenedWranglerDeployConfig(configPath, {
          preserveNamedEnvironments: hasExplicitWranglerEnvTarget(passthroughArgs),
        })
      : null
  const commandArgs = buildWranglerCommandArgs({
    action,
    appDir,
    hasGeneratedConfig: existsSync(join(appDir, '.output', 'server', 'wrangler.json')),
    hasOutputEntrypoint: existsSync(outputEntrypoint),
    passthroughArgs,
    sourceConfigPath,
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
  if (existsSync(join(cwd, 'wrangler.json'))) return resolve(cwd)
  const nested = join(cwd, 'apps', 'web')
  if (existsSync(join(nested, 'wrangler.json'))) return resolve(nested)
  throw new Error('Could not locate wrangler.json. Run from the app directory or repository root.')
}

export function readWranglerScriptName(appDir: string): string {
  const config = readJson<{ name?: string }>(join(appDir, 'wrangler.json'))
  if (!config.name?.trim()) throw new Error(`Missing name in ${join(appDir, 'wrangler.json')}`)
  return config.name.trim()
}
