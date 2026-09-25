export type DeploymentTarget = 'production' | 'staging' | 'preview'

export type DeploymentTargetSource = 'explicit' | 'branch' | 'default'

export interface ResolvedBuildDeploymentTarget {
  source: DeploymentTargetSource
  target: DeploymentTarget
}

export interface ResolveBuildDeploymentTargetOptions {
  /** Target when neither an explicit variable nor a build branch is set. Default `'production'`. */
  default?: DeploymentTarget
  /** Branch whose builds are production; every other branch is a preview. Default `'main'`. */
  productionBranch?: string
}

/** Explicit target variables, in the precedence the module has always read them. */
export const DEPLOYMENT_TARGET_ENV_KEYS = [
  'NARDUK_DEPLOY_TARGET',
  'NUXT_PUBLIC_NARDUK_DEPLOY_TARGET',
  'NUXT_PUBLIC_DEPLOYMENT_TARGET',
] as const

/** Build-branch variables: Workers Builds first, then Cloudflare Pages. */
export const BUILD_BRANCH_ENV_KEYS = ['WORKERS_CI_BRANCH', 'CF_PAGES_BRANCH'] as const

const DEPLOYMENT_TARGETS: ReadonlySet<string> = new Set<DeploymentTarget>([
  'production',
  'staging',
  'preview',
])

type Env = Record<string, string | undefined>

function readFirstEnv(env: Env, keys: readonly string[]): string {
  for (const key of keys) {
    const value = env[key]?.trim()
    if (value) return value
  }
  return ''
}

export function isDeploymentTarget(value: unknown): value is DeploymentTarget {
  return typeof value === 'string' && DEPLOYMENT_TARGETS.has(value)
}

/**
 * The deployment target of the build running now, config-safe for
 * `nuxt.config.ts` (no Nuxt imports).
 *
 * 1. `explicit` — the first non-blank of `NARDUK_DEPLOY_TARGET`,
 *    `NUXT_PUBLIC_NARDUK_DEPLOY_TARGET`, `NUXT_PUBLIC_DEPLOYMENT_TARGET`,
 *    trimmed and lowercased, when it is `production`, `staging` or `preview`.
 *    Any other value is ignored here.
 * 2. `branch` — `WORKERS_CI_BRANCH` (Workers Builds) or `CF_PAGES_BRANCH`:
 *    `production` on `options.productionBranch` (default `main`), otherwise
 *    `preview`.
 * 3. `default` — `options.default` (default `production`).
 */
export function resolveBuildDeploymentTarget(
  env: Env = process.env,
  options: ResolveBuildDeploymentTargetOptions = {},
): ResolvedBuildDeploymentTarget {
  const explicit = readFirstEnv(env, DEPLOYMENT_TARGET_ENV_KEYS).toLowerCase()
  if (isDeploymentTarget(explicit)) return { target: explicit, source: 'explicit' }

  const branch = readFirstEnv(env, BUILD_BRANCH_ENV_KEYS)
  if (branch) {
    const productionBranch = options.productionBranch ?? 'main'
    return { target: branch === productionBranch ? 'production' : 'preview', source: 'branch' }
  }

  return { target: options.default ?? 'production', source: 'default' }
}
