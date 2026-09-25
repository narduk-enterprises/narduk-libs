import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { fetchWorkerPlainTextVars } from './cloudflare.js'
import { readWranglerScriptName, resolveAppDir, runDeploy } from './deploy.js'

/**
 * Build secrets come from the process environment, which the caller fills from
 * the app's nvault config (`nvault run -p <app> -e prd -c <config> -- narduk-app
 * deploy-local ...`). This command used to read them from Doppler `narduk/tokens`;
 * Doppler is retired except the `ne` root store (2026-09-24), so there is
 * deliberately no Doppler route and no fallback.
 */
const DEFAULT_SECRET_KEYS = [
  'GH_PACKAGES_READ',
  'NUXT_OG_IMAGE_SECRET',
  'NUXT_SESSION_PASSWORD',
] as const

/**
 * `GH_PACKAGES_READ` is estate-wide, not per app: its registered route is this
 * nvault selector, so an app config holds no copy of it (narduk-libs#333).
 */
const PACKAGES_READ_NVAULT_SELECTOR = {
  project: 'github',
  environment: 'prd',
  config: 'narduk-enterprises-packages-read',
} as const
const PACKAGES_READ_RUN = `nvault run -p ${PACKAGES_READ_NVAULT_SELECTOR.project} -e ${PACKAGES_READ_NVAULT_SELECTOR.environment} -c ${PACKAGES_READ_NVAULT_SELECTOR.config}`

export interface DeployLocalFlags {
  dryRun: boolean
  force: boolean
  noProbe: boolean
  skipMigrate: boolean
  yes: boolean
}

export interface DeployLocalOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  flags: DeployLocalFlags
  secretKeys?: readonly string[]
}

export function parseDeployLocalArgs(args: string[]): DeployLocalFlags {
  const flags: DeployLocalFlags = {
    dryRun: false,
    force: false,
    noProbe: false,
    skipMigrate: false,
    yes: false,
  }
  for (const arg of args) {
    if (arg === '--yes' || arg === '-y') flags.yes = true
    else if (arg === '--dry-run') flags.dryRun = true
    else if (arg === '--force') flags.force = true
    else if (arg === '--no-probe') flags.noProbe = true
    else if (arg === '--skip-migrate') flags.skipMigrate = true
    else throw new Error(`Unknown deploy-local option: ${arg}`)
  }
  return flags
}

export function isGitWorkingTreeClean(repoRoot: string, env = process.env): boolean {
  const result = spawnSync('git', ['status', '--porcelain'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env,
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  if (result.error || result.signal || result.status !== 0) return false
  return !(result.stdout || '').trim()
}

export function buildMergedDeployEnv(args: {
  base: NodeJS.ProcessEnv
  cfVars: Record<string, string>
  secrets: Record<string, string>
}): NodeJS.ProcessEnv {
  return { ...args.base, ...args.cfVars, ...args.secrets }
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]'])

export function normalizeDeployHostname(host: string): string {
  return host.startsWith('[') && host.endsWith(']')
    ? host.slice(1, -1).replace(/\.+$/u, '')
    : host.replace(/\.+$/u, '')
}

function isLoopbackIpv4(host: string): boolean {
  const octets = host.split('.')
  if (octets.length !== 4 || octets.some((octet) => !/^\d+$/u.test(octet))) return false
  const values = octets.map((octet) => Number(octet))
  return values.every((value) => value >= 0 && value <= 255) && values[0] === 127
}

function mappedIpv4(host: string): string | null {
  const normalized = normalizeDeployHostname(host).toLowerCase()
  const dotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/u.exec(normalized)
  if (dotted?.[1]) return dotted[1]
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/u.exec(normalized)
  if (!hex) return null
  const high = Number.parseInt(hex[1], 16)
  const low = Number.parseInt(hex[2], 16)
  return `${(high >> 8) & 255}.${high & 255}.${(low >> 8) & 255}.${low & 255}`
}

export function isNonLocalHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value.trim())
    const host = url.hostname.toLowerCase()
    const normalized = normalizeDeployHostname(host)
    const mapped = mappedIpv4(normalized)
    return (
      url.protocol === 'https:' &&
      Boolean(host) &&
      !LOCAL_HOSTS.has(host) &&
      !LOCAL_HOSTS.has(normalized) &&
      !normalized.endsWith('.localhost') &&
      !isLoopbackIpv4(normalized) &&
      !(mapped && isLoopbackIpv4(mapped))
    )
  } catch {
    return false
  }
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

function parseSecretKeys(env: NodeJS.ProcessEnv, keys: readonly string[]): readonly string[] {
  // NARDUK_APP_DOPPLER_KEYS is the historical name of the same key list.
  const configured = (env.NARDUK_APP_SECRET_KEYS ?? env.NARDUK_APP_DOPPLER_KEYS)
    ?.split(',')
    .map((key) => key.trim())
    .filter(Boolean)
  return configured && configured.length > 0 ? configured : keys
}

/** The build secrets, read from the environment only; missing keys fail closed. */
export function readDeployLocalSecrets(
  env: NodeJS.ProcessEnv,
  keys: readonly string[],
): Record<string, string> {
  const missing = keys.filter((key) => !env[key]?.trim())
  if (missing.length > 0) {
    const appKeys = missing.filter((key) => key !== 'GH_PACKAGES_READ')
    throw new Error(
      [
        `deploy-local needs ${missing.join(', ')} in its environment.`,
        'It no longer reads Doppler narduk/tokens: Doppler is retired except the ne root store.',
        ...(missing.includes('GH_PACKAGES_READ')
          ? [`GH_PACKAGES_READ comes from its registered route, \`${PACKAGES_READ_RUN} --\`.`]
          : []),
        ...(appKeys.length > 0
          ? [
              `${appKeys.join(', ')} come${appKeys.length === 1 ? 's' : ''} from the app nvault config.`,
            ]
          : []),
        keys.includes('GH_PACKAGES_READ')
          ? `Run it under both, for example \`${PACKAGES_READ_RUN} -- nvault run -p <app> -e prd -c <config> -- narduk-app deploy-local --yes\`,`
          : 'Run it under the app nvault config, for example `nvault run -p <app> -e prd -c <config> -- narduk-app deploy-local --yes`,',
        'or use `narduk-app deploy-hotfix` (docs/local-hotfix.md).',
      ].join(' '),
    )
  }
  return Object.fromEntries(keys.map((key) => [key, env[key]?.trim() ?? '']))
}

function assertProbeableSiteUrl(siteUrl: string): void {
  if (!isNonLocalHttpsUrl(siteUrl)) {
    throw new Error(
      `Refusing deploy: SITE_URL must be a non-local https URL (got ${siteUrl || '(empty)'})`,
    )
  }
}

async function probeSiteUrl(siteUrl: string): Promise<void> {
  assertProbeableSiteUrl(siteUrl)
  const url = new URL(siteUrl)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) throw new Error(`Probe GET ${siteUrl} returned ${response.status}`)
    console.log(`[deploy-local] probe OK (${response.status})`)
  } finally {
    clearTimeout(timer)
  }
}

export async function runDeployLocal(options: DeployLocalOptions): Promise<number> {
  const cwd = resolve(options.cwd ?? process.cwd())
  const env = options.env ?? process.env
  const appDir = resolveAppDir(cwd)
  const repoRoot = resolve(appDir, '../..')
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim()
  const apiToken = env.CLOUDFLARE_API_TOKEN?.trim()
  if (!accountId || !apiToken)
    throw new Error('CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN must be set.')

  const scriptName = readWranglerScriptName(appDir)
  const cfVars = await fetchWorkerPlainTextVars({ accountId, apiToken, scriptName })
  const siteUrl = cfVars.SITE_URL?.trim() ?? ''
  // The probe needs a URL it can reach, and SITE_URL is known now: refuse
  // before building, migrating or deploying, not after production moved (#877).
  if (!options.flags.noProbe) assertProbeableSiteUrl(siteUrl)
  const secretKeys = parseSecretKeys(env, options.secretKeys ?? DEFAULT_SECRET_KEYS)
  const secrets = readDeployLocalSecrets(env, secretKeys)

  const dirty = !isGitWorkingTreeClean(repoRoot, env)
  if (dirty && !options.flags.force) {
    throw new Error('Git working tree is not clean. Commit/stash changes or pass --force.')
  }
  console.log(`[deploy-local] app=${appDir}`)
  console.log(`[deploy-local] worker=${scriptName}`)
  console.log(`[deploy-local] SITE_URL=${siteUrl}`)
  console.log(`[deploy-local] git dirty=${dirty ? 'yes' : 'no'}`)
  if (options.flags.dryRun) return 0
  if (!options.flags.yes && env.CI !== 'true') {
    throw new Error('Interactive confirmation is required; pass --yes for headless use.')
  }

  const mergedEnv = buildMergedDeployEnv({ base: env, cfVars, secrets })
  const runPnpm = (script: string): number => {
    const result = spawnSync('pnpm', ['run', script], {
      cwd: appDir,
      env: mergedEnv,
      stdio: 'inherit',
    })
    return result.error || result.signal ? 1 : (result.status ?? 1)
  }
  const buildStatus = runPnpm('cf:build')
  if (buildStatus !== 0) return buildStatus
  const leaks = scanPublicAssetsForSecretLeaks(appDir, secrets)
  if (leaks.length > 0) {
    console.error('[deploy-local] bundle leak scan failed:')
    for (const leak of leaks) console.error(`  - ${leak}`)
    return 1
  }
  if (!options.flags.skipMigrate) {
    const packageJson = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>
    }
    if (packageJson.scripts?.['db:migrate:remote']) {
      const migrateStatus = runPnpm('db:migrate:remote')
      if (migrateStatus !== 0) return migrateStatus
    }
  }
  const deployStatus = runDeploy(['deploy'], appDir, {
    ...mergedEnv,
    NARDUK_ALLOW_LOCAL_WRANGLER_DEPLOY: '1',
  })
  if (deployStatus !== 0) return deployStatus
  if (!options.flags.noProbe) await probeSiteUrl(siteUrl)
  return 0
}
