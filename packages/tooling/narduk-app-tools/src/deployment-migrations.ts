import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { z } from 'zod'

import { readAppConfigText } from './app-config/resolve.js'
import { githubGet, type GitHubGet } from './commit-containment.js'
import {
  contractEvidenceIssuesOnDisk,
  contractOwnedEntries,
  findAppManifestRoot,
  ownershipCoverageIssues,
} from './database-ownership.js'
import { readJsonc } from './deploy.js'
import { readDeploymentBlock } from './deployment-config.js'
import { describePreviewPlan, planPreviewConfig } from './preview-config.js'
import { parseGateAttestation, type GateAttestation } from './promote.js'
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
    JSON.parse(readAppConfigText({ root, file: 'cloudflare-app.json', required: true })!),
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

const WORKFLOW_RUN_REFUSAL =
  'Deployment migration writes require a successful, same-repository workflow_run, or a push / workflow_dispatch on the production branch with --gate-verified "<check>@<sha>" and a green check on that exact commit; use db migrate for explicit operator recovery'

/** The events whose own ref and SHA the tool can check without a `workflow_run` payload. */
const BRANCH_EVENTS = new Set(['push', 'workflow_dispatch'])
const FULL_SHA = /^[a-f0-9]{40}$/u

interface CheckRunLike {
  name?: unknown
  status?: unknown
  conclusion?: unknown
  started_at?: unknown
  app?: { slug?: unknown } | null
}

type CheckVerdict = 'green' | 'red' | 'pending' | 'none'

/**
 * The newest run of the named check on one commit. Only a run created by
 * GitHub Actions counts: another GitHub App with `checks: write` could
 * otherwise post a green check of the same name. A body GitHub did not
 * answer, or that is truncated by pagination, is an error, never a verdict.
 */
function checkVerdict(get: GitHubGet, check: string, commit: string): CheckVerdict {
  const body = get(
    `commits/${commit}/check-runs?check_name=${encodeURIComponent(check)}&per_page=100`,
  ) as { total_count?: unknown; check_runs?: unknown } | null
  if (!body || !Array.isArray(body.check_runs)) {
    throw new Error(
      `Could not read ${check} on ${commit} from GitHub (is GITHUB_TOKEN set with checks: read?); refusing to migrate`,
    )
  }
  if (typeof body.total_count === 'number' && body.total_count > body.check_runs.length) {
    throw new Error(`${check} on ${commit} has more runs than one page; refusing to migrate`)
  }
  const runs = (body.check_runs as CheckRunLike[]).filter(
    (run) => run.name === check && run.app?.slug === 'github-actions',
  )
  if (runs.length === 0) return 'none'
  const started = (run: CheckRunLike) => Date.parse(String(run.started_at ?? '')) || 0
  const latest = runs.reduce((a, b) => (started(b) > started(a) ? b : a))
  if (latest.status !== 'completed') return 'pending'
  return latest.conclusion === 'success' ? 'green' : 'red'
}

/**
 * Proof that the gate check is green for the commit being migrated, read from
 * GitHub by this tool (never taken from the caller's word).
 *
 * 1. The check on the commit itself. The newest run decides, so a green rerun
 *    replaces an earlier red one; a red newest run refuses outright and no pull
 *    request can overrule it.
 * 2. Otherwise (no run, or one still running) a merged pull request whose merge
 *    commit IS this commit, into the production branch, from a head in this
 *    same repository, with the check green on that head. A squash merge's own
 *    commit carries no pull-request run, and some apps run CI only on pull
 *    requests, so this is the evidence that exists for them.
 */
export function assertCiGateGreen(
  get: GitHubGet,
  gate: GateAttestation,
  repository: string,
  productionBranch: string,
): string {
  const direct = checkVerdict(get, gate.check, gate.sha)
  if (direct === 'green') return `${gate.check} succeeded on ${gate.sha}`
  if (direct === 'red') {
    throw new Error(`${gate.check} did not succeed on ${gate.sha}; refusing to migrate`)
  }
  const pulls = get(`commits/${gate.sha}/pulls?per_page=30`)
  if (!Array.isArray(pulls)) {
    throw new Error(
      `Could not list the pull requests of ${gate.sha} from GitHub; refusing to migrate`,
    )
  }
  for (const pull of pulls as Array<{
    number?: unknown
    merged_at?: unknown
    merge_commit_sha?: unknown
    base?: { ref?: unknown } | null
    head?: { sha?: unknown; repo?: { full_name?: unknown } | null } | null
  }>) {
    const headSha = pull.head?.sha
    if (
      !pull.merged_at ||
      pull.merge_commit_sha !== gate.sha ||
      pull.base?.ref !== productionBranch ||
      pull.head?.repo?.full_name !== repository ||
      typeof headSha !== 'string' ||
      !FULL_SHA.test(headSha)
    ) {
      continue
    }
    if (checkVerdict(get, gate.check, headSha) === 'green') {
      return `${gate.check} succeeded on #${String(pull.number)} head ${headSha}, merged as ${gate.sha}`
    }
  }
  throw new Error(
    `${gate.check} is not green on ${gate.sha} or on a merged pull request that landed as it; refusing to migrate`,
  )
}

export interface MigrationContextProof {
  /** `--gate-verified "<check>@<sha>"`: which check must be green on which commit. */
  gate?: GateAttestation | null
  /** GitHub reader; defaults to the tool's curl reader over GITHUB_TOKEN. */
  get?: GitHubGet
}

/**
 * Environment checks are defense in depth; workflow permissions/checkout are the
 * boundary. Two contexts may write to production or staging:
 *
 * - a successful same-repository `workflow_run` for the exact SHA (the original
 *   path, unchanged), or
 * - a `push` or `workflow_dispatch` on the production branch whose own
 *   `GITHUB_SHA` is the SHA being migrated, with the gate check proven green on
 *   that commit by `assertCiGateGreen`. A `push` carries no CI verdict of its
 *   own, so the tool reads it; a workflow's say-so is not enough.
 *
 * Preview databases keep the `workflow_run` / SQL-bundle rules only.
 */
export function assertMigrationContext(
  plan: DeploymentMigrationPlan,
  sha: string,
  root: string,
  env = process.env,
  bundled = false,
  proof: MigrationContextProof = {},
): string {
  const event = env.GITHUB_EVENT_NAME ?? ''
  if (env.GITHUB_ACTIONS !== 'true') throw new Error(WORKFLOW_RUN_REFUSAL)
  let verified: string
  if (event === 'workflow_run') {
    if (!env.GITHUB_EVENT_PATH) throw new Error(WORKFLOW_RUN_REFUSAL)
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
    verified = `workflow_run of ${sha} succeeded`
  } else if (BRANCH_EVENTS.has(event)) {
    if (plan.target === 'preview' || bundled) {
      throw new Error(
        `A ${event} event cannot migrate preview databases; they follow a successful workflow_run and a SQL-only bundle`,
      )
    }
    if (env.GITHUB_REPOSITORY !== plan.repository) {
      throw new Error('Migration source must be the exact CI-verified SHA in this repository')
    }
    if (env.GITHUB_REF !== `refs/heads/${plan.productionBranch}`) {
      throw new Error('Production/staging migrations require the production branch')
    }
    if (!FULL_SHA.test(sha) || env.GITHUB_SHA !== sha) {
      throw new Error(`A ${event} migrates only the commit it runs on (GITHUB_SHA)`)
    }
    const gate = proof.gate
    if (!gate) {
      throw new Error(
        `A ${event} migration needs --gate-verified "<check>@${sha}" so the tool can prove that check green on the commit`,
      )
    }
    if (gate.sha !== sha) {
      throw new Error(`--gate-verified names ${gate.sha}, not the migrated commit ${sha}`)
    }
    if (!(env.GH_TOKEN || env.GITHUB_TOKEN)) {
      throw new Error(
        `A ${event} migration reads ${gate.check} from GitHub and needs GITHUB_TOKEN (checks: read, pull-requests: read)`,
      )
    }
    verified = assertCiGateGreen(
      proof.get ?? githubGet(root, env),
      gate,
      plan.repository,
      plan.productionBranch,
    )
  } else {
    throw new Error(WORKFLOW_RUN_REFUSAL)
  }
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  if (!bundled && head !== sha)
    throw new Error('Migration checkout HEAD differs from the verified SHA')
  if (bundled && env.GITHUB_REF !== `refs/heads/${plan.productionBranch}`)
    throw new Error('Preview bundles require a trusted default-branch workflow')
  if (env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_ACCOUNT_ID !== plan.accountId)
    throw new Error('Injected Cloudflare account differs from the migration target')
  return verified
}

export interface DeploymentMigrationOptions {
  target: MigrationTarget
  check: boolean
  sha?: string
  cwd?: string
  bundle?: string
  /** `--gate-verified "<check>@<sha>"`: the check to prove green on `sha` for a push / dispatch. */
  gate?: GateAttestation
  /** `--check-context`: run only the context proof a write would run, and write nothing. */
  checkContext?: boolean
}

export function parseDeploymentMigrationArgs(args: string[]): DeploymentMigrationOptions {
  let target: MigrationTarget | undefined
  let check = false
  let sha: string | undefined
  let bundle: string | undefined
  let gate: GateAttestation | undefined
  let checkContext = false
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--target')
      target = z.enum(['production', 'preview', 'staging']).parse(args[++i])
    else if (args[i] === '--check') check = true
    else if (args[i] === '--sha')
      sha = z
        .string()
        .regex(/^[a-f0-9]{40}$/u)
        .parse(args[++i])
    else if (args[i] === '--gate-verified') gate = parseGateAttestation(args[++i] ?? '')
    else if (args[i] === '--check-context') checkContext = true
    else if (args[i] === '--bundle') bundle = z.string().min(1).parse(args[++i])
    else throw new Error(`Unknown deployment migration option: ${args[i]}`)
  }
  if (!target) throw new Error('--target production|preview|staging is required')
  if (!check && !sha && !checkContext)
    throw new Error('--sha <verified commit> is required for deployment migration writes')
  if (checkContext && (check || !sha))
    throw new Error('--check-context takes --sha <commit> and is exclusive with --check')
  if (gate && gate.sha !== sha) throw new Error('--gate-verified must name the --sha commit')
  if (bundle && (target !== 'preview' || !sha))
    throw new Error('--bundle requires --target preview and --sha')
  return {
    target,
    check,
    ...(sha ? { sha } : {}),
    ...(bundle ? { bundle } : {}),
    ...(gate ? { gate } : {}),
    ...(checkContext ? { checkContext } : {}),
  }
}

/**
 * Runs only the context proof a write would run (event, ref, SHA, checkout, and
 * the gate check read from GitHub) and writes nothing. It needs no Cloudflare
 * credential, so a promote workflow can run it on a run with nothing pending
 * and find a broken apply path before a migration needs it.
 */
export function checkDeploymentMigrationContext(
  options: DeploymentMigrationOptions,
  proof: Pick<MigrationContextProof, 'get'> = {},
): string {
  const root = findMigrationCheckout(options.cwd ?? process.cwd())
  const plan = planDeploymentMigrations(root, options.target)
  return assertMigrationContext(
    plan,
    options.sha ?? '',
    root,
    process.env,
    Boolean(options.bundle),
    {
      gate: options.gate ?? null,
      ...proof,
    },
  )
}

export function runDeploymentMigrations(
  options: DeploymentMigrationOptions,
  executor?: MigrationExecutor,
  proof: Pick<MigrationContextProof, 'get'> = {},
): MigrationPlan[] {
  const root = findMigrationCheckout(options.cwd ?? process.cwd())
  const plan = planDeploymentMigrations(root, options.target)
  if (plan.databases.length === 0) return []
  if (!process.env.CLOUDFLARE_API_TOKEN?.trim())
    throw new Error(
      'An explicit scoped CLOUDFLARE_API_TOKEN is required; ambient Wrangler authentication is not used',
    )
  if (!options.check)
    assertMigrationContext(plan, options.sha ?? '', root, process.env, Boolean(options.bundle), {
      gate: options.gate ?? null,
      ...proof,
    })
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
