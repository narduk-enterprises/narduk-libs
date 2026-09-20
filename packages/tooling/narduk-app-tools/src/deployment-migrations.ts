import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { z } from 'zod'

import {
  contractEvidenceIssuesOnDisk,
  contractOwnedEntries,
  findAppManifestRoot,
  ownershipCoverageIssues,
} from './database-ownership.js'
import { readJsonc } from './deploy.js'
import { readDeploymentBlock } from './deployment-config.js'
import { describePreviewPlan, planPreviewConfig } from './preview-config.js'
import {
  inspectMigrations,
  runMigrations,
  type MigrationExecutor,
  type MigrationPlan,
  type MigrationRunOptions,
} from './migrations.js'
import {
  createMigrationBundle,
  materializeMigrationBundle,
  readMigrationBundle,
} from './migration-bundle.js'

export type MigrationTarget = 'production' | 'preview' | 'staging'
const bindingSchema = z.object({
  binding: z.string().regex(/^[A-Za-z_]\w*$/u),
  database_name: z.string().min(1),
  database_id: z.uuid().refine((id) => !/^0{8}-/u.test(id), 'Placeholder D1 database ID'),
})
const manifestSchema = z.object({
  product: z.object({ repository: z.string().regex(/^[\w.-]+\/[\w.-]+$/u) }),
  worker: z.object({ wranglerConfig: z.string().min(1) }),
  deployment: z.unknown(),
})

export interface DeploymentMigrationPlan {
  target: MigrationTarget
  repository: string
  productionBranch: string
  accountId: string
  credential: string | null
  appDir: string
  config: Record<string, unknown>
  /** Bindings the migration runner is forbidden to touch: their schema is
   * owned by a contract file and proved by a command, not by this ledger. */
  contractOwned: Array<{ binding: string; contract: string; verify: string }>
  databases: Array<{ binding: string; databaseId: string; sources: string }>
}

function checkoutPath(root: string, path: string): string {
  if (isAbsolute(path)) throw new Error('Migration paths must be relative to the checkout')
  const absolute = realpathSync(resolve(root, path))
  const rel = relative(realpathSync(root), absolute)
  if (rel.startsWith('..') || isAbsolute(rel))
    throw new Error('Migration path escapes the checkout')
  return absolute
}

export function findMigrationCheckout(cwd: string): string {
  const root = findAppManifestRoot(cwd)
  if (root === null) throw new Error('Could not find Config/cloudflare-app.json')
  return root
}

/** `checkoutPath`, but with a readable error when the file simply is not there
 * -- `realpathSync` on a missing path raises ENOENT, which reads as a bug. */
function checkoutPathExists(root: string, path: string, label: string): string {
  if (!existsSync(resolve(root, path)))
    throw new Error(`The declared ${label} ${path} does not exist in this checkout`)
  return checkoutPath(root, path)
}

/** Where a verification command's script may live: the app's own package.json
 * and the checkout root's, which is where a monorepo usually keeps it. */
function packageJsonCandidates(root: string, appDir: string): string[] {
  const appRel = relative(root, appDir)
  const candidates = ['package.json']
  if (appRel !== '' && !appRel.startsWith('..')) candidates.push(join(appRel, 'package.json'))
  return [...new Set(candidates)]
}

/** Same preview planner as versions-upload: a migration cannot guess its target. */
export function planDeploymentMigrations(
  root: string,
  target: MigrationTarget,
): DeploymentMigrationPlan {
  const manifest = manifestSchema.parse(
    JSON.parse(readFileSync(join(root, 'Config', 'cloudflare-app.json'), 'utf8')),
  )
  const outcome = readDeploymentBlock({ deployment: manifest.deployment })
  if (outcome.kind !== 'valid')
    throw new Error('D1 deployment migrations require a valid narduk-v1 deployment block')
  const deployment = outcome.block
  const production = readJsonc<Record<string, unknown>>(
    checkoutPath(root, manifest.worker.wranglerConfig),
  )
  const accountId = z
    .string()
    .regex(/^[0-9a-f]{32}$/u)
    .parse(deployment.accountId ?? production.account_id)
  if (production.account_id !== undefined && production.account_id !== accountId) {
    throw new Error('Wrangler and deployment account IDs disagree')
  }
  let config = production
  if (target !== 'production') {
    if (target === 'staging' && !deployment.staging.enabled)
      throw new Error('Staging is not enabled')
    const replacements =
      target === 'preview' ? deployment.previewBindings : deployment.staging.bindings
    if (!replacements) throw new Error('Staging migration bindings are missing')
    const preview = planPreviewConfig(production, replacements)
    if (preview.status !== 'ready' && preview.status !== 'no-bindings') {
      throw new Error(`Unsafe ${target} migration target: ${describePreviewPlan(preview)}`)
    }
    config = preview.config ?? production
  }
  const bindings = z.array(bindingSchema).parse(config.d1_databases ?? [])
  const configured = deployment.migrations?.databases ?? []
  const names = new Set(bindings.map((entry) => entry.binding))
  const ids = new Set(bindings.map((entry) => entry.database_id))
  if (names.size !== bindings.length || ids.size !== bindings.length)
    throw new Error('Duplicate D1 bindings or database IDs require one canonical migration owner')
  const appDir = dirname(checkoutPath(root, manifest.worker.wranglerConfig))
  const ownership = deployment.databaseOwnership ?? null
  const contractEntries = ownership ? contractOwnedEntries(ownership) : []
  // One coverage rule, shared with foundation sub-check 12.8 so the gate and
  // the runner can never disagree about who owns a schema.
  const coverage = ownershipCoverageIssues({
    bindings: [...names],
    ownership,
    migrated: configured.map((entry) => entry.binding),
    hasMigrationsBlock: Boolean(deployment.migrations),
  })
  if (coverage.length > 0) {
    throw new Error(
      `deployment.migrations must cover every D1 binding exactly once: ${coverage.join('; ')}`,
    )
  }
  if (ownership) {
    // A contract-owned entry that names a file or a command that does not exist
    // reads in review as proof and would never have run.
    for (const entry of contractEntries) checkoutPathExists(root, entry.contract, 'schema contract')
    const issues = contractEvidenceIssuesOnDisk(
      root,
      packageJsonCandidates(root, appDir),
      ownership,
    )
    if (issues.length > 0) throw new Error(`Contract-owned database declaration: ${issues[0]}`)
  }
  if (
    deployment.migrations &&
    (!deployment.migrations.credential.startsWith('cloudflare/') ||
      deployment.migrations.credential === deployment.promotion.credential)
  ) {
    throw new Error(
      'Migrations require a separate Cloudflare D1-only persona, not the promote persona',
    )
  }
  // A contract-owned database is not a migration target and never reaches the
  // runner: it is absent from the plan AND from the wrangler config the runner
  // is handed, so no binding name in that config can select it.
  const contractBindings = new Set(contractEntries.map((entry) => entry.binding.trim()))
  const migrated = bindings.filter((entry) => !contractBindings.has(entry.binding))
  // Minimal explicit config: no Worker secrets, build redirects, environments,
  // routes or unrelated resources can influence the database selected by D1.
  const migrationConfig = { account_id: accountId, d1_databases: migrated }
  return {
    target,
    accountId,
    repository: manifest.product.repository,
    appDir,
    productionBranch: deployment.productionBranch,
    credential: deployment.migrations?.credential ?? null,
    config: migrationConfig,
    contractOwned: contractEntries.map((entry) => ({
      binding: entry.binding.trim(),
      contract: entry.contract,
      verify: entry.verify,
    })),
    databases: migrated.map((entry) => ({
      binding: entry.binding,
      databaseId: entry.database_id,
      sources: checkoutPath(
        root,
        configured.find((item) => item.binding === entry.binding)!.sources,
      ),
    })),
  }
}

const eventSchema = z.object({
  workflow_run: z.object({
    conclusion: z.literal('success'),
    head_sha: z.string().regex(/^[a-f0-9]{40}$/u),
    head_branch: z.string().min(1),
    head_repository: z.object({ full_name: z.string() }),
  }),
})

/** Environment checks are defense in depth; workflow permissions/checkout are the boundary. */
export function assertMigrationContext(
  plan: DeploymentMigrationPlan,
  sha: string,
  root: string,
  env = process.env,
  bundled = false,
): void {
  if (
    env.GITHUB_ACTIONS !== 'true' ||
    env.GITHUB_EVENT_NAME !== 'workflow_run' ||
    !env.GITHUB_EVENT_PATH
  ) {
    throw new Error(
      'Deployment migration writes require a successful, same-repository workflow_run; use db migrate for explicit operator recovery',
    )
  }
  const { workflow_run: run } = eventSchema.parse(
    JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8')),
  )
  if (
    env.GITHUB_REPOSITORY !== plan.repository ||
    run.head_repository.full_name !== plan.repository ||
    run.head_sha !== sha
  ) {
    throw new Error('Migration source must be the exact CI-verified SHA in this repository')
  }
  if (
    (plan.target === 'production' || plan.target === 'staging') &&
    run.head_branch !== plan.productionBranch
  ) {
    throw new Error('Production/staging migrations require the production branch')
  }
  if (plan.target === 'preview' && run.head_branch !== plan.productionBranch && !bundled) {
    throw new Error(
      'PR preview migrations require a SQL-only bundle and trusted tooling; never execute a PR checkout with D1 credentials',
    )
  }
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  if (!bundled && head !== sha)
    throw new Error('Migration checkout HEAD differs from the verified SHA')
  if (bundled && env.GITHUB_REF !== `refs/heads/${plan.productionBranch}`)
    throw new Error('Preview bundles require a trusted default-branch workflow')
  if (env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_ACCOUNT_ID !== plan.accountId)
    throw new Error('Injected Cloudflare account differs from the migration target')
}

export interface DeploymentMigrationOptions {
  target: MigrationTarget
  check: boolean
  sha?: string
  cwd?: string
  bundle?: string
}

export function parseDeploymentMigrationArgs(args: string[]): DeploymentMigrationOptions {
  let target: MigrationTarget | undefined
  let check = false
  let sha: string | undefined
  let bundle: string | undefined
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--target')
      target = z.enum(['production', 'preview', 'staging']).parse(args[++i])
    else if (args[i] === '--check') check = true
    else if (args[i] === '--sha')
      sha = z
        .string()
        .regex(/^[a-f0-9]{40}$/u)
        .parse(args[++i])
    else if (args[i] === '--bundle') bundle = z.string().min(1).parse(args[++i])
    else throw new Error(`Unknown deployment migration option: ${args[i]}`)
  }
  if (!target) throw new Error('--target production|preview|staging is required')
  if (!check && !sha)
    throw new Error('--sha <verified commit> is required for deployment migration writes')
  if (bundle && (target !== 'preview' || !sha))
    throw new Error('--bundle requires --target preview and --sha')
  return { target, check, ...(sha ? { sha } : {}), ...(bundle ? { bundle } : {}) }
}

export function runDeploymentMigrations(
  options: DeploymentMigrationOptions,
  executor?: MigrationExecutor,
): MigrationPlan[] {
  const root = findMigrationCheckout(options.cwd ?? process.cwd())
  const plan = planDeploymentMigrations(root, options.target)
  if (plan.databases.length === 0) return []
  if (!process.env.CLOUDFLARE_API_TOKEN?.trim())
    throw new Error(
      'An explicit scoped CLOUDFLARE_API_TOKEN is required; ambient Wrangler authentication is not used',
    )
  if (!options.check)
    assertMigrationContext(plan, options.sha ?? '', root, process.env, Boolean(options.bundle))
  const directory = mkdtempSync(join(tmpdir(), 'narduk-d1-target-'))
  const wranglerConfig = join(directory, 'wrangler.json')
  writeFileSync(wranglerConfig, JSON.stringify(plan.config), { mode: 0o600 })
  try {
    const bundle = options.bundle
      ? readMigrationBundle(resolve(options.bundle), plan.repository, options.sha ?? '')
      : undefined
    if (
      bundle &&
      (bundle.databases.length !== plan.databases.length ||
        bundle.databases.some(
          (entry) => !plan.databases.some((db) => db.binding === entry.binding),
        ))
    ) {
      throw new Error('Preview bundle bindings differ from the trusted deployment manifest')
    }
    const bundled = bundle ? materializeMigrationBundle(bundle, directory) : undefined
    const targets: MigrationRunOptions[] = plan.databases.map((database) => ({
      configFile: bundled ? join(directory, bundled.get(database.binding)!) : database.sources,
      database: database.binding,
      location: '--remote',
      // Wrangler is resolved ONLY from the trusted app's installed toolchain,
      // never from the artifact or an untrusted checkout.
      wranglerConfig,
      cwd: plan.appDir,
      strict: true,
      target: { accountId: plan.accountId, databaseId: database.databaseId },
      recoveryDir: join(root, '.narduk', 'recovery', 'd1'),
    }))
    // Discover all configuration/history errors before touching the first DB.
    const before = targets.map((target) => inspectMigrations(target, executor))
    if (options.check) return before
    return targets.map((target) => runMigrations(target, executor))
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

export function writeDeploymentMigrationBundle(path: string, cwd = process.cwd()): void {
  const root = findMigrationCheckout(cwd)
  const plan = planDeploymentMigrations(root, 'production')
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  const bundle = createMigrationBundle(plan.repository, sha, plan.databases)
  writeFileSync(path, `${JSON.stringify(bundle)}\n`, { mode: 0o600 })
}
