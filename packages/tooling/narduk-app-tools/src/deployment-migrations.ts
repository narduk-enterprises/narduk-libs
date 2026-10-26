import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
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
  parseMigrationConfig,
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
  /** `deployment.promotion.gateCheck`: the only check a push / dispatch write may rely on. */
  gateCheck: string
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
    gateCheck: deployment.promotion.gateCheck,
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
  id?: unknown
  name?: unknown
  status?: unknown
  conclusion?: unknown
  app?: { slug?: unknown } | null
  check_suite?: { id?: unknown } | null
}

interface WorkflowRunLike {
  id?: unknown
  run_number?: unknown
  run_attempt?: unknown
  path?: unknown
  event?: unknown
  head_sha?: unknown
  head_branch?: unknown
  check_suite_id?: unknown
  status?: unknown
  pull_requests?: Array<{ number?: unknown }> | null
  head_repository?: { full_name?: unknown } | null
}

type CheckVerdict = 'green' | 'red' | 'pending' | 'none'

/** GitHub could not answer (no token scope, network, malformed); never a verdict about the check. */
export class GitHubReadError extends Error {}

/** Events of the CI workflow that are evidence about a commit already on the production branch. */
const BRANCH_CI_EVENTS = new Set(['push', 'schedule', 'workflow_dispatch'])
/** The event of the CI workflow that is evidence about a pull request head. */
const PULL_CI_EVENTS = new Set(['pull_request'])

/** What the gate must be: this check, produced by this workflow file, in this repository. */
export interface CiGate {
  /** `deployment.promotion.gateCheck`; `--gate-verified` must name exactly this. */
  check: string
  sha: string
  /** The CI workflow file, e.g. `.github/workflows/ci.yml` (`--gate-workflow`). */
  workflow: string
  repository: string
  productionBranch: string
  /**
   * Repository paths whose content decides what the migration applies
   * (`deploymentMigrationPaths`). When set, the merged-pull-request fallback
   * needs only these identical between the pull request head and the merge
   * commit; when absent, it needs the whole tree identical.
   */
  migrationPaths?: readonly string[]
}

const WORKFLOW_PATH = /^\.github\/workflows\/[\w.-]+\.ya?ml$/u

function listOf(body: unknown, key: string, what: string): unknown[] {
  const record = body as Record<string, unknown> | null
  const list = record?.[key]
  if (!record || !Array.isArray(list)) {
    throw new GitHubReadError(`Could not read ${what} from GitHub; refusing to migrate`)
  }
  if (typeof record.total_count === 'number' && record.total_count > list.length) {
    throw new GitHubReadError(`${what} has more entries than one page; refusing to migrate`)
  }
  return list
}

/**
 * The verdict of the gate check on one commit, read as evidence of CI and
 * nothing weaker. A check run counts only when it belongs to a GitHub Actions
 * check suite that is a run of the declared CI workflow file, in this
 * repository, on one of the allowed events (a push-to-branch run also on the
 * production branch). Neither the check name (an unrelated workflow's job can
 * be called `ci / Required`) nor `started_at` (set by whoever created the run)
 * is trusted. Among the CI workflow's runs on the commit, the highest GitHub
 * `run_number` decides; runs that produced no such check run are not evidence.
 * Check runs of one suite (job re-runs) and runs tied on a number must all
 * agree, so a tie holding any red refuses.
 *
 * The gate check's own status and conclusion decide, not the whole workflow
 * run's: a gate check that finished while other jobs of its run (E2E) are still
 * going is a verdict (operator-portal#3173). A re-run keeps its run_number and
 * its check suite, and `filter=latest` keeps answering with the previous
 * attempt's check run until the re-run creates its own, so while the run is
 * unfinished a finished gate check counts only when it is a job of the run's
 * current attempt.
 */
function ciVerdict(
  get: GitHubGet,
  gate: CiGate,
  commit: string,
  events: ReadonlySet<string>,
  branch: string | null,
  pullNumber: number | null = null,
): CheckVerdict {
  const checkRuns = listOf(
    get(
      `commits/${commit}/check-runs?check_name=${encodeURIComponent(gate.check)}&filter=latest&per_page=100`,
    ),
    'check_runs',
    `${gate.check} on ${commit}`,
  ) as CheckRunLike[]
  const bySuite = new Map<number, CheckRunLike[]>()
  for (const run of checkRuns) {
    const suite = run.check_suite?.id
    if (run.name !== gate.check || run.app?.slug !== 'github-actions' || typeof suite !== 'number')
      continue
    bySuite.set(suite, [...(bySuite.get(suite) ?? []), run])
  }
  const workflowRuns = listOf(
    get(`actions/runs?head_sha=${commit}&per_page=100`),
    'workflow_runs',
    `the workflow runs of ${commit}`,
  ) as WorkflowRunLike[]
  const evidence = workflowRuns.flatMap((run) => {
    const checks =
      typeof run.check_suite_id === 'number' ? bySuite.get(run.check_suite_id) : undefined
    const trustedPath =
      run.path === gate.workflow ||
      run.path === `${gate.workflow}@refs/heads/${gate.productionBranch}`
    if (
      !trustedPath ||
      typeof run.run_number !== 'number' ||
      run.head_sha !== commit ||
      run.head_repository?.full_name !== gate.repository ||
      typeof run.event !== 'string' ||
      !events.has(run.event) ||
      (branch !== null && run.head_branch !== branch) ||
      // Pull-request evidence belongs to the pull request that merged: the
      // same head can sit in pull requests onto other bases, whose runs test
      // other merge results.
      (pullNumber !== null &&
        !(
          Array.isArray(run.pull_requests) &&
          run.pull_requests.some((pull) => pull?.number === pullNumber)
        ))
    ) {
      return []
    }
    // The newest CI run decides even before it has produced the gate check run:
    // unfinished is "wait", and finished without the gate check is a run that
    // did not prove the gate (never a licence to fall back to an older one).
    if (!checks) {
      return [
        { number: run.run_number, verdicts: [run.status === 'completed' ? 'red' : 'pending'] },
      ]
    }
    const done = checks.filter((check) => check.status === 'completed')
    const stale = run.status !== 'completed' && done.length > 0 && !currentAttempt(get, run, done)
    return [
      {
        number: run.run_number,
        verdicts: checks.map((check) =>
          check.status !== 'completed' || stale
            ? 'pending'
            : check.conclusion === 'success'
              ? 'green'
              : 'red',
        ),
      },
    ]
  })
  if (evidence.length === 0) return 'none'
  const newest = Math.max(...evidence.map((entry) => entry.number))
  const verdicts = evidence
    .filter((entry) => entry.number === newest)
    .flatMap((entry) => entry.verdicts)
  if (verdicts.includes('red')) return 'red'
  return verdicts.includes('pending') ? 'pending' : 'green'
}

/**
 * Whether every one of `checks` is a job of the unfinished `run`'s current
 * attempt (a job's id is its check run's id). A check run left from an earlier
 * attempt is a re-run in flight, which is still running, never a verdict.
 */
function currentAttempt(get: GitHubGet, run: WorkflowRunLike, checks: CheckRunLike[]): boolean {
  if (typeof run.id !== 'number' || typeof run.run_attempt !== 'number') {
    throw new GitHubReadError(
      'Could not read the attempt of a CI run from GitHub; refusing to migrate',
    )
  }
  const jobs = listOf(
    get(`actions/runs/${String(run.id)}/attempts/${String(run.run_attempt)}/jobs?per_page=100`),
    'jobs',
    `the jobs of run ${String(run.id)} attempt ${String(run.run_attempt)}`,
  ) as Array<{ id?: unknown }>
  const ids = new Set(jobs.map((job) => job.id))
  return checks.every((check) => typeof check.id === 'number' && ids.has(check.id))
}

function treeOf(get: GitHubGet, commit: string): string {
  const tree = (get(`git/commits/${commit}`) as { tree?: { sha?: unknown } } | null)?.tree?.sha
  if (typeof tree !== 'string' || !FULL_SHA.test(tree)) {
    throw new GitHubReadError(
      `Could not read the tree of ${commit} from GitHub; refusing to migrate`,
    )
  }
  return tree
}

const TREE_MODE = '040000'
const SYMLINK_MODE = '120000'

/**
 * The mode and object id at `path` in the tree `root`, or null when nothing is
 * there, read one path segment at a time. A symlink on the way is `symlink`:
 * its own blob says nothing about what it points at.
 */
function objectAt(
  get: GitHubGet,
  root: string,
  path: string,
  cache: Map<string, unknown[]>,
): string | null {
  let mode = TREE_MODE
  let sha = root
  for (const segment of path.split('/')) {
    if (mode === SYMLINK_MODE) return 'symlink'
    if (mode !== TREE_MODE) return null
    let entries = cache.get(sha)
    if (!entries) {
      const body = get(`git/trees/${sha}`) as { tree?: unknown; truncated?: unknown } | null
      if (!body || !Array.isArray(body.tree) || body.truncated !== false) {
        throw new GitHubReadError(`Could not read tree ${sha} from GitHub; refusing to migrate`)
      }
      entries = body.tree as unknown[]
      cache.set(sha, entries)
    }
    const entry = (entries as Array<{ path?: unknown; mode?: unknown; sha?: unknown }>).find(
      (item) => item.path === segment,
    )
    if (!entry) return null
    if (
      typeof entry.mode !== 'string' ||
      typeof entry.sha !== 'string' ||
      !FULL_SHA.test(entry.sha)
    )
      throw new GitHubReadError(`Could not read tree ${sha} from GitHub; refusing to migrate`)
    mode = entry.mode
    sha = entry.sha
  }
  return mode === SYMLINK_MODE ? 'symlink' : `${mode} ${sha}`
}

/** Whether every one of `paths` holds the same object at both commits (both absent counts). */
function sameAt(get: GitHubGet, head: string, merged: string, paths: readonly string[]): boolean {
  const cache = new Map<string, unknown[]>()
  return paths.every((path) => {
    const before = objectAt(get, head, path, cache)
    return before !== 'symlink' && before === objectAt(get, merged, path, cache)
  })
}

const LOCKFILES = [
  'pnpm-lock.yaml',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
]

/**
 * The repository paths whose content decides which migration files a
 * deployment applies: each database's sources file, each source directory in
 * the repository, and, for a source installed from a package, the lockfiles
 * that pin that package's version. Null when a source cannot be pinned by
 * repository content (outside the checkout, or a package that is not
 * installed), which leaves the gate needing the whole tree identical.
 */
export function deploymentMigrationPaths(
  plan: DeploymentMigrationPlan,
  root: string,
): string[] | null {
  const top = realpathSync(
    execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8' }).trim(),
  )
  const repoPath = (path: string): string | null => {
    const rel = relative(top, path)
    return rel === '' || rel.startsWith('..') || isAbsolute(rel) ? null : rel.split(sep).join('/')
  }
  const paths = new Set<string>()
  for (const database of plan.databases) {
    const sources = repoPath(database.sources)
    if (sources === null) return null
    paths.add(sources)
    const config = parseMigrationConfig(JSON.parse(readFileSync(database.sources, 'utf8')))
    for (const source of config.sources) {
      const directory = resolve(dirname(database.sources), source.path)
      const rel = repoPath(directory)
      if (rel === null) return null
      const segments = rel.split('/')
      const modules = segments.indexOf('node_modules')
      if (modules === -1) {
        paths.add(rel)
        continue
      }
      if (!existsSync(directory)) return null
      // A workspace package linked into node_modules is repository content.
      const linked = repoPath(realpathSync(directory))
      if (linked !== null && !linked.split('/').includes('node_modules')) {
        paths.add(linked)
        continue
      }
      const locks: string[] = []
      for (let dir = join(top, ...segments.slice(0, modules)); ; dir = dirname(dir)) {
        for (const name of LOCKFILES) {
          const lock = repoPath(join(dir, name))
          if (lock !== null && existsSync(join(dir, name))) locks.push(lock)
        }
        if (dir === top || dirname(dir) === dir) break
      }
      if (locks.length === 0) return null
      for (const lock of locks) paths.add(lock)
    }
  }
  return [...paths].sort()
}

/**
 * Proof that the gate is green for the commit being migrated, read from GitHub
 * by this tool (never taken from the caller's word).
 *
 * 1. The CI workflow's newest run on the commit itself (events push, schedule,
 *    workflow_dispatch, on the production branch). A red or still-running
 *    newest run refuses outright and no pull request can overrule it.
 * 2. Only when the commit has no such run: a merged pull request whose merge
 *    commit IS this commit, into the production branch, from a head in this
 *    same repository, with the CI workflow's newest pull_request run green on
 *    that head AND the head's tree identical to the commit's tree, or, when
 *    the gate names `migrationPaths`, those paths identical. A squash merge's
 *    own commit carries no pull-request run, and some apps run CI only on pull
 *    requests; the comparison makes the head's run a run of exactly the
 *    migrations being applied, so a pull request merged behind the production
 *    branch still counts unless the branch moved the migrations under it.
 */
export function assertCiGateGreen(get: GitHubGet, gate: CiGate): string {
  const direct = ciVerdict(get, gate, gate.sha, BRANCH_CI_EVENTS, gate.productionBranch)
  if (direct === 'green') return `${gate.check} succeeded on ${gate.sha}`
  if (direct === 'red' || direct === 'pending') {
    throw new Error(
      `${gate.check} ${direct === 'red' ? 'did not succeed' : 'is still running'} on ${gate.sha}; refusing to migrate`,
    )
  }
  const pulls = get(`commits/${gate.sha}/pulls?per_page=30`)
  if (!Array.isArray(pulls)) {
    throw new GitHubReadError(
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
    const pullNumber = pull.number
    if (
      typeof pullNumber !== 'number' ||
      !pull.merged_at ||
      pull.merge_commit_sha !== gate.sha ||
      pull.base?.ref !== gate.productionBranch ||
      pull.head?.repo?.full_name !== gate.repository ||
      typeof headSha !== 'string' ||
      !FULL_SHA.test(headSha)
    ) {
      continue
    }
    if (ciVerdict(get, gate, headSha, PULL_CI_EVENTS, null, pullNumber) !== 'green') continue
    const landed = `${gate.check} succeeded on #${String(pull.number)} head ${headSha}, merged as ${gate.sha}`
    const headTree = treeOf(get, headSha)
    const mergedTree = treeOf(get, gate.sha)
    if (headTree === mergedTree) return `${landed} with an identical tree`
    if (gate.migrationPaths && sameAt(get, headTree, mergedTree, gate.migrationPaths))
      return `${landed} with identical migrations (${gate.migrationPaths.join(', ')})`
  }
  throw new Error(
    `${gate.check} is not green on ${gate.sha} or on a merged pull request that landed as it with ${gate.migrationPaths ? 'identical migrations' : 'an identical tree'}; refusing to migrate`,
  )
}

export interface MigrationContextProof {
  /** `--gate-verified "<check>@<sha>"`: which check must be green on which commit. */
  gate?: GateAttestation | null
  /** `--gate-workflow`: the CI workflow file whose run counts as the gate. */
  gateWorkflow?: string | null
  /** GitHub reader; defaults to the tool's curl reader over GITHUB_TOKEN. */
  get?: GitHubGet
  /**
   * `observe` (for `--check-context`) still refuses an unreadable GitHub but
   * reports, instead of refusing, a check that is read and simply not green.
   * Writes always `enforce`.
   */
  gateMode?: 'enforce' | 'observe'
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
        `A ${event} migration needs --gate-verified "${plan.gateCheck}@${sha}" so the tool can prove that check green on the commit`,
      )
    }
    if (gate.sha !== sha) {
      throw new Error(`--gate-verified names ${gate.sha}, not the migrated commit ${sha}`)
    }
    if (gate.check !== plan.gateCheck) {
      throw new Error(
        `--gate-verified names "${gate.check}", but deployment.promotion.gateCheck is "${plan.gateCheck}"; only the declared gate can authorize a migration`,
      )
    }
    if (!proof.gateWorkflow || !WORKFLOW_PATH.test(proof.gateWorkflow)) {
      throw new Error(
        `A ${event} migration needs --gate-workflow .github/workflows/<file>.yml, the CI workflow whose run is the gate`,
      )
    }
    if (env.GH_REPO && env.GH_REPO !== plan.repository) {
      throw new Error(
        `GH_REPO (${env.GH_REPO}) differs from the migration repository ${plan.repository}; refusing to read another repository's checks`,
      )
    }
    if (!(env.GH_TOKEN || env.GITHUB_TOKEN)) {
      throw new Error(
        `A ${event} migration reads ${gate.check} from GitHub and needs GITHUB_TOKEN (actions: read, checks: read, pull-requests: read)`,
      )
    }
    // The reader is built on the repository the manifest names, whatever the
    // environment says.
    const get =
      proof.get ??
      githubGet(root, { ...env, GH_REPO: plan.repository, GITHUB_REPOSITORY: plan.repository })
    const ci: CiGate = {
      check: gate.check,
      sha,
      workflow: proof.gateWorkflow,
      repository: plan.repository,
      productionBranch: plan.productionBranch,
      ...(() => {
        const paths = deploymentMigrationPaths(plan, root)
        return paths ? { migrationPaths: paths } : {}
      })(),
    }
    try {
      verified = assertCiGateGreen(get, ci)
    } catch (error) {
      if (proof.gateMode !== 'observe' || error instanceof GitHubReadError) throw error
      verified = `context accepted; a write would be refused now: ${(error as Error).message}`
    }
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
  /** `--gate-workflow <.github/workflows/file.yml>`: the CI workflow whose run is the gate. */
  gateWorkflow?: string
  /** `--check-context`: run only the context proof a write would run, and write nothing. */
  checkContext?: boolean
}

export function parseDeploymentMigrationArgs(args: string[]): DeploymentMigrationOptions {
  let target: MigrationTarget | undefined
  let check = false
  let sha: string | undefined
  let bundle: string | undefined
  let gate: GateAttestation | undefined
  let gateWorkflow: string | undefined
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
    else if (args[i] === '--gate-workflow')
      gateWorkflow = z.string().regex(WORKFLOW_PATH).parse(args[++i])
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
    ...(gateWorkflow ? { gateWorkflow } : {}),
    ...(checkContext ? { checkContext } : {}),
  }
}

/**
 * Runs only the context proof a write would run (event, ref, SHA, checkout, and
 * the gate check read from GitHub) and writes nothing. A check that GitHub
 * answers for but that is not green is reported, not thrown, because on a run
 * with nothing pending that is an ordinary state; a GitHub that cannot be read
 * still throws, because that is a broken apply path. It needs no Cloudflare
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
      gateWorkflow: options.gateWorkflow ?? null,
      gateMode: 'observe',
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
      gateWorkflow: options.gateWorkflow ?? null,
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
