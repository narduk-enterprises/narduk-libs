import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import { parse as parseYaml } from 'yaml'
import { z } from 'zod'

import { resolveContainment, type Containment } from './commit-containment.js'
import { resolveAppDir, runDeploy } from './deploy.js'
import { readDeployment } from './deploy-hotfix.js'
import { scanPublicAssetsForSecretLeaks } from './deploy-local.js'
import { healthArgs } from './deployment-config.js'
import {
  assertHotfixSnapshot,
  hotfixBuildEnv,
  hotfixProductionEnv,
  readProductionTarget,
} from './hotfix-plan.js'
import {
  createWranglerCli,
  ROLLBACK_MESSAGE_PREFIX,
  SHIP_MESSAGE_PREFIX,
  soleDeployedVersionId,
  VERSION_MESSAGE_ANNOTATION,
  VERSION_TAG_ANNOTATION,
  type WranglerVersionsClient,
} from './promote.js'
import {
  parseVerifyArgs,
  resolveAccessHeaders,
  runVerifyLive,
  type VerifyFlags,
  type VerifyReport,
} from './verify-live.js'

/**
 * `narduk-app ship`: the one fast path from a committed branch to production.
 *
 * checks + build (concurrently) -> artifact gate -> push -> upload -> promote
 * 100% -> live proof -> automatic rollback on a failure -> auto-merge PR.
 *
 * There is no mode to enter and no custody record. The one rule that keeps two
 * publishers from overwriting each other is git's: HEAD must contain both the
 * production branch and whatever production serves right now. `versions-promote`
 * enforces the mirror image, so a main merge cannot undo a shipped commit.
 */

const envName = z
  .string()
  .regex(/^[A-Z_][A-Z\d_]*$/u)
  .optional()
const flagsSchema = z
  .strictObject({
    dryRun: z.boolean().default(false),
    pr: z.boolean().default(true),
    adopt: z.boolean().default(false),
    baseUrl: z.url({ protocol: /^https$/u }).optional(),
    message: z.string().trim().min(1).max(500).optional(),
    accessClientIdEnv: envName,
    accessClientSecretEnv: envName,
  })
  .refine((flags) => Boolean(flags.accessClientIdEnv) === Boolean(flags.accessClientSecretEnv), {
    message: 'Both Access environment variable names are required together',
  })

export type ShipFlags = z.infer<typeof flagsSchema>

export const SHIP_USAGE = [
  '  ship [-m <commit message>] [--base-url <https origin>] [--no-pr] [--adopt] [--dry-run]',
  '      [--access-client-id-env <name> --access-client-secret-env <name>]',
  '                                       Check, build, publish and prove this branch in',
  '                                       production, roll back on a failed proof, then open',
  '                                       an auto-merge PR. Needs CLOUDFLARE_API_TOKEN.',
]

export function parseShipArgs(args: string[]): ShipFlags {
  const values: Record<string, unknown> = {}
  const valued: Record<string, string> = {
    '-m': 'message',
    '--message': 'message',
    '--base-url': 'baseUrl',
    '--access-client-id-env': 'accessClientIdEnv',
    '--access-client-secret-env': 'accessClientSecretEnv',
  }
  const booleans: Record<string, [string, boolean]> = {
    '--dry-run': ['dryRun', true],
    '--no-pr': ['pr', false],
    '--adopt': ['adopt', true],
  }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    const boolean = booleans[arg]
    const key = boolean?.[0] ?? valued[arg]
    if (!key) throw new Error(`Unknown ship option: ${arg}`)
    if (key in values) throw new Error(`Duplicate ship option: ${arg}`)
    if (boolean) values[key] = boolean[1]
    else {
      const value = args[++index]
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`)
      values[key] = value
    }
  }
  return flagsSchema.parse(values)
}

export type ShipRun = (args: string[], cwd: string, env: NodeJS.ProcessEnv) => Promise<void>
export type ShipGit = (args: string[], options?: { withCredentials?: boolean }) => string

export interface ShipContext {
  cwd?: string
  env?: NodeJS.ProcessEnv
  log?: (message: string) => void
  /** Seams for offline tests. */
  run?: ShipRun
  git?: (repoRoot: string, env: NodeJS.ProcessEnv) => ShipGit
  gh?: (args: string[], cwd: string) => string
  client?: (appDir: string, workerName: string, accountId: string) => WranglerVersionsClient
  upload?: typeof runDeploy
  verify?: (flags: VerifyFlags, env: NodeJS.ProcessEnv) => Promise<VerifyReport>
  containment?: (repoRoot: string, candidate: string, served: string) => Containment
  now?: () => number
}

// GitHub expressions ignore case, so `github.TOKEN` counts too.
const PROMOTE_TOKEN = /^\$\{\{\s*(?:github\.token|secrets\.GITHUB_TOKEN)\s*\}\}$/iu
// The command itself, not a mention of it in a comment or an error string.
const PROMOTE_COMMAND = /\bnarduk-app\s+deploy\s+versions-promote\b/u

type WorkflowNode = Record<string, unknown>

function asNode(value: unknown): WorkflowNode {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as WorkflowNode) : {}
}

function hasPromoteToken(...envs: unknown[]): boolean {
  return envs.some((env) =>
    ['GITHUB_TOKEN', 'GH_TOKEN'].some((name) =>
      PROMOTE_TOKEN.test(String(asNode(env)[name] ?? '').trim()),
    ),
  )
}

function runsPromote(step: WorkflowNode): boolean {
  const run = String(step.run ?? '')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n')
  return PROMOTE_COMMAND.test(run)
}

function canReadPullRequests(permissions: unknown): boolean {
  if (permissions === 'read-all' || permissions === 'write-all') return true
  return /^(?:read|write)$/u.test(String(asNode(permissions)['pull-requests'] ?? ''))
}

/**
 * What the app's promote workflow lacks for main's promote to accept a shipped
 * commit. In a shallow checkout only GitHub can prove the shipped commit landed,
 * and a squash merge needs the commit-to-PR lookup, so every job that runs
 * `versions-promote` (the wait step's `--dry-run` included) needs
 * `pull-requests: read` and every such step needs GITHUB_TOKEN in scope.
 */
export function promoteWorkflowGap(repoRoot: string): string | undefined {
  const path = join(repoRoot, '.github/workflows/promote.yml')
  if (!existsSync(path)) return undefined
  const text = readFileSync(path, 'utf8')
  if (!text.includes('versions-promote')) return undefined
  let workflow: WorkflowNode
  try {
    workflow = asNode(parseYaml(text))
  } catch {
    return '.github/workflows/promote.yml does not parse as YAML; fix it before this app can ship'
  }
  const missing = new Set<string>()
  for (const [jobId, jobValue] of Object.entries(asNode(workflow.jobs))) {
    const job = asNode(jobValue)
    const steps = Array.isArray(job.steps) ? job.steps.map(asNode) : []
    const promoting = steps.filter(runsPromote)
    if (promoting.length === 0) continue
    if (!canReadPullRequests(job.permissions ?? workflow.permissions))
      missing.add(`pull-requests: read on job ${jobId}`)
    for (const step of promoting)
      if (!hasPromoteToken(step.env, job.env, workflow.env))
        missing.add(
          `GITHUB_TOKEN: \${{ github.token }} on step "${String(step.name ?? step.id ?? 'unnamed')}"`,
        )
  }
  return missing.size
    ? `.github/workflows/promote.yml needs ${[...missing].join(' and ')} before this app can ship, or main's promote refuses after every ship`
    : undefined
}

/** Exit codes a wrapper script or agent can act on. */
export const SHIP_EXIT = {
  ok: 0,
  /** Refused before anything uploaded; production unchanged. */
  refused: 1,
  /** Promoted, the live proof failed, and the previous version serves again. */
  rolledBack: 3,
  /** Shipped and proven, but opening the PR failed: do it by hand. */
  prFailed: 4,
  /** Promoted, the proof failed, and the rollback did not take. Production needs a person. */
  rollbackFailed: 5,
} as const

function defaultGit(repoRoot: string, env: NodeJS.ProcessEnv): ShipGit {
  return (args, options) => {
    const result = spawnSync('git', args, {
      cwd: repoRoot,
      // Local reads never see a credential; fetch/push need the user's helpers.
      env: options?.withCredentials ? env : { PATH: env.PATH, HOME: env.HOME },
      encoding: 'utf8',
      timeout: 180_000,
      maxBuffer: 10 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    if (result.error || result.signal || result.status !== 0)
      throw new Error(`git ${args[0]} failed: ${result.stderr?.trim().split('\n')[0] ?? ''}`)
    return result.stdout.trim()
  }
}

function defaultGh(args: string[], cwd: string): string {
  const result = spawnSync('gh', args, {
    cwd,
    encoding: 'utf8',
    timeout: 120_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.error || result.status !== 0)
    throw new Error(`gh ${args.slice(0, 2).join(' ')} failed: ${result.stderr?.trim() ?? ''}`)
  return result.stdout.trim()
}

/** pnpm with each output line prefixed, so concurrent check and build stay readable. */
function defaultRun(log: (message: string) => void): ShipRun {
  return (args, cwd, env) =>
    new Promise((done, fail) => {
      const label = `[ship ${args[args.length - 1]}]`
      const child = spawn('pnpm', args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
      const relay = (chunk: Buffer) => {
        for (const line of chunk.toString('utf8').split('\n')) if (line) log(`${label} ${line}`)
      }
      child.stdout.on('data', relay)
      child.stderr.on('data', relay)
      const timer = setTimeout(() => child.kill('SIGTERM'), 20 * 60 * 1000)
      child.on('error', fail)
      child.on('close', (code, signal) => {
        clearTimeout(timer)
        if (code === 0) done()
        else fail(new Error(`pnpm ${args.join(' ')} failed (${signal ?? `exit ${String(code)}`})`))
      })
    })
}

/** The production origin: `--base-url`, else the manifest's production hostname or first custom domain. */
export function productionOrigin(manifest: unknown, override?: string): string {
  if (override) return new URL(override).origin
  const parsed = z
    .object({
      environments: z
        .array(z.object({ name: z.string(), hostname: z.string().optional() }))
        .nullish(),
      domains: z.object({ customDomains: z.array(z.string()).optional() }).nullish(),
    })
    .safeParse(manifest)
  const host =
    (parsed.success &&
      (parsed.data.environments?.find((row) => row.name === 'production')?.hostname ??
        parsed.data.domains?.customDomains?.[0])) ||
    undefined
  if (!host) throw new Error('Cannot find the production hostname in the manifest; pass --base-url')
  return new URL(`https://${host}`).origin
}

function pickScript(scripts: Record<string, string>, names: string[]): string | null {
  return names.find((name) => scripts[name]?.trim()) ?? null
}

class ShipRefusal extends Error {}

export async function runShip(flags: ShipFlags, context: ShipContext = {}): Promise<number> {
  const env = context.env ?? process.env
  const log = context.log ?? ((message: string) => console.error(message))
  const now = context.now ?? Date.now
  const started = now()
  const elapsed = () => `${((now() - started) / 1000).toFixed(1)}s`
  try {
    return await ship(flags, context, env, log, elapsed)
  } catch (error) {
    if (error instanceof ShipRefusal) {
      log(`[ship] refused: ${error.message} (production unchanged)`)
      return SHIP_EXIT.refused
    }
    throw error
  }
}

async function ship(
  flags: ShipFlags,
  context: ShipContext,
  env: NodeJS.ProcessEnv,
  log: (message: string) => void,
  elapsed: () => string,
): Promise<number> {
  const refuse = (message: string): never => {
    throw new ShipRefusal(message)
  }
  if (
    [env.CI, env.GITHUB_ACTIONS, env.WORKERS_CI].some(
      (value) => value && !['0', 'false'].includes(value.toLowerCase()),
    )
  )
    refuse('ship runs from a workstation; CI promotes through versions-promote')

  const appDir = realpathSync(resolveAppDir(resolve(context.cwd ?? process.cwd())))
  const repoRoot = defaultGit(appDir, env)(['rev-parse', '--show-toplevel'])
  const git = (context.git ?? defaultGit)(repoRoot, env)

  const pkg = z
    .object({ scripts: z.record(z.string(), z.string()).default({}) })
    .parse(JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')))
  const checkScript = pickScript(pkg.scripts, ['ship:check', 'hotfix:check'])
  const buildScript = pickScript(pkg.scripts, ['ship:build', 'hotfix:build'])
  const assertScript = pickScript(pkg.scripts, ['ship:assert'])
  if (!checkScript || !buildScript)
    refuse(
      'Declare repository-root ship:check and ship:build scripts (or hotfix:check/hotfix:build)',
    )

  const target = readProductionTarget(appDir, env)
  const promoteGap = promoteWorkflowGap(repoRoot)
  if (promoteGap) refuse(promoteGap)
  const productionBranch = target.deployment.productionBranch
  const baseUrl = productionOrigin(target.manifest, flags.baseUrl)

  // 1. The branch. A dirty tree ships only as an explicit commit, made once the
  // refusals that need no build have passed.
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'])
  if (branch === 'HEAD' || branch === productionBranch)
    refuse(
      `Ship from a feature branch, not ${branch === 'HEAD' ? 'a detached HEAD' : productionBranch}`,
    )
  const dirty = Boolean(git(['status', '--porcelain', '--untracked-files=all']))
  if (dirty && !flags.message)
    refuse('Uncommitted changes: commit them, or pass -m "<message>" to commit everything')

  // 2. HEAD must contain the production branch, so its PR can merge cleanly.
  git(['fetch', '--quiet', '--no-tags', 'origin', productionBranch], { withCredentials: true })
  const upstream = git(['rev-parse', `origin/${productionBranch}`])
  const contains =
    context.containment ??
    ((root: string, candidate: string, served: string) =>
      resolveContainment(root, candidate, served, { env }))
  if (contains(repoRoot, git(['rev-parse', 'HEAD']), upstream) !== 'contained')
    refuse(
      `HEAD does not contain origin/${productionBranch}; run: git rebase origin/${productionBranch}`,
    )

  if (flags.dryRun) {
    log(
      `[ship] dry run: ${target.workerName} ${branch} -> ${baseUrl}: ${dirty ? 'commit -> ' : ''}${checkScript} + ${buildScript}${assertScript ? ` -> ${assertScript}` : ''} -> push -> upload -> promote 100% -> prove${flags.pr ? ' -> auto-merge PR' : ''}`,
    )
    return SHIP_EXIT.ok
  }
  if (dirty) {
    git(['add', '--all'])
    git(['-c', 'commit.gpgsign=false', 'commit', '--quiet', '--message', flags.message!])
  }
  const sha = git(['rev-parse', 'HEAD'])
  log(`[ship] ${target.workerName} ${branch}@${sha.slice(0, 12)} -> ${baseUrl}`)
  if (!env.CLOUDFLARE_API_TOKEN?.trim())
    refuse('Inject the app deploy credential as CLOUDFLARE_API_TOKEN (nvault run -- pnpm ship)')

  const verifyFlags = parseVerifyArgs([
    '--live',
    baseUrl,
    '--expect-sha',
    sha,
    '--build-version-header',
    target.deployment.liveProof.buildVersionHeader,
    ...healthArgs(target.deployment.liveProof),
    '--smoke-path',
    target.deployment.liveProof.smokePath,
    '--attempts',
    String(target.deployment.liveProof.attempts),
    '--interval-seconds',
    String(target.deployment.liveProof.intervalSeconds),
    ...(flags.accessClientIdEnv
      ? [
          '--access-client-id-env',
          flags.accessClientIdEnv,
          '--access-client-secret-env',
          flags.accessClientSecretEnv!,
        ]
      : []),
  ])
  resolveAccessHeaders(verifyFlags, env)

  const deployEnv: NodeJS.ProcessEnv = {
    PATH: env.PATH,
    HOME: env.HOME,
    CLOUDFLARE_ACCOUNT_ID: target.accountId,
    CLOUDFLARE_API_TOKEN: env.CLOUDFLARE_API_TOKEN,
    NARDUK_ALLOW_LOCAL_WRANGLER_DEPLOY: '1',
    WRANGLER_SEND_METRICS: 'false',
    CI: 'true',
  }
  const client =
    context.client?.(appDir, target.workerName, target.accountId) ??
    createWranglerCli({
      appDir,
      workerName: target.workerName,
      accountId: target.accountId,
      env: deployEnv,
    })

  // 3. HEAD must contain what production serves: the anti-clobber rule.
  const previous = await readDeployment(client)
  const previousVersionId = soleDeployedVersionId(previous)!
  const listing = await client.listVersions(100)
  const served = listing.versions.find((version) => version.id === previousVersionId)
    ?.annotations?.[VERSION_TAG_ANNOTATION]
  if (served !== undefined && !/^[a-f\d]{7,40}$/u.test(served))
    refuse(`Production version ${previousVersionId} carries a commit tag that is not a SHA`)
  if (!served) {
    if (!flags.adopt)
      refuse(
        `Production version ${previousVersionId} carries no commit tag, so HEAD cannot be shown to contain it; pass --adopt once to take it over`,
      )
  } else {
    // --adopt only takes over an untagged version; it never overrides this.
    const containment = contains(repoRoot, sha, served)
    if (containment !== 'contained')
      refuse(
        `Production serves ${served.slice(0, 12)}, which HEAD ${containment === 'unknown' ? 'cannot be shown to contain' : 'does not contain'}; git fetch and rebase onto it (or merge its branch) first`,
      )
    // ship v1 does not migrate: a schema change lands through normal delivery.
    const sources =
      target.deployment.migrations?.databases.map((database) => database.sources) ?? []
    if (sources.length) {
      let changed = ''
      try {
        git(['fetch', '--quiet', '--no-tags', 'origin', served], { withCredentials: true })
        changed = git(['diff', '--name-only', served, sha, '--', ...sources])
      } catch {
        refuse(`Cannot compare migration files against the serving commit ${served.slice(0, 12)}`)
      }
      if (changed)
        refuse(
          'Migration files changed since the serving commit; land them through normal delivery',
        )
    }
  }

  // 4. Checks and build run concurrently: neither writes what the other reads.
  const buildEnv = hotfixBuildEnv(env, { sha, baseUrl })
  const productionBuildEnv = hotfixProductionEnv(env, { sha, baseUrl })
  const run = context.run ?? defaultRun(log)
  log(`[ship] ${checkScript} + ${buildScript} (${elapsed()})`)
  const results = await Promise.allSettled([
    run(['run', checkScript!], repoRoot, buildEnv),
    run(['run', buildScript!], repoRoot, productionBuildEnv),
  ])
  const failed = results.find((result) => result.status === 'rejected')
  if (failed) refuse(String((failed as PromiseRejectedResult).reason))
  const appRelative = relative(repoRoot, appDir)
  try {
    assertHotfixSnapshot({ sha, appRelative }, repoRoot, env)
  } catch (error) {
    refuse((error as Error).message)
  }
  if (assertScript)
    await run(['run', assertScript], repoRoot, {
      ...buildEnv,
      NARDUK_SHIP_ARTIFACT_DIR: join(appDir, '.output'),
    }).catch((error: unknown) => refuse(String(error)))
  const secrets = Object.fromEntries(
    Object.entries(env)
      .filter(([key, value]) => /TOKEN|SECRET|PASSWORD|GH_PACKAGES_READ/u.test(key) && value)
      .map(([key, value]) => [key, value!]),
  )
  if (scanPublicAssetsForSecretLeaks(appDir, secrets).length)
    refuse('Credential value found in public assets; refusing upload')

  // 5. Push first, so the serving commit is on GitHub where a promote guard in
  // a shallow CI checkout can find it. Then upload, and promote only if
  // nothing else changed production meanwhile.
  try {
    git(['push', '--quiet', '--set-upstream', 'origin', `HEAD:refs/heads/${branch}`], {
      withCredentials: true,
    })
  } catch (error) {
    refuse(`Push failed: ${(error as Error).message}`)
  }
  const id = randomUUID().slice(0, 8)
  const message = `${SHIP_MESSAGE_PREFIX} ${branch} ${id}`
  log(`[ship] upload (${elapsed()})`)
  if (
    (context.upload ?? runDeploy)(
      ['versions-upload', '--tag', sha, '--message', message],
      appDir,
      deployEnv,
      {
        keepVars: true,
      },
    ) !== 0
  )
    refuse('Upload failed')
  const uploaded = (await client.listVersions(100)).versions.filter(
    (version) =>
      version.annotations?.[VERSION_TAG_ANNOTATION] === sha &&
      version.annotations?.[VERSION_MESSAGE_ANNOTATION] === message,
  )
  if (uploaded.length !== 1) refuse('Cannot uniquely identify this upload; nothing promoted')
  if ((await readDeployment(client)).id !== previous.id)
    refuse('Production changed during the ship; nothing promoted')
  log(`[ship] promote ${uploaded[0].id} (${elapsed()})`)

  // 6. Prove it, or put the previous version back. From here traffic may have
  // moved, so any failure -- the promote itself included -- rolls back.
  let failure: string | undefined
  try {
    await client.deployVersion(uploaded[0].id, 100, message)
    const proof = await (
      context.verify ?? ((args, proofEnv) => runVerifyLive(args, { env: proofEnv }))
    )(verifyFlags, env)
    if (proof.exitCode !== 0 || proof.result !== 'PASS') {
      const failing = proof.assertions
        .filter((assertion) => assertion.status === 'fail' || assertion.status === 'unknown')
        .map((assertion) => assertion.id)
      failure = `live proof ${proof.result} (${failing.join(', ') || 'no detail'})`
    }
  } catch (error) {
    failure = `promote or proof failed: ${(error as Error).message}`
  }
  if (failure) {
    log(`[ship] ${failure}; rolling back to ${previousVersionId}`)
    try {
      // The rollback prefix keeps a later `deploy rollback` from resolving
      // "previous" to the version that just failed.
      await client.deployVersion(
        previousVersionId,
        100,
        `${ROLLBACK_MESSAGE_PREFIX} (ship ${branch} ${id})`,
      )
      if (soleDeployedVersionId(await readDeployment(client)) !== previousVersionId)
        throw new Error('previous version is not serving after rollback')
    } catch (error) {
      log(
        `[ship] ROLLBACK FAILED: ${(error as Error).message}. Run: narduk-app deploy rollback --to ${previousVersionId}`,
      )
      return SHIP_EXIT.rollbackFailed
    }
    log(`[ship] rolled back; ${previousVersionId} serves again (${elapsed()})`)
    return SHIP_EXIT.rolledBack
  }
  log(`[ship] live: ${sha.slice(0, 12)} serves ${baseUrl} (${elapsed()})`)

  // 7. Land it on the production branch, where versions-promote now waits for it.
  if (!flags.pr) {
    log(`[ship] --no-pr: merge ${branch} into ${productionBranch} soon; promotions wait for it`)
    return SHIP_EXIT.ok
  }
  const gh = context.gh ?? defaultGh
  try {
    let url: string
    try {
      url = gh(['pr', 'view', branch, '--json', 'url', '--jq', '.url'], repoRoot)
    } catch {
      url = gh(['pr', 'create', '--fill', '--base', productionBranch, '--head', branch], repoRoot)
    }
    gh(['pr', 'merge', branch, '--auto', '--squash'], repoRoot)
    log(`[ship] auto-merge armed: ${url} (${elapsed()})`)
  } catch (error) {
    log(
      `[ship] shipped, but the PR step failed: ${(error as Error).message}. Open and merge the ${branch} PR by hand.`,
    )
    return SHIP_EXIT.prFailed
  }
  return SHIP_EXIT.ok
}
