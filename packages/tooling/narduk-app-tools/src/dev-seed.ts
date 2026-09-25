/**
 * `narduk-app dev:seed` (narduk-libs#378): one command from a clean checkout to
 * a seeded local D1/KV/R2 environment, with no production credential.
 *
 * Every write goes through Wrangler's local mode (`--local`, Miniflare state
 * under `.wrangler/state` or `--persist-to`), and the child process runs with
 * the Cloudflare credential variables removed, so a seed can never reach a
 * remote resource even when the shell that ran it holds a token. That is what
 * makes it usable in a cloud agent container, where no production credential
 * exists at all.
 *
 * Fixtures live beside the app, one directory per binding:
 *
 * ```
 * seed/
 *   d1/<BINDING>/*.sql          executed in name order (schema, then rows)
 *   kv/<BINDING>/*.json         `wrangler kv bulk put` files: [{ "key", "value" }]
 *   r2/<BINDING>/<object key>   each file uploaded under its path as the key
 * ```
 *
 * A binding directory must name a binding the wrangler config declares, so a
 * renamed binding fails the seed instead of seeding nothing.
 */

import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

import { parse as parseJsonc, type ParseError } from 'jsonc-parser'

import { spawnWranglerSync } from './package-manager.js'

export const DEV_SEED_USAGE =
  'Usage: narduk-app dev:seed [--cwd <app dir>] [--config <wrangler config>] ' +
  '[--fixtures <dir>] [--persist-to <dir>] [--reset] [--dry-run] [--json]'

/** Removed from the Wrangler child's environment: local mode needs none of them. */
export const DEV_SEED_STRIPPED_ENV = [
  'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_API_KEY',
  'CLOUDFLARE_EMAIL',
  'CLOUDFLARE_ACCOUNT_ID',
  'CF_API_TOKEN',
  'CF_API_KEY',
  'CF_EMAIL',
  'CF_ACCOUNT_ID',
] as const

const WRANGLER_CONFIG_NAMES = ['wrangler.jsonc', 'wrangler.json'] as const

export interface DevSeedFlags {
  cwd: string
  config: string | null
  fixtures: string
  persistTo: string | null
  reset: boolean
  dryRun: boolean
  json: boolean
}

export type DevSeedKind = 'd1' | 'kv' | 'r2'

export interface DevSeedStep {
  kind: DevSeedKind
  binding: string
  /** Fixture file, relative to the app directory. */
  file: string
  /** Wrangler arguments, `--local` and any `--config`/`--persist-to` included. */
  args: string[]
}

export interface DevSeedPlan {
  cwd: string
  wranglerConfig: string
  fixtures: string
  steps: DevSeedStep[]
  /** Local state directories `--reset` removes before seeding. */
  resetPaths: string[]
}

export function parseDevSeedArgs(args: string[], cwd = process.cwd()): DevSeedFlags {
  const flags: DevSeedFlags = {
    cwd,
    config: null,
    fixtures: 'seed',
    persistTo: null,
    reset: false,
    dryRun: false,
    json: false,
  }
  const value = (index: number, name: string) => {
    const next = args[index]
    if (!next || next.startsWith('--')) throw new Error(`dev:seed: ${name} needs a value`)
    return next
  }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--cwd') flags.cwd = value((index += 1), arg)
    else if (arg === '--config') flags.config = value((index += 1), arg)
    else if (arg === '--fixtures') flags.fixtures = value((index += 1), arg)
    else if (arg === '--persist-to') flags.persistTo = value((index += 1), arg)
    else if (arg === '--reset') flags.reset = true
    else if (arg === '--dry-run') flags.dryRun = true
    else if (arg === '--json') flags.json = true
    else throw new Error(`Unknown dev:seed option: ${arg}\n${DEV_SEED_USAGE}`)
  }
  return { ...flags, cwd: resolve(cwd, flags.cwd) }
}

interface WranglerBindings {
  d1: Set<string>
  kv: Set<string>
  /** R2 binding → bucket name; `wrangler r2 object put` addresses the bucket. */
  r2: Map<string, string>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function readWranglerBindings(path: string): WranglerBindings {
  if (path.endsWith('.toml')) {
    throw new Error(
      `dev:seed reads wrangler.json or wrangler.jsonc; ${path} is TOML. Pass --config <json config>.`,
    )
  }
  const errors: ParseError[] = []
  const config = parseJsonc(readFileSync(path, 'utf8'), errors, { allowTrailingComma: true })
  if (errors.length > 0 || !isRecord(config)) {
    throw new Error(`dev:seed: ${path} is not valid JSON/JSONC`)
  }
  const list = (key: string) => (Array.isArray(config[key]) ? (config[key] as unknown[]) : [])
  const bindings: WranglerBindings = { d1: new Set(), kv: new Set(), r2: new Map() }
  for (const entry of list('d1_databases')) {
    if (isRecord(entry) && typeof entry.binding === 'string') bindings.d1.add(entry.binding)
  }
  for (const entry of list('kv_namespaces')) {
    if (isRecord(entry) && typeof entry.binding === 'string') bindings.kv.add(entry.binding)
  }
  for (const entry of list('r2_buckets')) {
    if (isRecord(entry) && typeof entry.binding === 'string') {
      const bucket = typeof entry.bucket_name === 'string' ? entry.bucket_name : entry.binding
      bindings.r2.set(entry.binding, bucket)
    }
  }
  return bindings
}

function resolveWranglerConfig(cwd: string, config: string | null): string {
  if (config) {
    const path = resolve(cwd, config)
    if (!existsSync(path)) throw new Error(`dev:seed: --config ${config} does not exist`)
    return path
  }
  for (const name of WRANGLER_CONFIG_NAMES) {
    const path = join(cwd, name)
    if (existsSync(path)) return path
  }
  throw new Error(
    `dev:seed: no wrangler.jsonc or wrangler.json in ${cwd}. Run it from the app directory ` +
      '(apps/web in a generated app), or pass --cwd / --config.',
  )
}

function isDirectory(path: string): boolean {
  return existsSync(path) && statSync(path).isDirectory()
}

function sortedEntries(dir: string): string[] {
  return readdirSync(dir).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

/** Every file under `dir`, recursively, as sorted `/`-separated relative paths. */
function filesUnder(dir: string, prefix = ''): string[] {
  const out: string[] = []
  for (const name of sortedEntries(dir)) {
    if (name.startsWith('.')) continue
    const full = join(dir, name)
    const rel = prefix ? `${prefix}/${name}` : name
    if (statSync(full).isDirectory()) out.push(...filesUnder(full, rel))
    else out.push(rel)
  }
  return out
}

function bindingDirs(root: string): string[] {
  if (!isDirectory(root)) return []
  return sortedEntries(root).filter((name) => isDirectory(join(root, name)))
}

function unknownBinding(kind: DevSeedKind, binding: string, declared: Iterable<string>): Error {
  const names = [...declared].sort()
  return new Error(
    `dev:seed: seed/${kind}/${binding} names no ${kind} binding in the wrangler config ` +
      `(declared: ${names.length > 0 ? names.join(', ') : 'none'})`,
  )
}

/** Plan every Wrangler call without running any. Pure apart from reading files. */
export function planDevSeed(flags: DevSeedFlags): DevSeedPlan {
  const cwd = flags.cwd
  const wranglerConfig = resolveWranglerConfig(cwd, flags.config)
  const bindings = readWranglerBindings(wranglerConfig)
  const fixtures = resolve(cwd, flags.fixtures)
  if (!isDirectory(fixtures)) {
    throw new Error(`dev:seed: fixture directory ${relative(cwd, fixtures) || '.'} does not exist`)
  }
  const persistTo = flags.persistTo ? resolve(cwd, flags.persistTo) : null
  const common = [
    '--local',
    '--config',
    wranglerConfig,
    ...(persistTo ? ['--persist-to', persistTo] : []),
  ]
  const rel = (path: string) => relative(cwd, path).split(sep).join('/')
  const steps: DevSeedStep[] = []

  for (const binding of bindingDirs(join(fixtures, 'd1'))) {
    if (!bindings.d1.has(binding)) throw unknownBinding('d1', binding, bindings.d1)
    const dir = join(fixtures, 'd1', binding)
    for (const name of sortedEntries(dir).filter((file) => file.endsWith('.sql'))) {
      const file = join(dir, name)
      steps.push({
        kind: 'd1',
        binding,
        file: rel(file),
        args: ['d1', 'execute', binding, `--file=${file}`, ...common],
      })
    }
  }

  for (const binding of bindingDirs(join(fixtures, 'kv'))) {
    if (!bindings.kv.has(binding)) throw unknownBinding('kv', binding, bindings.kv)
    const dir = join(fixtures, 'kv', binding)
    for (const name of sortedEntries(dir).filter((file) => file.endsWith('.json'))) {
      const file = join(dir, name)
      steps.push({
        kind: 'kv',
        binding,
        file: rel(file),
        args: ['kv', 'bulk', 'put', file, '--binding', binding, ...common],
      })
    }
  }

  for (const binding of bindingDirs(join(fixtures, 'r2'))) {
    const bucket = bindings.r2.get(binding)
    if (!bucket) throw unknownBinding('r2', binding, bindings.r2.keys())
    const dir = join(fixtures, 'r2', binding)
    for (const key of filesUnder(dir)) {
      const file = join(dir, key)
      steps.push({
        kind: 'r2',
        binding,
        file: rel(file),
        args: ['r2', 'object', 'put', `${bucket}/${key}`, '--file', file, ...common],
      })
    }
  }

  if (steps.length === 0) {
    throw new Error(
      `dev:seed: ${rel(fixtures)} holds no fixtures (expected d1/<BINDING>/*.sql, ` +
        'kv/<BINDING>/*.json or r2/<BINDING>/<files>)',
    )
  }

  const state = persistTo ?? join(cwd, '.wrangler', 'state')
  const resetPaths = flags.reset
    ? (['d1', 'kv', 'r2'] as const)
        .filter((kind) => steps.some((step) => step.kind === kind))
        .map((kind) => join(state, 'v3', kind))
    : []
  return { cwd, wranglerConfig: rel(wranglerConfig), fixtures: rel(fixtures), steps, resetPaths }
}

/** The Wrangler child's environment: the caller's, minus every Cloudflare credential. */
export function devSeedEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...env }
  for (const key of DEV_SEED_STRIPPED_ENV) delete out[key]
  return out
}

/** Injectable process boundary, as for the migration runner. */
export type DevSeedExecutor = (args: string[], cwd: string, env: NodeJS.ProcessEnv) => void

function runWrangler(args: string[], cwd: string, env: NodeJS.ProcessEnv): void {
  const result = spawnWranglerSync(cwd, args, {
    cwd,
    encoding: 'utf8',
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.error) throw new Error(`Could not run wrangler: ${result.error.message}`)
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `wrangler exited ${result.status}`).trim())
  }
}

export function runDevSeed(
  flags: DevSeedFlags,
  executor: DevSeedExecutor = runWrangler,
  env: NodeJS.ProcessEnv = process.env,
): DevSeedPlan {
  const plan = planDevSeed(flags)
  if (flags.dryRun) return plan
  for (const path of plan.resetPaths) rmSync(path, { force: true, recursive: true })
  const childEnv = devSeedEnv(env)
  for (const step of plan.steps) {
    try {
      executor(step.args, plan.cwd, childEnv)
    } catch (error) {
      throw new Error(
        `dev:seed: ${step.kind} ${step.binding} ${step.file} failed: ${(error as Error).message}`,
      )
    }
  }
  return plan
}

export function formatDevSeedPlan(plan: DevSeedPlan, dryRun: boolean): string {
  const counts = (['d1', 'kv', 'r2'] as const)
    .map((kind) => [kind, plan.steps.filter((step) => step.kind === kind).length] as const)
    .filter(([, count]) => count > 0)
    .map(([kind, count]) => `${kind} ${count}`)
    .join(', ')
  const lines = [
    `dev:seed: ${dryRun ? 'would seed' : 'seeded'} local state from ${plan.fixtures} ` +
      `(${counts}) using ${plan.wranglerConfig}`,
  ]
  for (const path of plan.resetPaths) {
    lines.push(`  ${dryRun ? 'would reset' : 'reset'} ${relative(plan.cwd, path)}`)
  }
  for (const step of plan.steps) lines.push(`  ${step.kind} ${step.binding} ← ${step.file}`)
  return lines.join('\n')
}
