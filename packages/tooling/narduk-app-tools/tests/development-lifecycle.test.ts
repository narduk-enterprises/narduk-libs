import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { defaultDeploymentBlock } from '../src/deployment-config.js'
import { DEVELOPMENT_USAGE } from '../src/development-cli.js'
import { developmentSchema, type DevelopmentCommand } from '../src/development-config.js'
import {
  parseDevelopmentDeployArgs,
  runDevelopmentDeploy,
  type DevelopmentContext,
  type DevelopmentDeployFlags,
} from '../src/development-deploy.js'
import { globToRegExp, matchProtectedPaths } from '../src/development-guards.js'
import { developmentFixture } from './development-fixture.js'
import {
  parseDeclaredScriptTriggers,
  readDeclaredScriptTriggers,
  routePattern,
  type DeclaredWorkerRoute,
} from '../src/development-script-triggers.js'
import { DevelopmentGitHub } from '../src/development-github.js'
import {
  formatStatus,
  runDevelopmentAccept,
  runDevelopmentEnter,
  runDevelopmentExec,
  runDevelopmentExitComplete,
  runDevelopmentExitPrepare,
  runDevelopmentHandoff,
  runDevelopmentPin,
  runDevelopmentResolve,
  runDevelopmentRollback,
  runDevelopmentStatus,
  runDevelopmentUnpin,
  runDevelopmentValidate,
  type LifecycleContext,
} from '../src/development-lifecycle.js'
import { DevelopmentCloudflare } from '../src/development-provider.js'
import { readActivation, writeActivation } from '../src/development-records.js'
import { acquireTargetLocks, readPrivateJson, writePrivateJson } from '../src/development-state.js'
import {
  drainDeployedValidations,
  enqueueDeployedValidation,
  readValidationHistory,
  validationDirectory,
  type DeployedValidationRequest,
} from '../src/development-validation.js'
import type { VerifyReport } from '../src/verify-live.js'

const ACCOUNT = 'a'.repeat(32)
const REPO = 'narduk-enterprises/fixture-app'
const SECRET = 'fixture-secret-value-that-is-long-enough-000'
const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function temp(prefix: string): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  roots.push(root)
  return root
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

/** origin/main as last fetched an hour ago: its only reflog entry is dated then. */
function fetchedAnHourAgo(cwd: string, revision = 'HEAD'): void {
  git(cwd, 'update-ref', '-d', 'refs/remotes/origin/main')
  execFileSync('git', ['update-ref', 'refs/remotes/origin/main', revision], {
    cwd,
    env: { ...process.env, GIT_COMMITTER_DATE: `@${Math.floor(Date.now() / 1000) - 3600} +0000` },
  })
}

function patchAutomation(
  root: string,
  mutate: (automation: Record<string, unknown>) => void,
): void {
  const path = join(root, 'Config', 'cloudflare-app.json')
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as {
    deployment: { development: { automation: Record<string, unknown> } }
  }
  mutate(manifest.deployment.development.automation)
  writeFileSync(path, JSON.stringify(manifest))
}

const cmd = (executable: string): DevelopmentCommand => ({
  executable,
  args: [],
  cwd: '.',
  timeoutSeconds: 60,
})
const selector = (key: string) => ({ project: 'fixture', environment: 'prd', config: 'app', key })

function component(worker: string, appDir: string) {
  return {
    appDir,
    wranglerConfig: `${appDir}/wrangler.jsonc`,
    accountId: ACCOUNT,
    workerName: worker,
    origins: [`https://${worker}.example.com`],
    bindings: [],
    build: cmd('fake-build'),
    assertArtifact: cmd('fake-assert'),
    behavior: { kind: 'command', command: cmd('fake-behavior') },
    artifactDirectory: `${appDir}/.output`,
    buildVariables: { IMPORT_ENVIRONMENT: 'prd' },
    buildSecrets: { NUXT_SESSION_PASSWORD: selector('NUXT_SESSION_PASSWORD') },
    requiredRuntimeSecrets: ['APP_SECRET'],
    schemaChecks: [
      {
        command: cmd('fake-schema'),
        readOnlyCredentials: { D1_READ_TOKEN: selector('D1_READ_TOKEN') },
        credentialOperation: 'd1-read',
      },
    ],
    deploymentCredential: selector('DEPLOY'),
    buildsCredential: selector('BUILDS'),
    buildVariableSources: { PROTECTED: selector('PROTECTED') },
  }
}

function repository(paired = false) {
  const root = temp('dev-app-')
  const apps = paired ? ['apps/web', 'apps/api'] : ['apps/web']
  for (const [index, app] of apps.entries()) {
    mkdirSync(join(root, app, 'src'), { recursive: true })
    writeFileSync(
      join(root, app, 'wrangler.jsonc'),
      JSON.stringify({ name: index ? 'fixture-api' : 'fixture-app', account_id: ACCOUNT }),
    )
    writeFileSync(join(root, app, 'src', 'page.ts'), 'export const page = 1\n')
    // create-narduk-app's component shape: deploy:dev is the enrolled command.
    writeFileSync(
      join(root, app, 'package.json'),
      JSON.stringify({
        name: index ? 'api' : 'web',
        scripts: { 'deploy:dev': 'narduk-app development deploy' },
      }),
    )
  }
  mkdirSync(join(root, 'Config'))
  mkdirSync(join(root, 'migrations'))
  writeFileSync(join(root, 'migrations', '0001_init.sql'), 'create table t (id integer);\n')
  // create-narduk-app's root shape: deploy:dev only forwards to the web component.
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({
      packageManager: 'pnpm@10.33.4',
      scripts: { 'deploy:dev': 'pnpm --filter web run deploy:dev' },
    }),
  )
  writeFileSync(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
  writeFileSync(join(root, '.gitignore'), 'node_modules/\n.output/\n.env\n')
  writeFileSync(join(root, 'obsolete.txt'), 'remove me\n')
  const components = paired
    ? { web: component('fixture-app', 'apps/web'), api: component('fixture-api', 'apps/api') }
    : { web: component('fixture-app', 'apps/web') }
  writeFileSync(
    join(root, 'Config', 'cloudflare-app.json'),
    JSON.stringify({
      worker: { name: 'fixture-app' },
      deployment: {
        ...defaultDeploymentBlock({ appSlug: 'fixture-app' }),
        development: {
          defaultTargetSet: 'primary',
          components,
          targetSets: {
            primary: { components: Object.keys(components), checks: [cmd('fake-check')] },
          },
          install: cmd('fake-install'),
          installSecrets: {
            GH_PACKAGES_READ: {
              project: 'github',
              environment: 'prd',
              config: 'packages-read',
              key: 'GH_PACKAGES_READ',
            },
          },
          migrationDirectories: ['migrations'],
          automation: {
            workflows: ['.github/workflows/ci.yml', '.github/workflows/promote.yml'],
            writeWorkflows: ['.github/workflows/promote.yml'],
            manualValidationWorkflow: '.github/workflows/validate.yml',
            independentWorkflows: ['.github/workflows/refresh.yml'],
            inventoryReference: 'fixture writer inventory',
          },
        },
      },
    }),
  )
  git(root, 'init', '-q', '-b', 'main')
  git(root, 'config', 'user.email', 'fixture@example.com')
  git(root, 'config', 'user.name', 'Fixture')
  git(root, 'remote', 'add', 'origin', `git@github.com:${REPO}.git`)
  git(root, 'add', '.')
  git(root, 'commit', '-qm', 'initial')
  // A fetched production branch: the protected-path base before any verified capture.
  git(root, 'update-ref', 'refs/remotes/origin/main', 'HEAD')
  return root
}

// ─── simulated providers ─────────────────────────────────────────────────────

interface Worker {
  tag: string
  versions: Array<{ id: string; annotations: Record<string, string>; secrets: string[] }>
  deployments: Array<{
    id: string
    created_on: string
    versions: Array<{ version_id: string; percentage: number }>
  }>
  triggers: Map<string, Record<string, unknown>>
  variables: Map<string, Record<string, { is_secret: boolean; value?: string }>>
  /** Script-level cron triggers (not Workers Builds triggers). */
  schedules: string[]
  routes: Array<{ pattern: string }>
  /** Custom domain hostnames attached to the script. */
  domains: string[]
}

class Cloudflare {
  workers = new Map<string, Worker>()
  calls: string[] = []
  failNext = new Map<string, number>()
  clock = 0
  constructor(names: string[]) {
    for (const name of names) {
      const initial = randomUUID()
      const trigger = randomUUID()
      const tag = randomUUID().replaceAll('-', '')
      this.workers.set(name, {
        tag,
        versions: [{ id: initial, annotations: {}, secrets: ['APP_SECRET'] }],
        deployments: [this.deployment(initial)],
        triggers: new Map([
          [
            trigger,
            {
              trigger_uuid: trigger,
              external_script_id: tag,
              trigger_name: 'Deploy production',
              build_command: 'pnpm build',
              deploy_command: 'pnpm deploy',
              root_directory: '/',
              branch_includes: ['main'],
              branch_excludes: [],
              path_includes: ['*'],
              path_excludes: [],
              build_caching_enabled: true,
              build_token_uuid: randomUUID(),
              repo_connection: { repo_connection_uuid: '33333333-3333-4333-8333-333333333333' },
            },
          ],
        ]),
        variables: new Map([
          [trigger, { PROTECTED: { is_secret: true }, PLAIN: { is_secret: false, value: 'prd' } }],
        ]),
        schedules: [],
        routes: [],
        domains: [],
      })
    }
  }
  applyScriptTriggers(name: string, config: unknown): void {
    const declared = parseDeclaredScriptTriggers(config)
    const worker = this.workers.get(name)!
    if (declared.crons !== undefined) worker.schedules = [...declared.crons]
    if (declared.routes !== undefined) {
      const custom = (route: DeclaredWorkerRoute) =>
        typeof route === 'object' && route.custom_domain === true
      worker.routes = declared.routes
        .filter((route) => !custom(route))
        .map((route) => ({ pattern: routePattern(route) }))
      worker.domains = declared.routes.filter(custom).map(routePattern)
    }
  }
  deployment(version: string) {
    this.clock += 1
    return {
      id: randomUUID(),
      created_on: new Date(1_800_000_000_000 + this.clock * 1000).toISOString(),
      versions: [{ version_id: version, percentage: 100 }],
    }
  }
  serving(name: string): string {
    return this.workers.get(name)!.deployments.at(-1)!.versions[0].version_id
  }
  /** Out-of-band change, e.g. a dashboard secret put or another publisher. */
  drift(name: string): string {
    const worker = this.workers.get(name)!
    const id = randomUUID()
    worker.versions.unshift({ id, annotations: {}, secrets: ['APP_SECRET'] })
    worker.deployments.push(this.deployment(id))
    return id
  }
  upload(name: string, tag: string, message: string): void {
    const worker = this.workers.get(name)!
    worker.versions.unshift({
      id: randomUUID(),
      annotations: { 'workers/tag': tag, 'workers/message': message },
      secrets: [...worker.versions[0].secrets],
    })
  }
  fetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input))
    const method = init?.method ?? 'GET'
    const path = url.pathname.replace(`/client/v4/accounts/${ACCOUNT}`, '')
    this.calls.push(`${method} ${path}`)
    for (const [prefix, failures] of this.failNext) {
      if (failures > 0 && `${method} ${path}`.startsWith(prefix)) {
        this.failNext.set(prefix, failures - 1)
        throw new Error('simulated network failure')
      }
    }
    const ok = (result: unknown, extra: Record<string, unknown> = {}) =>
      new Response(JSON.stringify({ success: true, result, ...extra }), { status: 200 })
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
    if (path === '/workers/scripts')
      return ok([...this.workers].map(([id, worker]) => ({ id, tag: worker.tag })))
    let script = /^\/workers\/scripts\/([\w-]+)\/schedules$/u.exec(path)
    if (script && method === 'GET')
      return ok({
        schedules: this.workers.get(script[1])!.schedules.map((cron) => ({ cron })),
      })
    script = /^\/workers\/services\/([\w-]+)\/environments\/production\/routes$/u.exec(path)
    if (script && method === 'GET') return ok(this.workers.get(script[1])!.routes)
    if (path === '/workers/domains' && method === 'GET')
      return ok(
        [...this.workers].flatMap(([service, worker]) =>
          service === url.searchParams.get('service')
            ? worker.domains.map((hostname) => ({ hostname, service }))
            : [],
        ),
      )
    let match = /^\/workers\/scripts\/([\w-]+)\/(deployments|versions)(?:\/([\w-]+))?$/u.exec(path)
    if (match) {
      const worker = this.workers.get(match[1])!
      if (match[2] === 'deployments' && method === 'POST') {
        const version = (body.versions as Array<{ version_id: string }>)[0].version_id
        worker.deployments.push(this.deployment(version))
        return ok({})
      }
      if (match[2] === 'deployments') return ok({ deployments: [...worker.deployments].reverse() })
      if (match[3]) {
        const version = worker.versions.find((item) => item.id === match![3])!
        return ok({
          id: version.id,
          resources: {
            bindings: version.secrets.map((name) => ({ type: 'secret_text', name })),
          },
        })
      }
      const page = Number(url.searchParams.get('page'))
      const per = Number(url.searchParams.get('per_page'))
      return ok(
        { items: worker.versions.slice((page - 1) * per, page * per) },
        { result_info: { total_count: worker.versions.length, per_page: per } },
      )
    }
    const byTag = (tag: string) => [...this.workers.values()].find((worker) => worker.tag === tag)!
    const byTrigger = (id: string) =>
      [...this.workers.values()].find((worker) => worker.triggers.has(id))!
    match = /^\/builds\/workers\/(\w+)\/triggers$/u.exec(path)
    if (match) return ok([...byTag(match[1]).triggers.values()])
    if (path === '/builds/triggers' && method === 'POST') {
      const id = randomUUID()
      const worker = byTag(String(body.external_script_id))
      const { repo_connection_uuid: connection, ...rest } = body
      worker.triggers.set(id, {
        ...rest,
        trigger_uuid: id,
        repo_connection: { repo_connection_uuid: connection },
      })
      worker.variables.set(id, {})
      return ok({ trigger_uuid: id })
    }
    match = /^\/builds\/triggers\/([\w-]+)(\/environment_variables)?$/u.exec(path)
    if (match) {
      const worker = byTrigger(match[1])
      if (!worker) return new Response(JSON.stringify({ success: false }), { status: 404 })
      if (!match[2] && method === 'DELETE') {
        worker.triggers.delete(match[1])
        return ok(null)
      }
      if (method === 'PATCH') {
        const variables = worker.variables.get(match[1])!
        for (const [name, value] of Object.entries(
          body as Record<string, { is_secret: boolean; value: string }>,
        ))
          variables[name] = value.is_secret ? { is_secret: true } : value
        return ok(null)
      }
      return ok(worker.variables.get(match[1]))
    }
    throw new Error(`Unexpected Cloudflare call ${method} ${path}`)
  }
}

class GitHub {
  workflows = [
    { id: 1, path: '.github/workflows/ci.yml', state: 'active' },
    { id: 2, path: '.github/workflows/promote.yml', state: 'active' },
    { id: 3, path: '.github/workflows/validate.yml', state: 'active' },
    { id: 4, path: '.github/workflows/refresh.yml', state: 'active' },
  ]
  runs: Array<{
    id: number
    workflow: number
    status: string
    head_sha?: string
    head_branch?: string
    repositoryId?: number
  }> = []
  /** What `GET repos/{origin name}` answers; a rename changes full_name, never id. */
  identity = { id: 4242, full_name: REPO }
  calls: string[] = []
  mainHead = ''
  redMain: Array<{ number: number; title: string; created_at: string; pull_request?: object }> = []
  redMainUnavailable = false
  request = (path: string, method = 'GET'): unknown => {
    this.calls.push(`${method} ${path}`)
    const url = new URL(`https://api.github.com/${path}`)
    // GitHub serves the old name through a redirect and the canonical name directly.
    if ([`/repos/${REPO}`, `/repos/${this.identity.full_name}`].includes(url.pathname))
      return this.identity
    const route = url.pathname
      .replace(`/repos/${this.identity.full_name}/`, '')
      .replace(`/repos/${REPO}/`, '')
    if (route === 'issues' && url.searchParams.get('labels') === 'red-main') {
      if (this.redMainUnavailable) throw new Error('GitHub GET request failed')
      return this.redMain
    }
    if (route === 'actions/workflows') return { workflows: this.workflows }
    let match = /^actions\/workflows\/(\d+)(?:\/(disable|enable|runs))?$/u.exec(route)
    if (match) {
      const workflow = this.workflows.find((item) => item.id === Number(match![1]))!
      if (match[2] === 'disable') workflow.state = 'disabled_manually'
      else if (match[2] === 'enable') workflow.state = 'active'
      else if (match[2] === 'runs')
        return {
          workflow_runs: this.runs.filter(
            (run) => run.workflow === workflow.id && run.status === url.searchParams.get('status'),
          ),
        }
      return { ...workflow }
    }
    match = /^actions\/runs\/(\d+)(?:\/(cancel|attempts\/1\/jobs))?$/u.exec(route)
    if (match) {
      const run = this.runs.find((item) => item.id === Number(match![1]))!
      if (match[2] === 'cancel') {
        run.status = 'completed'
        return null
      }
      if (match[2])
        return {
          jobs: ['ci / Build', 'ci / Checks', 'ci / Caller lint', 'ci / Required'].map((name) => ({
            name,
            status: 'completed',
            conclusion: 'success',
          })),
        }
      return {
        id: run.id,
        head_sha: run.head_sha,
        head_branch: run.head_branch,
        event: 'push',
        status: 'completed',
        conclusion: 'success',
        path: '.github/workflows/validate.yml',
        html_url: `https://github.com/${this.identity.full_name}/actions/runs/${run.id}`,
        run_attempt: 1,
        repository: {
          id: run.repositoryId ?? this.identity.id,
          full_name: run.repositoryId ? 'someone-else/fixture-app' : this.identity.full_name,
        },
        head_repository: {
          id: run.repositoryId ?? this.identity.id,
          full_name: run.repositoryId ? 'someone-else/fixture-app' : this.identity.full_name,
        },
      }
    }
    if (route === 'branches/main') return { commit: { sha: this.mainHead } }
    throw new Error(`Unexpected GitHub call ${method} ${route}`)
  }
}

interface Harness {
  root: string
  state: string
  cloudflare: Cloudflare
  github: GitHub
  runs: string[]
  uploads: number
  triggerDeploys: number
  fail: Set<string>
  proofFails: Set<string>
  registryToken: Record<string, string | undefined>
  context: LifecycleContext & DevelopmentContext
  logs: string[]
  validations: DeployedValidationRequest[]
}

function harness(paired = false): Harness {
  const root = repository(paired)
  const state = temp('dev-state-')
  const cloudflare = new Cloudflare(paired ? ['fixture-app', 'fixture-api'] : ['fixture-app'])
  const github = new GitHub()
  const h: Harness = {
    root,
    state,
    cloudflare,
    github,
    runs: [],
    uploads: 0,
    triggerDeploys: 0,
    fail: new Set(),
    proofFails: new Set(),
    registryToken: {},
    logs: [],
    context: {},
    validations: [],
  }
  const readSecret = (source: { key: string }) =>
    source.key === 'NUXT_SESSION_PASSWORD' ? SECRET : `value-of-${source.key}-000000000000`
  h.context = {
    cwd: root,
    stateDirectory: state,
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
    log: (message) => h.logs.push(message),
    readSecret,
    packageManagerVersion: 'pnpm@10.33.4',
    provider: (component) => new DevelopmentCloudflare(component, readSecret, cloudflare.fetch),
    builds: (component) => new DevelopmentCloudflare(component, readSecret, cloudflare.fetch),
    github: () => new DevelopmentGitHub(REPO, github.request),
    queueValidation: (request) => {
      h.validations.push(request)
      return 'queued'
    },
    run: (command, workspace, env) => {
      h.runs.push(command.executable)
      h.registryToken[command.executable] = env.GH_PACKAGES_READ
      if (h.fail.has(command.executable)) throw new Error(`${command.executable} failed`)
      if (command.executable === 'fake-install')
        mkdirSync(join(workspace, 'node_modules'), { recursive: true })
      if (command.executable === 'fake-build')
        for (const app of ['apps/web', 'apps/api'].filter((app) =>
          existsSync(join(workspace, app)),
        )) {
          const output = join(workspace, app, '.output')
          mkdirSync(join(output, 'server'), { recursive: true })
          mkdirSync(join(output, 'public'), { recursive: true })
          writeFileSync(
            join(output, 'server', 'index.mjs'),
            JSON.stringify({
              build: env.NUXT_PUBLIC_BUILD_VERSION,
              importEnvironment: h.fail.has('wrong-environment') ? 'prv' : env.IMPORT_ENVIRONMENT,
              page: readFileSync(join(workspace, app, 'src/page.ts'), 'utf8'),
            }),
          )
          writeFileSync(join(output, 'public', 'index.html'), '<html></html>')
          const source = JSON.parse(
            readFileSync(join(workspace, app, 'wrangler.jsonc'), 'utf8'),
          ) as Record<string, unknown>
          writeFileSync(
            join(output, 'server', 'wrangler.json'),
            JSON.stringify({
              name: source.name,
              main: './index.mjs',
              triggers: source.triggers,
              routes: source.routes,
            }),
          )
          if (h.fail.has('leak')) writeFileSync(join(output, 'public', 'leak.js'), SECRET)
          if (h.fail.has('mutate-source'))
            writeFileSync(join(workspace, 'apps/web/src/page.ts'), 'x')
        }
      if (command.executable === 'fake-assert') {
        const artifact = JSON.parse(
          readFileSync(join(env.NARDUK_DEVELOPMENT_ARTIFACT_DIR!, 'server', 'index.mjs'), 'utf8'),
        ) as { build: string; importEnvironment: string }
        if (
          artifact.build !== env.NARDUK_DEVELOPMENT_BUILD_ID ||
          artifact.importEnvironment !== 'prd'
        )
          throw new Error('artifact assertion failed')
      }
      if (
        command.executable === 'fake-schema' &&
        env.D1_READ_TOKEN !== 'value-of-D1_READ_TOKEN-000000000000'
      )
        throw new Error('schema check lacked its read-only credential')
    },
    upload: (args, appDir, env) => {
      if (!env?.CLOUDFLARE_API_TOKEN) throw new Error('upload lacked deployment credential')
      const name = JSON.parse(readFileSync(join(appDir ?? '', 'wrangler.jsonc'), 'utf8'))
        .name as string
      if (args[0] === 'versions-upload') {
        h.uploads += 1
        cloudflare.upload(name, args[2]!, args[4]!)
        return 0
      }
      if (args[0] === 'triggers-deploy') {
        h.triggerDeploys += 1
        const declared = readDeclaredScriptTriggers(appDir ?? '')
        cloudflare.applyScriptTriggers(name, {
          triggers: declared.triggers.crons ? { crons: declared.triggers.crons } : {},
          routes: declared.triggers.routes,
        })
        return 0
      }
      throw new Error(`unexpected deploy action ${args[0]}`)
    },
    verify: async (flags) =>
      ({
        result: h.proofFails.has(flags.baseUrl) ? 'FAIL' : 'PASS',
        exitCode: h.proofFails.has(flags.baseUrl) ? 4 : 0,
        attemptsUsed: 1,
        assertions: [{ id: 'build-id', status: 'pass' }],
      }) as unknown as VerifyReport,
  }
  return h
}

async function enter(h: Harness) {
  return runDevelopmentEnter(
    { approvalRef: 'owner-approval#1', publisher: 'lane-a', refresh: false, dryRun: false },
    h.context,
  )
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe('development mode entry', { timeout: 30_000 }, () => {
  it('classifies already-disabled held workflows as ambiguous unless retired', () => {
    const saved = [
      {
        id: 1,
        path: '.github/workflows/ci.yml',
        previousState: 'disabled_manually',
        desiredState: 'disabled_manually',
        writes: false,
        held: false,
        restored: false,
      },
      {
        id: 2,
        path: '.github/workflows/old.yml',
        previousState: 'disabled_inactivity',
        desiredState: 'disabled_manually',
        writes: false,
        held: false,
        restored: false,
      },
      {
        id: 3,
        path: '.github/workflows/ok.yml',
        previousState: 'active',
        desiredState: 'active',
        writes: false,
        held: false,
        restored: false,
      },
    ]
    expect(
      DevelopmentGitHub.ambiguousPriorWorkflows(saved, ['.github/workflows/old.yml']).map(
        (workflow) => workflow.path,
      ),
    ).toEqual(['.github/workflows/ci.yml'])
  })

  it('refuses to deploy an unenrolled repository', async () => {
    const h = harness()
    await expect(runDevelopmentDeploy({ dryRun: false, json: false }, h.context)).rejects.toThrow(
      /not enrolled/u,
    )
    expect((await runDevelopmentStatus({ remote: false }, h.context)).mode).toBe('normal')
  })

  it('dry run inventories without mutating provider state', async () => {
    const h = harness()
    await runDevelopmentEnter(
      { approvalRef: 'owner#1', publisher: 'lane-a', refresh: false, dryRun: true },
      h.context,
    )
    expect(h.github.calls.filter((call) => !call.startsWith('GET'))).toEqual([])
    expect(h.cloudflare.calls.filter((call) => !call.startsWith('GET'))).toEqual([])
    expect(readActivation(REPO, h.state)).toBeUndefined()
  })

  it('refuses enter when a held workflow is already disabled', async () => {
    const h = harness()
    const ci = h.github.workflows.find((workflow) => workflow.path.endsWith('ci.yml'))!
    ci.state = 'disabled_manually'
    await expect(enter(h)).rejects.toThrow(/Ambiguous prior workflow state/u)
    expect(ci.state).toBe('disabled_manually')
    expect(h.github.workflows.find((workflow) => workflow.path.endsWith('ci.yml'))!.state).toBe(
      'disabled_manually',
    )
    expect(h.cloudflare.workers.get('fixture-app')!.triggers.size).toBe(1)
    expect(readActivation(REPO, h.state)).toBeUndefined()
  })

  it('refuses dry-run when a held workflow is already disabled', async () => {
    const h = harness()
    h.github.workflows.find((workflow) => workflow.path.endsWith('ci.yml'))!.state =
      'disabled_inactivity'
    await expect(
      runDevelopmentEnter(
        { approvalRef: 'owner#1', publisher: 'lane-a', refresh: false, dryRun: true },
        h.context,
      ),
    ).rejects.toThrow(/Ambiguous prior workflow state/u)
    expect(h.logs.some((line) => line.includes('AMBIGUOUS prior state'))).toBe(true)
    expect(h.github.calls.filter((call) => !call.startsWith('GET'))).toEqual([])
    expect(h.cloudflare.calls.filter((call) => !call.startsWith('GET'))).toEqual([])
    expect(readActivation(REPO, h.state)).toBeUndefined()
  })

  it('does not treat a retired already-disabled workflow as ambiguous', async () => {
    const h = harness()
    patchAutomation(h.root, (automation) => {
      automation.retiredWorkflows = ['.github/workflows/ci.yml']
    })
    h.github.workflows.find((workflow) => workflow.path.endsWith('ci.yml'))!.state =
      'disabled_manually'
    const record = await enter(h)
    expect(record.mode).toBe('active')
    expect(record.acceptedPriorWorkflows).toBeUndefined()
    expect(record.workflows.find((workflow) => workflow.path.endsWith('ci.yml'))).toMatchObject({
      previousState: 'disabled_manually',
      desiredState: 'disabled_manually',
    })
  })

  it('records --accept-prior-state so exit can restore the disabled state on purpose', async () => {
    const h = harness()
    h.github.workflows.find((workflow) => workflow.path.endsWith('ci.yml'))!.state =
      'disabled_manually'
    const record = await runDevelopmentEnter(
      {
        approvalRef: 'owner-approval#1',
        publisher: 'lane-a',
        refresh: false,
        dryRun: false,
        acceptPriorState: true,
      },
      h.context,
    )
    expect(record.acceptedPriorWorkflows).toEqual(['.github/workflows/ci.yml'])
    expect(record.history.some((event) => event.event === 'accepted-prior-state')).toBe(true)
    expect(record.workflows.find((workflow) => workflow.path.endsWith('ci.yml'))).toMatchObject({
      previousState: 'disabled_manually',
      desiredState: 'disabled_manually',
    })
    expect(formatStatus(await runDevelopmentStatus({ remote: false }, h.context))).toMatch(
      /exit restores disabled_manually \(accepted prior state at entry\)/u,
    )
    expect(DEVELOPMENT_USAGE.join('\n')).toContain('--accept-prior-state')
    runDevelopmentExitPrepare(h.context)
    const release = git(h.root, 'rev-parse', 'HEAD')
    h.github.mainHead = release
    h.github.runs.push({
      id: 910,
      workflow: 3,
      status: 'completed',
      head_sha: release,
      head_branch: `narduk-validation/${release}/request`,
    })
    await runDevelopmentExitComplete({ releaseSha: release, validationRun: '910' }, h.context)
    expect(h.github.workflows.map((workflow) => workflow.state)).toEqual([
      'disabled_manually',
      'active',
      'active',
      'active',
    ])
    expect(
      h.logs.some((line) =>
        line.includes(
          'restoring .github/workflows/ci.yml to disabled_manually (accepted prior state at entry)',
        ),
      ),
    ).toBe(true)
  })

  it('refuses --refresh when a newly held workflow is already disabled', async () => {
    const h = harness()
    await enter(h)
    patchAutomation(h.root, (automation) => {
      automation.workflows = [
        ...(automation.workflows as string[]),
        '.github/workflows/nightly.yml',
      ]
    })
    h.github.workflows.push({
      id: 5,
      path: '.github/workflows/nightly.yml',
      state: 'disabled_manually',
    })
    await expect(
      runDevelopmentEnter(
        {
          approvalRef: 'owner-approval#1',
          publisher: 'lane-a',
          refresh: true,
          dryRun: false,
        },
        h.context,
      ),
    ).rejects.toThrow(/Ambiguous prior workflow state/u)
    expect(readActivation(REPO, h.state)!.workflows.map((workflow) => workflow.path)).toEqual([
      '.github/workflows/ci.yml',
      '.github/workflows/promote.yml',
    ])
  })

  it('does not treat already-held workflows as ambiguous on refresh dry-run', async () => {
    const h = harness()
    await enter(h)
    const before = structuredClone(readActivation(REPO, h.state)!)
    const mutatingCalls = h.github.calls.filter((call) => !call.startsWith('GET')).length
    patchAutomation(h.root, (automation) => {
      automation.workflows = [
        ...(automation.workflows as string[]),
        '.github/workflows/nightly.yml',
      ]
    })
    h.github.workflows.push({
      id: 5,
      path: '.github/workflows/nightly.yml',
      state: 'active',
    })
    await runDevelopmentEnter(
      {
        approvalRef: 'owner-approval#1',
        publisher: 'lane-a',
        refresh: true,
        dryRun: true,
      },
      h.context,
    )
    expect(h.logs.some((line) => line.includes('AMBIGUOUS prior state'))).toBe(false)
    expect(
      h.logs.some((line) => line.includes('hold workflow .github/workflows/nightly.yml')),
    ).toBe(true)
    expect(h.github.calls.filter((call) => !call.startsWith('GET'))).toHaveLength(mutatingCalls)
    expect(readActivation(REPO, h.state)).toEqual(before)
  })

  it('still refuses refresh dry-run when a newly held workflow is already disabled', async () => {
    const h = harness()
    await enter(h)
    const before = structuredClone(readActivation(REPO, h.state)!)
    patchAutomation(h.root, (automation) => {
      automation.workflows = [
        ...(automation.workflows as string[]),
        '.github/workflows/nightly.yml',
      ]
    })
    h.github.workflows.push({
      id: 5,
      path: '.github/workflows/nightly.yml',
      state: 'disabled_manually',
    })
    await expect(
      runDevelopmentEnter(
        {
          approvalRef: 'owner-approval#1',
          publisher: 'lane-a',
          refresh: true,
          dryRun: true,
        },
        h.context,
      ),
    ).rejects.toThrow(/nightly\.yml is disabled_manually/u)
    expect(h.logs.filter((line) => line.includes('AMBIGUOUS prior state')).join('\n')).toContain(
      'nightly.yml',
    )
    expect(h.logs.filter((line) => line.includes('AMBIGUOUS prior state')).join('\n')).not.toMatch(
      /ci\.yml|promote\.yml/u,
    )
    expect(readActivation(REPO, h.state)).toEqual(before)
  })

  it('holds workflows and retires triggers, preserving manual validation and writers', async () => {
    const h = harness()
    const record = await enter(h)
    expect(record.mode).toBe('active')
    expect(h.github.workflows.map((w) => w.state)).toEqual([
      'disabled_manually',
      'disabled_manually',
      'active',
      'active',
    ])
    expect(h.cloudflare.workers.get('fixture-app')!.triggers.size).toBe(0)
    expect(record.triggers.web[0].variables.PROTECTED).toEqual({
      isSecret: true,
      source: { project: 'fixture', environment: 'prd', config: 'app', key: 'PROTECTED' },
    })
    expect(JSON.stringify(record)).not.toContain('value-of-PROTECTED')
    expect(record.expectedServing.web).toBe(h.cloudflare.serving('fixture-app'))
  })

  it('refuses an unclassified active workflow before changing anything', async () => {
    const h = harness()
    h.github.workflows.push({ id: 9, path: '.github/workflows/surprise.yml', state: 'active' })
    await expect(enter(h)).rejects.toThrow(/Unclassified active workflow/u)
    expect(h.github.workflows[0].state).toBe('active')
  })

  it('refuses a protected build variable without a restoration source', async () => {
    const h = harness()
    const variables = [...h.cloudflare.workers.get('fixture-app')!.variables.values()][0]
    variables.UNKNOWN_SECRET = { is_secret: true }
    await expect(enter(h)).rejects.toThrow(/no declared restoration source/u)
    expect(h.cloudflare.workers.get('fixture-app')!.triggers.size).toBe(1)
  })

  it('resumes an interrupted entry from its journal without losing saved settings', async () => {
    const h = harness()
    h.cloudflare.failNext.set('DELETE /builds/triggers', 1)
    await expect(enter(h)).rejects.toThrow(/did not complete/u)
    const partial = readActivation(REPO, h.state)!
    expect(partial.mode).toBe('entering')
    expect(partial.workflows.every((workflow) => workflow.held)).toBe(true)
    expect(partial.workflows.find((w) => w.path.endsWith('promote.yml'))!.previousState).toBe(
      'active',
    )
    await expect(runDevelopmentDeploy({ dryRun: false, json: false }, h.context)).rejects.toThrow(
      /entering/u,
    )
    const record = await enter(h)
    expect(record.mode).toBe('active')
    expect(record.triggers.web).toHaveLength(1)
  })

  it('waits for credentialed writers to settle and cancels other held runs', async () => {
    const h = harness()
    h.github.runs.push({ id: 71, workflow: 1, status: 'queued' })
    h.github.runs.push({ id: 72, workflow: 2, status: 'in_progress' })
    await expect(enter(h)).rejects.toThrow(/still settling/u)
    expect(h.github.runs[0].status).toBe('completed')
    expect(h.github.runs[1].status).toBe('in_progress')
    h.github.runs[1].status = 'completed'
    expect((await enter(h)).mode).toBe('active')
  })
})

// ─── app-owned publish paths (agent-infrastructure#1679) ─────────────────────

const LEGACY_DEPLOY = [
  '#!/usr/bin/env bash',
  'test -f "$HOME/.local/state/fixture-app-dev/mode.json" || exit 1',
  'NARDUK_ALLOW_LOCAL_WRANGLER_DEPLOY=1 pnpm exec narduk-app deploy versions-upload',
  'NARDUK_ALLOW_MANUAL_PROMOTE=1 pnpm exec narduk-app deploy versions-promote --version-id "$v"',
  '',
].join('\n')

/** Every tracked file's bytes, so a test can prove the app was left exactly as found. */
function trackedBytes(root: string): Record<string, string> {
  return Object.fromEntries(
    git(root, 'ls-files', '-z')
      .split('\0')
      .filter(Boolean)
      .map((path) => [
        path,
        createHash('sha256')
          .update(readFileSync(join(root, path)))
          .digest('hex'),
      ]),
  )
}

function armLegacyDeploy(root: string, packageJson: string): void {
  mkdirSync(join(root, 'apps/web/script/dev'), { recursive: true })
  writeFileSync(join(root, 'apps/web/script/dev/deploy_dev.sh'), LEGACY_DEPLOY)
  writeFileSync(join(root, 'apps/web/package.json'), packageJson)
  git(root, 'add', '.')
  git(root, 'commit', '-qm', 'app-owned deploy:dev')
  git(root, 'update-ref', 'refs/remotes/origin/main', 'HEAD')
}

const ENROLLED_PACKAGE = JSON.stringify(
  { name: 'web', scripts: { 'deploy:dev': 'narduk-app development deploy' } },
  null,
  2,
)
/** What a merge of main into a pre-conversion branch produced: both keys, legacy last. */
const MERGED_PACKAGE = [
  '{',
  '  "name": "web",',
  '  "scripts": {',
  '    "deploy:dev": "narduk-app development deploy",',
  '    "deploy:dev": "script/dev/deploy_dev.sh"',
  '  }',
  '}',
  '',
].join('\n')

describe('development enter and app-owned publish paths', { timeout: 30_000 }, () => {
  it('refuses while the app-owned deploy:dev is armed, changing nothing anywhere', async () => {
    const h = harness()
    armLegacyDeploy(
      h.root,
      JSON.stringify({ name: 'web', scripts: { 'deploy:dev': 'script/dev/deploy_dev.sh' } }),
    )
    const before = trackedBytes(h.root)
    await expect(enter(h)).rejects.toThrow(
      /apps\/web\/package.json "deploy:dev" runs "script\/dev\/deploy_dev.sh", not narduk-app development deploy/u,
    )
    await expect(enter(h)).rejects.toThrow(
      /deploy_dev.sh, which sets NARDUK_ALLOW_LOCAL_WRANGLER_DEPLOY \(line 3\)/u,
    )
    expect(trackedBytes(h.root)).toEqual(before)
    expect(git(h.root, 'status', '--porcelain', '--untracked-files=all')).toBe('')
    expect(readActivation(REPO, h.state)).toBeUndefined()
    expect(h.github.calls.filter((call) => !call.startsWith('GET'))).toEqual([])
    expect(h.cloudflare.calls.filter((call) => !call.startsWith('GET'))).toEqual([])
    expect(h.github.workflows.map((workflow) => workflow.state)).toEqual([
      'active',
      'active',
      'active',
      'active',
    ])
  })

  it('names the armed path in the dry run and refuses it', async () => {
    const h = harness()
    armLegacyDeploy(h.root, MERGED_PACKAGE)
    const before = trackedBytes(h.root)
    await expect(
      runDevelopmentEnter(
        { approvalRef: 'owner#1', publisher: 'lane-a', refresh: false, dryRun: true },
        h.context,
      ),
    ).rejects.toThrow(/"deploy:dev" is declared 2 times; JSON keeps the last/u)
    expect(h.logs).toContain(
      '[development]   ARMED legacy publish path: apps/web/package.json "deploy:dev" runs "script/dev/deploy_dev.sh", not narduk-app development deploy',
    )
    expect(h.logs).toContain('[development] dry run: no provider state was changed')
    expect(trackedBytes(h.root)).toEqual(before)
    expect(git(h.root, 'status', '--porcelain', '--untracked-files=all')).toBe('')
    expect(h.github.calls.filter((call) => !call.startsWith('GET'))).toEqual([])
    expect(h.cloudflare.calls.filter((call) => !call.startsWith('GET'))).toEqual([])
    expect(readActivation(REPO, h.state)).toBeUndefined()
  })

  it('enters once the path is retired, and exit leaves every app byte as it found it', async () => {
    const h = harness()
    armLegacyDeploy(h.root, ENROLLED_PACKAGE)
    const before = trackedBytes(h.root)
    await enter(h)
    await runDevelopmentDeploy({ dryRun: false, json: false }, h.context)
    runDevelopmentExitPrepare(h.context)
    const release = git(h.root, 'rev-parse', 'HEAD')
    h.github.mainHead = release
    h.github.runs.push({
      id: 901,
      workflow: 3,
      status: 'completed',
      head_sha: release,
      head_branch: `narduk-validation/${release}/request`,
    })
    await runDevelopmentExitComplete({ releaseSha: release, validationRun: '901' }, h.context)
    expect(readActivation(REPO, h.state)).toBeUndefined()
    expect(trackedBytes(h.root)).toEqual(before)
    expect(git(h.root, 'status', '--porcelain', '--untracked-files=all')).toBe('')
  })

  it('shows a merge that re-arms the path in status, and refuses --refresh on it', async () => {
    const h = harness()
    armLegacyDeploy(h.root, ENROLLED_PACKAGE)
    await enter(h)
    expect((await runDevelopmentStatus({ remote: false }, h.context)).legacyPublishPaths).toEqual(
      [],
    )
    writeFileSync(join(h.root, 'apps/web/package.json'), MERGED_PACKAGE)
    git(h.root, 'commit', '-qam', 'merge main')
    const report = await runDevelopmentStatus({ remote: false }, h.context)
    expect(formatStatus(report)).toContain(
      '  ARMED LEGACY PUBLISH PATH: apps/web/package.json "deploy:dev" is declared 2 times; JSON keeps the last, so a merge can re-arm a retired script',
    )
    await expect(
      runDevelopmentEnter(
        { approvalRef: 'owner-approval#1', publisher: 'lane-a', refresh: true, dryRun: false },
        h.context,
      ),
    ).rejects.toThrow(/Retire it in this checkout first/u)
    expect(readActivation(REPO, h.state)!.mode).toBe('active')
  })

  it('reports, rather than crashes, when status cannot read the package scripts', async () => {
    const h = harness()
    await enter(h)
    rmSync(join(h.root, 'apps/web/package.json'))
    mkdirSync(join(h.root, 'apps/web/package.json'))
    const report = await runDevelopmentStatus({ remote: false }, h.context)
    expect(report.legacyPublishPaths).toBeUndefined()
    expect(formatStatus(report)).toMatch(/legacy publish paths unknown: .*EISDIR/u)
  })
})

describe('deploy:dev transaction', { timeout: 30_000 }, () => {
  it('deploys dirty edits, deletions and untracked source reading only red-main from GitHub', async () => {
    const h = harness()
    await enter(h)
    const githubCalls = h.github.calls.length + 1
    writeFileSync(join(h.root, 'apps/web/src/page.ts'), 'export const page = 2\n')
    writeFileSync(join(h.root, 'apps/web/src/new.ts'), 'export const fresh = true\n')
    unlinkSync(join(h.root, 'obsolete.txt'))
    const receipt = await runDevelopmentDeploy({ dryRun: false, json: false }, h.context)
    expect(receipt.outcome).toBe('verified')
    expect(receipt.dirty).toBe(true)
    expect(receipt.buildId).toMatch(/^dev-/u)
    expect(receipt.baseCommit).toBe(git(h.root, 'rev-parse', 'HEAD'))
    expect(h.github.calls.length).toBe(githubCalls)
    const manifest = readPrivateJson(
      join(
        h.state,
        'receipts',
        'narduk-enterprises__fixture-app',
        receipt.buildId,
        'source-manifest.json',
      ),
    ) as { entries: Array<{ path: string; kind: string }> }
    expect(manifest.entries.find((entry) => entry.path === 'obsolete.txt')?.kind).toBe('deleted')
    expect(manifest.entries.some((entry) => entry.path === 'apps/web/src/new.ts')).toBe(true)
    const artifact = readFileSync(
      join(
        h.state,
        'receipts',
        'narduk-enterprises__fixture-app',
        receipt.buildId,
        'artifacts',
        'fixture-app',
        'server',
        'index.mjs',
      ),
      'utf8',
    )
    expect(artifact).toContain('page = 2')
    expect(h.cloudflare.serving('fixture-app')).toBe(receipt.components.web.candidateVersionId)
    expect(readActivation(REPO, h.state)!.expectedServing.web).toBe(
      receipt.components.web.candidateVersionId,
    )
    expect(JSON.stringify(receipt)).not.toContain(SECRET)
  })

  it('reconciles declared crons and routes onto the serving Worker after promote', async () => {
    const h = harness()
    writeFileSync(
      join(h.root, 'apps/web/wrangler.jsonc'),
      JSON.stringify({
        name: 'fixture-app',
        account_id: ACCOUNT,
        triggers: { crons: ['20 9 * * *'] },
        routes: [{ pattern: 'fixture.example.com/*', zone_name: 'example.com' }],
      }),
    )
    const worker = h.cloudflare.workers.get('fixture-app')!
    worker.schedules = ['0 9 * * *', '20 9 * * *']
    worker.routes = [{ pattern: 'stale.example.com/*' }]
    await enter(h)
    const receipt = await runDevelopmentDeploy({ dryRun: false, json: false }, h.context)
    expect(receipt.outcome).toBe('verified')
    expect(h.triggerDeploys).toBe(1)
    expect(worker.schedules).toEqual(['20 9 * * *'])
    expect(worker.routes).toEqual([{ pattern: 'fixture.example.com/*' }])
    expect(receipt.components.web.triggers).toEqual({
      crons: ['20 9 * * *'],
      routes: ['fixture.example.com/*'],
    })
  })

  it('refuses to call a deploy verified when the applied crons are not live', async () => {
    const h = harness()
    writeFileSync(
      join(h.root, 'apps/web/wrangler.jsonc'),
      JSON.stringify({
        name: 'fixture-app',
        account_id: ACCOUNT,
        triggers: { crons: ['20 9 * * *'] },
      }),
    )
    await enter(h)
    const upload = h.context.upload!
    // wrangler exits 0 but the schedule never lands.
    h.context.upload = (args, appDir, env, options) =>
      args[0] === 'triggers-deploy' ? 0 : upload(args, appDir, env, options)
    const receipt = await runDevelopmentDeploy({ dryRun: false, json: false }, h.context)
    expect(receipt.outcome).toBe('unproven')
    expect(receipt.components.web.status).toBe('failed')
    expect(receipt.failure).toMatch(/did not take effect: crons declared-only \["20 9 \* \* \*"\]/u)
  })

  it('reports declared-vs-live script triggers at entry and in remote status', async () => {
    const h = harness()
    writeFileSync(
      join(h.root, 'apps/web/wrangler.jsonc'),
      JSON.stringify({
        name: 'fixture-app',
        account_id: ACCOUNT,
        triggers: { crons: ['20 9 * * *'] },
        routes: [{ pattern: 'fixture.example.com', custom_domain: true }],
      }),
    )
    git(h.root, 'commit', '-qam', 'declare triggers')
    git(h.root, 'update-ref', 'refs/remotes/origin/main', 'HEAD')
    const worker = h.cloudflare.workers.get('fixture-app')!
    worker.schedules = ['0 9 * * *', '20 9 * * *']
    worker.domains = ['fixture.example.com']
    await enter(h)
    expect(h.logs).toContain(
      '[development]   fixture-app: script triggers MISMATCH: crons declared-only [] live-only ["0 9 * * *"]',
    )
    const mismatched = await runDevelopmentStatus({ remote: true }, h.context)
    expect(mismatched.remote!.web.scriptTriggers!.mismatches).toEqual([
      { kind: 'crons', declaredOnly: [], liveOnly: ['0 9 * * *'] },
    ])
    expect(formatStatus(mismatched)).toContain(
      'web script triggers MISMATCH: crons declared-only [] live-only ["0 9 * * *"]',
    )
    const receipt = await runDevelopmentDeploy({ dryRun: false, json: false }, h.context)
    expect(receipt.outcome).toBe('verified')
    expect(formatStatus(await runDevelopmentStatus({ remote: true }, h.context))).toContain(
      'web script triggers match the checkout',
    )
  })

  it('reports script triggers as unknown, not in sync, when the live read fails', async () => {
    const h = harness()
    await enter(h)
    h.cloudflare.failNext.set('GET /workers/domains', 1)
    const report = await runDevelopmentStatus({ remote: true }, h.context)
    expect(report.remote!.web.scriptTriggers).toEqual({
      mismatches: [],
      unknown: expect.stringMatching(/did not complete/u) as string,
    })
    expect(formatStatus(report)).toMatch(/web script triggers unknown: /u)
  })

  it('records trigger-apply failure as unproven with failed component status', async () => {
    const h = harness()
    await enter(h)
    const upload = h.context.upload!
    h.context.upload = (args, appDir, env, options) => {
      if (args[0] === 'triggers-deploy') return 1
      return upload(args, appDir, env, options)
    }
    const receipt = await runDevelopmentDeploy({ dryRun: false, json: false }, h.context)
    expect(receipt.outcome).toBe('unproven')
    expect(receipt.components.web.status).toBe('failed')
    expect(receipt.failure).toMatch(/trigger apply failed/u)
    expect(h.cloudflare.serving('fixture-app')).toBe(receipt.components.web.candidateVersionId)
  })

  it('records a thrown trigger-apply error as unproven with failed component status', async () => {
    const h = harness()
    await enter(h)
    const upload = h.context.upload!
    h.context.upload = (args, appDir, env, options) => {
      if (args[0] === 'triggers-deploy')
        throw new Error('routes[0] must be a pattern string or a { pattern } object')
      return upload(args, appDir, env, options)
    }
    const receipt = await runDevelopmentDeploy({ dryRun: false, json: false }, h.context)
    expect(receipt.outcome).toBe('unproven')
    expect(receipt.components.web.status).toBe('failed')
    expect(receipt.failure).toMatch(/pattern string/u)
    expect(h.cloudflare.serving('fixture-app')).toBe(receipt.components.web.candidateVersionId)
  })

  it('gives the registry credential to a cold install only', async () => {
    const h = harness()
    await enter(h)
    const reads: string[] = []
    const readSecret = h.context.readSecret!
    h.context.readSecret = (selector) => {
      reads.push(selector.key)
      return readSecret(selector)
    }
    await runDevelopmentDeploy({ dryRun: false, json: false }, h.context)
    expect(h.registryToken['fake-install']).toBe('value-of-GH_PACKAGES_READ-000000000000')
    expect(h.registryToken['fake-check']).toBeUndefined()
    expect(h.registryToken['fake-build']).toBeUndefined()
    reads.length = 0
    await runDevelopmentDeploy({ dryRun: false, json: false }, h.context)
    expect(reads).not.toContain('GH_PACKAGES_READ')
  })

  it('reuses warm dependencies and reinstalls when the lockfile changes', async () => {
    const h = harness()
    await enter(h)
    await runDevelopmentDeploy({ dryRun: false, json: false }, h.context)
    await runDevelopmentDeploy({ dryRun: false, json: false }, h.context)
    expect(h.runs.filter((run) => run === 'fake-install')).toHaveLength(1)
    writeFileSync(join(h.root, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n# changed\n')
    const receipt = await runDevelopmentDeploy({ dryRun: false, json: false }, h.context)
    expect(receipt.failure).toBeUndefined()
    expect(receipt.dependencies?.reused).toBe(false)
    expect(h.runs.filter((run) => run === 'fake-install')).toHaveLength(2)
    expect(h.runs.lastIndexOf('fake-install')).toBeLessThan(h.runs.lastIndexOf('fake-check'))
  })

  it.each([
    ['fake-check', 'refused'],
    ['wrong-environment', 'refused'],
    ['fake-schema', 'refused'],
    ['leak', 'refused'],
    ['mutate-source', 'refused'],
  ])('%s failure uploads nothing and moves no traffic', async (failure, outcome) => {
    const h = harness()
    await enter(h)
    const before = h.cloudflare.serving('fixture-app')
    h.fail.add(failure)
    const receipt = await runDevelopmentDeploy({ dryRun: false, json: false }, h.context)
    expect(receipt.outcome).toBe(outcome)
    expect(h.uploads).toBe(0)
    expect(h.cloudflare.serving('fixture-app')).toBe(before)
    expect(JSON.stringify(receipt)).not.toContain(SECRET)
  })

  it('refuses unexpected serving drift before building', async () => {
    const h = harness()
    await enter(h)
    h.cloudflare.drift('fixture-app')
    const receipt = await runDevelopmentDeploy({ dryRun: false, json: false }, h.context)
    expect(receipt.outcome).toBe('refused')
    expect(receipt.failure).toMatch(/not the recorded/u)
    expect(h.runs).toEqual([])
  })

  it('treats a secret change after upload as superseding the candidate', async () => {
    const h = harness()
    await enter(h)
    const upload = h.context.upload!
    h.context.upload = (args, appDir, env, options) => {
      const result = upload(args, appDir, env, options)
      const worker = h.cloudflare.workers.get('fixture-app')!
      worker.versions.unshift({ id: randomUUID(), annotations: {}, secrets: ['APP_SECRET'] })
      return result
    }
    const before = h.cloudflare.serving('fixture-app')
    const receipt = await runDevelopmentDeploy({ dryRun: false, json: false }, h.context)
    expect(receipt.outcome).toBe('failed-before-traffic')
    expect(receipt.failure).toMatch(/superseded/u)
    expect(h.cloudflare.serving('fixture-app')).toBe(before)
  })

  it('refuses a candidate missing a required runtime secret name', async () => {
    const h = harness()
    await enter(h)
    const upload = h.context.upload!
    h.context.upload = (args, appDir, env, options) => {
      const result = upload(args, appDir, env, options)
      h.cloudflare.workers.get('fixture-app')!.versions[0].secrets = []
      return result
    }
    const receipt = await runDevelopmentDeploy({ dryRun: false, json: false }, h.context)
    expect(receipt.outcome).toBe('failed-before-traffic')
    expect(receipt.failure).toMatch(/missing required runtime secret APP_SECRET/u)
  })

  it('records a failed live proof as unproven with the actual serving version', async () => {
    const h = harness()
    await enter(h)
    h.proofFails.add('https://fixture-app.example.com')
    const receipt = await runDevelopmentDeploy({ dryRun: false, json: false }, h.context)
    expect(receipt.outcome).toBe('unproven')
    const record = readActivation(REPO, h.state)!
    expect(record.expectedServing.web).toBe(receipt.components.web.candidateVersionId)
    expect(record.pendingAttempt).toBeUndefined()
    h.proofFails.clear()
    expect((await runDevelopmentDeploy({ dryRun: false, json: false }, h.context)).outcome).toBe(
      'verified',
    )
  })

  it('reports owner-only behavior as awaiting the owner, not verified', async () => {
    const h = harness()
    const manifest = join(h.root, 'Config', 'cloudflare-app.json')
    const config = JSON.parse(readFileSync(manifest, 'utf8'))
    config.deployment.development.components.web.behavior = {
      kind: 'owner',
      instructions: 'Log in and open Today',
    }
    writeFileSync(manifest, JSON.stringify(config))
    git(h.root, 'commit', '-qam', 'owner proof')
    await enter(h)
    expect((await runDevelopmentDeploy({ dryRun: false, json: false }, h.context)).outcome).toBe(
      'awaiting-owner',
    )
  })

  it('refuses a second publisher while the target lock is held', async () => {
    const h = harness()
    await enter(h)
    const lock = acquireTargetLocks(
      [{ accountId: ACCOUNT, workerName: 'fixture-app' }],
      'hotfix',
      'other-receipt',
      h.state,
    )
    try {
      await expect(runDevelopmentDeploy({ dryRun: false, json: false }, h.context)).rejects.toThrow(
        /Target is locked/u,
      )
    } finally {
      lock.release()
    }
  })

  it('refuses publishing from another checkout or workstation', async () => {
    const h = harness()
    await enter(h)
    const record = readActivation(REPO, h.state)!
    writeActivation({ ...record, checkout: '/elsewhere' }, h.state)
    await expect(runDevelopmentDeploy({ dryRun: false, json: false }, h.context)).rejects.toThrow(
      /integration checkout/u,
    )
    writeActivation({ ...record, workstation: 'another-host' }, h.state)
    await expect(runDevelopmentDeploy({ dryRun: false, json: false }, h.context)).rejects.toThrow(
      /workstation another-host/u,
    )
  })

  it('leaves an interrupted promotion unresolved until provider state is inspected', async () => {
    const h = harness()
    await enter(h)
    const context = { ...h.context }
    // Simulate termination: promotion request dies and every later read fails too.
    context.provider = (component) => {
      const real = new DevelopmentCloudflare(component, h.context.readSecret!, h.cloudflare.fetch)
      let promoted = false
      return {
        inspect: () => {
          if (promoted) throw new Error('terminated')
          return real.inspect()
        },
        versions: () => real.versions(),
        requiredSecrets: (id) => real.requiredSecrets(id),
        schedules: () => real.schedules(),
        promote: async (id, message) => {
          promoted = true
          await real.promote(id, message).catch(() => null)
          throw new Error('terminated')
        },
      }
    }
    const receipt = await runDevelopmentDeploy({ dryRun: false, json: false }, context)
    expect(receipt.outcome).toBe('unproven')
    expect(readActivation(REPO, h.state)!.pendingAttempt?.buildId).toBe(receipt.buildId)
    await expect(runDevelopmentDeploy({ dryRun: false, json: false }, h.context)).rejects.toThrow(
      /unresolved/u,
    )
    const record = await runDevelopmentResolve({ releaseStaleLock: false }, h.context)
    expect(record.pendingAttempt).toBeUndefined()
    expect(record.expectedServing.web).toBe(h.cloudflare.serving('fixture-app'))
    expect((await runDevelopmentDeploy({ dryRun: false, json: false }, h.context)).outcome).toBe(
      'verified',
    )
  })

  it('records the mixed state when the second component fails', async () => {
    const h = harness(true)
    await enter(h)
    h.proofFails.add('https://fixture-api.example.com')
    const receipt = await runDevelopmentDeploy({ dryRun: false, json: false }, h.context)
    expect(receipt.outcome).toBe('unproven')
    expect(receipt.components.web.status).toBe('proven')
    expect(receipt.components.api.status).toBe('failed')
    expect(h.cloudflare.serving('fixture-app')).toBe(receipt.components.web.candidateVersionId)
    expect(h.uploads).toBe(2)
  })

  it('releases a stale lock only when its process is gone on this workstation', async () => {
    const h = harness()
    await enter(h)
    const lock = join(h.state, 'locks', `${ACCOUNT}-fixture-app.lock`)
    mkdirSync(lock, { recursive: true, mode: 0o700 })
    writeFileSync(
      join(lock, 'owner.json'),
      JSON.stringify({ pid: process.pid, workstation: hostname(), operation: 'x' }),
      { mode: 0o600 },
    )
    await expect(runDevelopmentResolve({ releaseStaleLock: true }, h.context)).rejects.toThrow(
      /live or remote process/u,
    )
    writeFileSync(
      join(lock, 'owner.json'),
      JSON.stringify({ pid: 2 ** 22 + 17, workstation: hostname(), operation: 'x' }),
      { mode: 0o600 },
    )
    await runDevelopmentResolve({ releaseStaleLock: true }, h.context)
    expect(existsSync(lock)).toBe(false)
  })
})

describe('feedback, operations, handoff and exit', { timeout: 30_000 }, () => {
  it('pins through --handoff and refuses deploys until the round closes', async () => {
    const h = harness()
    await enter(h)
    const receipt = await runDevelopmentDeploy(
      { dryRun: false, json: false, handoff: 'Open Today and check the weather card' },
      h.context,
    )
    expect(readActivation(REPO, h.state)!.pin?.buildId).toBe(receipt.buildId)
    await expect(runDevelopmentDeploy({ dryRun: false, json: false }, h.context)).rejects.toThrow(
      /Feedback pin/u,
    )
    runDevelopmentUnpin({ feedbackRef: 'owner-comment#5' }, h.context)
    const scenario = join(h.root, 'scenario.txt')
    writeFileSync(scenario, 'Try the cash bids card\n')
    await runDevelopmentPin({ scenario }, h.context)
    expect(readActivation(REPO, h.state)!.pin?.scenario).toBe('Try the cash bids card')
  })

  it('freezes applied migration bytes and rejects later edits', async () => {
    const h = harness()
    await enter(h)
    const commit = git(h.root, 'rev-parse', 'HEAD')
    const ran: string[][] = []
    const { exitCode } = await runDevelopmentExec(
      { operation: 'migration', approvalRef: 'owner#m1', commit, argv: ['apply-migrations'] },
      { ...h.context, exec: (argv) => (ran.push(argv), 0) },
    )
    expect(exitCode).toBe(0)
    expect(ran).toEqual([['apply-migrations']])
    expect(git(h.root, 'rev-parse', `refs/narduk/development/migrations/${commit}`)).toBe(commit)
    writeFileSync(join(h.root, 'migrations', '0001_init.sql'), 'create table t (id text);\n')
    const receipt = await runDevelopmentDeploy({ dryRun: false, json: false }, h.context)
    expect(receipt.outcome).toBe('refused')
    expect(receipt.failure).toMatch(/Applied migration migrations\/0001_init.sql/u)
  })

  it('refuses a migration whose sources are not the frozen commit', async () => {
    const h = harness()
    await enter(h)
    const commit = git(h.root, 'rev-parse', 'HEAD')
    writeFileSync(join(h.root, 'migrations', '0002_next.sql'), 'alter table t add x;\n')
    await expect(
      runDevelopmentExec(
        { operation: 'migration', approvalRef: 'owner#m2', commit, argv: ['apply'] },
        { ...h.context, exec: () => 0 },
      ),
    ).rejects.toThrow(/frozen commit/u)
  })

  it('records a secret-stage version change as the new expected serving version', async () => {
    const h = harness()
    await enter(h)
    let staged = ''
    await runDevelopmentExec(
      { operation: 'secret-stage', approvalRef: 'owner#s1', argv: ['wrangler', 'secret', 'put'] },
      { ...h.context, exec: () => ((staged = h.cloudflare.drift('fixture-app')), 0) },
    )
    expect(readActivation(REPO, h.state)!.expectedServing.web).toBe(staged)
    expect((await runDevelopmentDeploy({ dryRun: false, json: false }, h.context)).outcome).toBe(
      'verified',
    )
  })

  it('transfers custody after verifying holds and serving versions', async () => {
    const h = harness()
    await enter(h)
    const bundle = runDevelopmentHandoff({ to: 'lane-b' }, h.context)
    await expect(runDevelopmentDeploy({ dryRun: false, json: false }, h.context)).rejects.toThrow(
      /suspended/u,
    )
    const receiving = { ...h.context, stateDirectory: temp('dev-state-b-') }
    await expect(runDevelopmentAccept({ bundle, publisher: 'lane-c' }, receiving)).rejects.toThrow(
      /does not transfer custody/u,
    )
    const record = await runDevelopmentAccept({ bundle, publisher: 'lane-b' }, receiving)
    expect(record.mode).toBe('active')
    expect((await runDevelopmentDeploy({ dryRun: false, json: false }, receiving)).outcome).toBe(
      'verified',
    )
  })

  it('returns to normal: validates, deploys the release, restores exact settings', async () => {
    const h = harness()
    await enter(h)
    await runDevelopmentDeploy({ dryRun: false, json: false }, h.context)
    runDevelopmentExitPrepare(h.context)
    await expect(runDevelopmentDeploy({ dryRun: false, json: false }, h.context)).rejects.toThrow(
      /exiting/u,
    )
    const release = git(h.root, 'rev-parse', 'HEAD')
    h.github.mainHead = release
    h.github.runs.push({
      id: 900,
      workflow: 3,
      status: 'completed',
      head_sha: release,
      head_branch: `narduk-validation/${release}/request`,
    })
    const closed = await runDevelopmentExitComplete(
      { releaseSha: release, validationRun: '900' },
      h.context,
    )
    expect(readActivation(REPO, h.state)).toBeUndefined()
    // The archived record points at the release receipt file, not at a build ID.
    expect(existsSync(closed.lastReceipt!)).toBe(true)
    expect(h.github.workflows.map((w) => w.state)).toEqual(['active', 'active', 'active', 'active'])
    const worker = h.cloudflare.workers.get('fixture-app')!
    expect(worker.triggers.size).toBe(1)
    const [id] = [...worker.triggers.keys()]
    expect(worker.variables.get(id)).toEqual({
      PROTECTED: { is_secret: true },
      PLAIN: { is_secret: false, value: 'prd' },
    })
    expect(worker.versions[0].annotations['workers/message']).toMatch(/narduk-app development/u)
  })

  it('keeps automation held when the release validation does not match', async () => {
    const h = harness()
    await enter(h)
    runDevelopmentExitPrepare(h.context)
    const release = git(h.root, 'rev-parse', 'HEAD')
    h.github.mainHead = release
    h.github.runs.push({
      id: 901,
      workflow: 3,
      status: 'completed',
      head_sha: 'b'.repeat(40),
      head_branch: `narduk-validation/${'b'.repeat(40)}/request`,
    })
    await expect(
      runDevelopmentExitComplete({ releaseSha: release, validationRun: '901' }, h.context),
    ).rejects.toThrow(/not successful explicit validation/u)
    expect(readActivation(REPO, h.state)!.mode).toBe('exiting')
    expect(h.github.workflows[0].state).toBe('disabled_manually')
    expect(h.cloudflare.workers.get('fixture-app')!.triggers.size).toBe(0)
  })
})

describe('development exit after a repository rename', { timeout: 30_000 }, () => {
  const RENAMED = 'narduk-enterprises/renamed-app'

  /** Enrolled under the old name; GitHub renames the repository before exit. */
  async function renamedExit(run: { repositoryId?: number }) {
    const h = harness()
    await enter(h)
    runDevelopmentExitPrepare(h.context)
    h.github.identity = { id: h.github.identity.id, full_name: RENAMED }
    const release = git(h.root, 'rev-parse', 'HEAD')
    h.github.mainHead = release
    h.github.runs.push({
      id: 902,
      workflow: 3,
      status: 'completed',
      head_sha: release,
      head_branch: `narduk-validation/${release}/request`,
      ...run,
    })
    h.github.calls.length = 0
    return { h, release }
  }

  it('accepts the validation run GitHub reports under the new name, keeping the record key', async () => {
    const { h, release } = await renamedExit({})
    // The origin still names the old repository, and so does the activation record.
    expect(git(h.root, 'remote', 'get-url', 'origin')).toBe(`git@github.com:${REPO}.git`)
    expect(readActivation(REPO, h.state)!.repository).toBe(REPO)
    const closed = await runDevelopmentExitComplete(
      { releaseSha: release, validationRun: '902' },
      h.context,
    )
    expect(closed.repository).toBe(REPO)
    expect(closed.exit?.validationRun).toBe(902)
    expect(readActivation(REPO, h.state)).toBeUndefined()
    expect(h.github.workflows.map((w) => w.state)).toEqual(['active', 'active', 'active', 'active'])
    // Identity is resolved once, and every write addresses the canonical name.
    expect(h.github.calls.filter((call) => call === `GET repos/${REPO}`)).toHaveLength(1)
    const writes = h.github.calls.filter((call) => !call.startsWith('GET'))
    expect(writes.length).toBeGreaterThan(0)
    for (const call of writes) expect(call).toMatch(new RegExp(`^\\w+ repos/${RENAMED}/`, 'u'))
  })

  it('still rejects a successful run from a genuinely different repository', async () => {
    const { h, release } = await renamedExit({ repositoryId: 9999 })
    await expect(
      runDevelopmentExitComplete({ releaseSha: release, validationRun: '902' }, h.context),
    ).rejects.toThrow(/not successful explicit validation/u)
    expect(readActivation(REPO, h.state)!.mode).toBe('exiting')
    expect(h.github.workflows[0].state).toBe('disabled_manually')
  })
})

// ─── receipts, guards, background validation and rollback ────────────────────

function deploy(h: Harness, flags: Partial<DevelopmentDeployFlags> = {}) {
  return runDevelopmentDeploy({ dryRun: false, json: false, ...flags }, h.context)
}

function patchDeployment(
  root: string,
  mutate: (development: Record<string, unknown>, deployment: Record<string, unknown>) => void,
  land = true,
): void {
  const path = join(root, 'Config', 'cloudflare-app.json')
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as {
    deployment: Record<string, unknown> & { development: Record<string, unknown> }
  }
  mutate(manifest.deployment.development, manifest.deployment)
  writeFileSync(path, JSON.stringify(manifest))
  git(root, 'add', '.')
  git(root, 'commit', '-qm', 'patch deployment declaration')
  if (land) git(root, 'update-ref', 'refs/remotes/origin/main', 'HEAD')
}

function enableRollback(root: string): void {
  patchDeployment(root, (development) => {
    development.rollback = { automatic: true, rehearsalRef: 'narduk-farm#147' }
  })
}

/** Live proof passes only for one build: the known-good version a rollback restores. */
function passProofOnlyFor(h: Harness, buildId: string): void {
  h.context.verify = async (flags) => {
    const pass = flags.expectBuildId === buildId
    return {
      result: pass ? 'PASS' : 'FAIL',
      exitCode: pass ? 0 : 4,
      attemptsUsed: 1,
      assertions: [{ id: 'build-id', status: pass ? 'pass' : 'fail' }],
    } as unknown as VerifyReport
  }
}

describe('deploy:dev receipts and background validation', { timeout: 30_000 }, () => {
  it('times every phase and step, and queues validation of the clean base commit', async () => {
    const h = harness()
    await enter(h)
    const receipt = await deploy(h)
    expect(receipt.outcome).toBe('verified')
    expect(h.github.calls.at(-1)).toMatch(/issues\?labels=red-main/u)
    expect(receipt.steps!.map((item) => item.name)).toEqual([
      'red-main',
      'inspect:web',
      'capture',
      'workspace',
      'protected-paths',
      'check:fake-check',
      'build:web',
      'assert:web',
      'schema:web:fake-schema',
      'upload:web',
      'promote:web',
      'triggers:web',
      'proof:web',
      'behavior:web',
      'queue-validation',
    ])
    expect(receipt.steps!.every((item) => item.status === 'passed' && item.seconds >= 0)).toBe(true)
    expect(Object.keys(receipt.timings)).toEqual(
      expect.arrayContaining(['guarding', 'inspecting', 'capturing', 'checking', 'building']),
    )
    expect(receipt.totalSeconds).toBeGreaterThanOrEqual(0)
    expect(h.logs.some((line) => line.startsWith('[deploy:dev] timings: total'))).toBe(true)
    expect(h.validations).toEqual([
      expect.objectContaining({
        sha: git(h.root, 'rev-parse', 'HEAD'),
        buildId: receipt.buildId,
        gated: false,
      }),
    ])
    expect(receipt.validation).toMatchObject({ status: 'queued', source: 'base-commit' })
  })

  it('records the failing check with its time', async () => {
    const h = harness()
    await enter(h)
    h.fail.add('fake-check')
    const receipt = await deploy(h)
    expect(receipt.outcome).toBe('refused')
    expect(receipt.steps!.at(-1)).toMatchObject({ name: 'check:fake-check', status: 'failed' })
    expect(receipt.timings.checking).toBeGreaterThanOrEqual(0)
    expect(h.validations).toHaveLength(0)
  })

  it('validates a dirty deploy as a capture commit of exactly what add -A stages', async () => {
    const h = harness()
    await enter(h)
    const head = git(h.root, 'rev-parse', 'HEAD')
    writeFileSync(join(h.root, 'apps/web/src/page.ts'), 'export const page = 2\n')
    writeFileSync(join(h.root, 'apps/web/src/new.ts'), 'export const fresh = true\n')
    unlinkSync(join(h.root, 'obsolete.txt'))
    const receipt = await deploy(h)
    expect(receipt.outcome).toBe('verified')
    const sha = h.validations[0].sha
    expect(sha).not.toBe(head)
    expect(receipt.validation).toMatchObject({ sha, source: 'capture-commit' })
    expect(git(h.root, 'rev-parse', `${sha}^`)).toBe(head)
    expect(git(h.root, 'show', `${sha}:apps/web/src/page.ts`)).toBe('export const page = 2')
    expect(git(h.root, 'show', `${sha}:apps/web/src/new.ts`)).toContain('fresh')
    const files = git(h.root, 'ls-tree', '-r', '--name-only', sha).split('\n')
    expect(files).not.toContain('obsolete.txt')
    expect(files).toContain('migrations/0001_init.sql')
    expect(git(h.root, 'rev-parse', 'refs/narduk/development/validation')).toBe(sha)
    // The authoring index and working tree are untouched.
    expect(git(h.root, 'status', '--porcelain')).toMatch(/D obsolete\.txt/u)
  })

  it('queues nothing after an unproven deploy', async () => {
    const h = harness()
    await enter(h)
    h.proofFails.add('https://fixture-app.example.com')
    expect((await deploy(h)).outcome).toBe('unproven')
    expect(h.validations).toHaveLength(0)
  })
})

describe('deploy:dev protected paths and red main', { timeout: 30_000 }, () => {
  it('refuses protected-path changes unless --gated, then diffs from that capture', async () => {
    const h = harness()
    await enter(h)
    mkdirSync(join(h.root, 'apps/web/src/auth'), { recursive: true })
    writeFileSync(join(h.root, 'apps/web/src/auth/login.ts'), 'export const login = 1\n')
    const refused = await deploy(h)
    expect(refused.outcome).toBe('refused')
    expect(refused.failure).toMatch(
      /Protected changes since origin\/main merge base [a-f0-9]{12}: apps\/web\/src\/auth\/login\.ts/u,
    )
    expect(h.uploads).toBe(0)
    const gated = await deploy(h, { gated: true })
    expect(gated.outcome).toBe('verified')
    expect(gated.gate).toMatchObject({
      gated: true,
      protectedPaths: ['apps/web/src/auth/login.ts'],
    })
    expect(h.validations.at(-1)).toMatchObject({ gated: true })
    writeFileSync(join(h.root, 'apps/web/src/page.ts'), 'export const page = 3\n')
    const next = await deploy(h)
    expect(next.outcome).toBe('verified')
    expect(next.gate).toMatchObject({
      base: `last verified ${gated.buildId}`,
      changed: 1,
      protectedPaths: [],
    })
  })

  it('protects migrations, bindings and Durable Objects, but not trigger edits', async () => {
    const h = harness()
    await enter(h)
    expect((await deploy(h)).outcome).toBe('verified')
    writeFileSync(join(h.root, 'migrations', '0002_add.sql'), 'alter table t add column x;\n')
    expect((await deploy(h)).failure).toMatch(/migrations\/0002_add\.sql/u)
    unlinkSync(join(h.root, 'migrations', '0002_add.sql'))
    const wrangler = join(h.root, 'apps/web/wrangler.jsonc')
    const config = JSON.parse(readFileSync(wrangler, 'utf8')) as Record<string, unknown>
    writeFileSync(wrangler, JSON.stringify({ ...config, triggers: { crons: ['0 1 * * *'] } }))
    expect((await deploy(h)).outcome).toBe('verified')
    writeFileSync(
      wrangler,
      JSON.stringify({ ...config, d1_databases: [{ binding: 'DB', database_id: 'x' }] }),
    )
    const binding = await deploy(h)
    expect(binding.failure).toMatch(/web: Worker bindings changed/u)
    expect(binding.failure).not.toMatch(/Durable Object/u)
    writeFileSync(
      wrangler,
      JSON.stringify({
        ...config,
        durable_objects: { bindings: [{ name: 'R', class_name: 'R' }] },
      }),
    )
    expect((await deploy(h)).failure).toMatch(/web: Durable Object bindings or class migrations/u)
  })

  it('refuses without a base to diff against, unless --gated', async () => {
    const h = harness()
    await enter(h)
    git(h.root, 'update-ref', '-d', 'refs/remotes/origin/main')
    expect((await deploy(h)).failure).toMatch(/No base to diff this capture against/u)
    expect((await deploy(h, { gated: true })).outcome).toBe('verified')
  })

  it('refuses after 24 h of red main unless the deploy names the fix', async () => {
    const h = harness()
    await enter(h)
    const old = new Date(Date.now() - 25 * 3_600_000).toISOString()
    h.github.redMain = [
      { number: 12, title: 'main is red: ci', created_at: old },
      { number: 13, title: 'a pull request', created_at: old, pull_request: {} },
    ]
    const refused = await deploy(h)
    expect(refused.outcome).toBe('refused')
    expect(refused.failure).toMatch(/main has been red for more than 24 h: #12 "main is red: ci"/u)
    expect(refused.redMain).toMatchObject({ status: 'red', open: [12], stale: [12] })
    expect(h.uploads).toBe(0)
    expect((await deploy(h, { redMainFix: 99 })).failure).toMatch(/names no open red-main issue/u)
    const fix = await deploy(h, { redMainFix: 12 })
    expect(fix.outcome).toBe('verified')
    expect(fix.redMain).toMatchObject({ status: 'fix', fix: 12 })
    h.github.redMain = [
      { number: 14, title: 'main is red: e2e', created_at: new Date().toISOString() },
    ]
    const fresh = await deploy(h)
    expect(fresh.outcome).toBe('verified')
    expect(fresh.redMain).toMatchObject({ status: 'red', open: [14], stale: [] })
    h.github.redMain = []
    expect((await deploy(h)).redMain?.status).toBe('clear')
    h.github.redMainUnavailable = true
    const unknown = await deploy(h)
    expect(unknown.outcome).toBe('verified')
    expect(unknown.redMain?.status).toBe('unknown')
  })

  it('skips the guards for the validated exit release', async () => {
    const h = harness()
    await enter(h)
    h.github.redMain = [{ number: 12, title: 'main is red', created_at: new Date(0).toISOString() }]
    runDevelopmentExitPrepare(h.context)
    const release = git(h.root, 'rev-parse', 'HEAD')
    const receipt = await runDevelopmentDeploy(
      { dryRun: false, json: false, releaseSha: release },
      h.context,
    )
    expect(receipt.outcome).toBe('verified')
    expect(receipt.redMain).toBeUndefined()
    expect(h.validations).toHaveLength(0)
  })
})

describe('development-mode rollback', { timeout: 30_000 }, () => {
  it('stays off by default and names the manual command', async () => {
    const h = harness()
    await enter(h)
    const good = await deploy(h)
    h.proofFails.add('https://fixture-app.example.com')
    const bad = await deploy(h)
    expect(bad.outcome).toBe('unproven')
    expect(bad.rollback).toEqual({ decision: 'off', target: good.buildId })
    expect(h.cloudflare.serving('fixture-app')).toBe(bad.components.web.candidateVersionId)
    expect(h.logs.join('\n')).toContain(`narduk-app development rollback --to ${good.buildId}`)
  })

  it('rolls a failed proof back to the last verified build once switched on', async () => {
    const h = harness()
    enableRollback(h.root)
    await enter(h)
    const good = await deploy(h)
    const verify = h.context.verify
    passProofOnlyFor(h, good.buildId)
    const bad = await deploy(h)
    expect(bad.outcome).toBe('rolled-back')
    expect(bad.rollback).toEqual({ decision: 'rolled-back', target: good.buildId })
    expect(bad.components.web.servingVersionId).toBe(good.components.web.servingVersionId)
    expect(h.cloudflare.serving('fixture-app')).toBe(good.components.web.servingVersionId)
    const record = readActivation(REPO, h.state)!
    expect(record.expectedServing.web).toBe(good.components.web.servingVersionId)
    expect(record.knownGood[0]).toBe(good.buildId)
    expect(record.history.at(-1)?.event).toBe('deploy-rolled-back')
    h.context.verify = verify
    expect((await deploy(h)).outcome).toBe('verified')
  })

  it('pages instead of rolling back across a binding change', async () => {
    const h = harness()
    enableRollback(h.root)
    await enter(h)
    const good = await deploy(h)
    const wrangler = join(h.root, 'apps/web/wrangler.jsonc')
    const config = JSON.parse(readFileSync(wrangler, 'utf8')) as Record<string, unknown>
    writeFileSync(
      wrangler,
      JSON.stringify({ ...config, kv_namespaces: [{ binding: 'KV', id: 'k' }] }),
    )
    passProofOnlyFor(h, good.buildId)
    const bad = await deploy(h, { gated: true })
    expect(bad.outcome).toBe('unproven')
    expect(bad.rollback).toMatchObject({ decision: 'page', target: good.buildId })
    expect(bad.rollback?.reasons?.join('; ')).toMatch(/web: Worker bindings changed/u)
    expect(h.cloudflare.serving('fixture-app')).toBe(bad.components.web.candidateVersionId)
    expect(h.logs.join('\n')).toMatch(/PAGE: proof failed and a rollback is not safe/u)
  })

  it('pages across a migration not proven expand-only, and rolls back across one that is', async () => {
    const h = harness()
    enableRollback(h.root)
    await enter(h)
    const good = await deploy(h)
    const record = readActivation(REPO, h.state)!
    record.appliedMigrations.push({
      commit: 'c'.repeat(40),
      ref: 'refs/narduk/development/migrations/legacy',
      approvalRef: 'owner#legacy',
      appliedAt: new Date(Date.now() + 1000).toISOString(),
      files: [],
    })
    writeActivation(record, h.state)
    passProofOnlyFor(h, good.buildId)
    const paged = await deploy(h)
    expect(paged.rollback?.decision).toBe('page')
    expect(paged.rollback?.reasons?.join('; ')).toMatch(/not proven expand-only/u)

    const next = harness()
    enableRollback(next.root)
    await enter(next)
    const verified = await deploy(next)
    writeFileSync(join(next.root, 'migrations', '0002_add.sql'), 'alter table t add column x;\n')
    git(next.root, 'add', '.')
    git(next.root, 'commit', '-qm', 'expand')
    const commit = git(next.root, 'rev-parse', 'HEAD')
    const { record: applied } = await runDevelopmentExec(
      { operation: 'migration', approvalRef: 'owner#m', commit, argv: ['apply'] },
      { ...next.context, exec: () => 0 },
    )
    expect(applied.appliedMigrations.at(-1)?.compatibility).toBe('expand-only')
    passProofOnlyFor(next, verified.buildId)
    const rolled = await deploy(next, { gated: true })
    expect(rolled.outcome).toBe('rolled-back')
  })

  it('pages when no verified build is recorded', async () => {
    const h = harness()
    enableRollback(h.root)
    await enter(h)
    h.proofFails.add('https://fixture-app.example.com')
    const bad = await deploy(h)
    expect(bad.outcome).toBe('unproven')
    expect(bad.rollback).toMatchObject({ decision: 'page' })
    expect(bad.rollback?.reasons).toEqual(['no verified build is recorded on this workstation'])
  })

  it('rolls back by hand to a known-good build, proves it, then rolls forward', async () => {
    const h = harness()
    await enter(h)
    const first = await deploy(h)
    writeFileSync(join(h.root, 'apps/web/src/page.ts'), 'export const page = 2\n')
    const second = await deploy(h)
    await expect(
      runDevelopmentRollback({ to: 'dev-unknown', dryRun: false }, h.context),
    ).rejects.toThrow(/known-good build/u)
    await runDevelopmentRollback({ to: first.buildId, dryRun: true }, h.context)
    expect(h.cloudflare.serving('fixture-app')).toBe(second.components.web.servingVersionId)
    const plan = await runDevelopmentRollback({ to: first.buildId, dryRun: false }, h.context)
    expect(plan.kind).toBe('rollback')
    expect(h.cloudflare.serving('fixture-app')).toBe(first.components.web.servingVersionId)
    const record = readActivation(REPO, h.state)!
    expect(record.knownGood).toEqual([first.buildId, second.buildId])
    expect(record.expectedServing.web).toBe(first.components.web.servingVersionId)
    await expect(
      runDevelopmentRollback({ to: first.buildId, dryRun: false }, h.context),
    ).rejects.toThrow(/already serves/u)
    expect((await deploy(h)).outcome).toBe('verified')
  })
})

describe('development-mode migrations are expand-only (12.9)', { timeout: 30_000 }, () => {
  it('refuses a migration that drops what serving code reads', async () => {
    const h = harness()
    await enter(h)
    writeFileSync(join(h.root, 'migrations', '0002_drop.sql'), 'drop table t;\n')
    git(h.root, 'add', '.')
    git(h.root, 'commit', '-qm', 'drop')
    const commit = git(h.root, 'rev-parse', 'HEAD')
    const ran: string[][] = []
    await expect(
      runDevelopmentExec(
        { operation: 'migration', approvalRef: 'owner#m', commit, argv: ['apply'] },
        { ...h.context, exec: (argv) => (ran.push(argv), 0) },
      ),
    ).rejects.toThrow(
      /migrations\/0002_drop\.sql:1 drops table t\. Development-mode migrations are expand-only/u,
    )
    expect(ran).toEqual([])
    expect(readActivation(REPO, h.state)!.appliedMigrations).toEqual([])
  })

  it('applies a reviewed contract migration only once it has landed', async () => {
    const h = harness()
    writeFileSync(join(h.root, 'migrations', '0002_drop.sql'), 'drop table t;\n')
    const digest = createHash('sha256').update('drop table t;\n').digest('hex')
    patchDeployment(
      h.root,
      (_development, deployment) => {
        deployment.migrations = {
          compatibility: 'expand-contract',
          credential: 'cloudflare/prd/fixture-app-migrate',
          databases: [{ binding: 'DB', sources: 'migrations.sources.json' }],
          contractMigrations: [
            { path: 'migrations/0002_drop.sql', sha256: digest, reason: 'no version reads t' },
          ],
        }
      },
      false,
    )
    await enter(h)
    const commit = git(h.root, 'rev-parse', 'HEAD')
    const exec = { ...h.context, exec: () => 0 }
    const flags = {
      operation: 'migration' as const,
      approvalRef: 'owner#m',
      commit,
      argv: ['apply'],
    }
    await expect(runDevelopmentExec(flags, exec)).rejects.toThrow(/has not landed on main/u)
    git(h.root, 'update-ref', 'refs/remotes/origin/main', 'HEAD')
    const { record } = await runDevelopmentExec(flags, exec)
    expect(record.appliedMigrations.at(-1)?.compatibility).toBe('contract')
  })

  it('does not re-judge what normal delivery shipped before enrollment', async () => {
    const h = harness()
    // History from before development mode: a drizzle-style table rebuild.
    writeFileSync(join(h.root, 'migrations', '0002_rebuild.sql'), 'drop table t;\n')
    git(h.root, 'add', '.')
    git(h.root, 'commit', '-qm', 'rebuild')
    git(h.root, 'update-ref', 'refs/remotes/origin/main', 'HEAD')
    const baseline = git(h.root, 'rev-parse', 'HEAD')
    await enter(h)
    expect(readActivation(REPO, h.state)!.migrationBaseline?.commit).toBe(baseline)
    writeFileSync(join(h.root, 'migrations', '0003_add.sql'), 'alter table t add column x;\n')
    git(h.root, 'add', '.')
    git(h.root, 'commit', '-qm', 'expand')
    const exec = { ...h.context, exec: () => 0 }
    const run = (commit: string) =>
      runDevelopmentExec(
        { operation: 'migration', approvalRef: 'owner#m', commit, argv: ['apply'] },
        exec,
      )
    const { record } = await run(git(h.root, 'rev-parse', 'HEAD'))
    expect(record.appliedMigrations.at(-1)?.compatibility).toBe('expand-only')
    // Editing a shipped file makes it pending again, and it is judged.
    writeFileSync(join(h.root, 'migrations', '0002_rebuild.sql'), 'drop table t;\ndrop table u;\n')
    git(h.root, 'add', '.')
    git(h.root, 'commit', '-qm', 'edit shipped')
    await expect(run(git(h.root, 'rev-parse', 'HEAD'))).rejects.toThrow(
      /0002_rebuild\.sql:1 drops table t/u,
    )
  })

  const refresh = (h: Harness) =>
    runDevelopmentEnter(
      { approvalRef: 'owner-approval#1', publisher: 'lane-a', refresh: true, dryRun: false },
      h.context,
    )
  const migrate = (h: Harness) =>
    runDevelopmentExec(
      {
        operation: 'migration',
        approvalRef: 'owner#m',
        commit: git(h.root, 'rev-parse', 'HEAD'),
        argv: ['apply'],
      },
      { ...h.context, exec: () => 0 },
    )
  const forgetBaseline = (h: Harness) => {
    const legacy = readActivation(REPO, h.state)!
    delete legacy.migrationBaseline
    writeActivation(legacy, h.state)
  }

  it('an enrollment without a baseline recovers it from the reflog as of before entry', async () => {
    const h = harness()
    writeFileSync(join(h.root, 'migrations', '0002_rebuild.sql'), 'drop table t;\n')
    git(h.root, 'add', '.')
    git(h.root, 'commit', '-qm', 'rebuild')
    const shipped = git(h.root, 'rev-parse', 'HEAD')
    fetchedAnHourAgo(h.root)
    await enter(h)
    forgetBaseline(h)
    await expect(migrate(h)).rejects.toThrow(
      /records no pre-enrollment baseline.*reflog of origin\/main.*fetching now does not help/u,
    )
    await refresh(h)
    expect(readActivation(REPO, h.state)!.migrationBaseline).toMatchObject({
      commit: shipped,
      source: 'reflog',
    })
    expect((await migrate(h)).record.appliedMigrations).toHaveLength(1)
  })

  it('never takes as shipped a migration that landed while the hold was on', async () => {
    const h = harness()
    const beforeHold = git(h.root, 'rev-parse', 'HEAD')
    fetchedAnHourAgo(h.root)
    await enter(h)
    forgetBaseline(h)
    // Lands on the production branch during the hold: ci.yml (and its 12.9
    // check) is held, so nothing ever judged it.
    writeFileSync(join(h.root, 'migrations', '0009_drop.sql'), 'drop table t;\n')
    git(h.root, 'add', '.')
    git(h.root, 'commit', '-qm', 'drop during hold')
    git(h.root, 'update-ref', 'refs/remotes/origin/main', 'HEAD')
    await expect(migrate(h)).rejects.toThrow(/0009_drop\.sql:1 drops table t/u)
    await refresh(h)
    expect(readActivation(REPO, h.state)!.migrationBaseline?.commit).toBe(beforeHold)
    await expect(migrate(h)).rejects.toThrow(/0009_drop\.sql:1 drops table t/u)
  })

  it('records nothing when the reflog does not reach back before entry', async () => {
    const h = harness()
    // Unfetched at entry; deleting the ref drops its reflog too.
    git(h.root, 'update-ref', '-d', 'refs/remotes/origin/main')
    await enter(h)
    expect(readActivation(REPO, h.state)!.migrationBaseline).toBeUndefined()
    writeFileSync(join(h.root, 'migrations', '0009_drop.sql'), 'drop table t;\n')
    git(h.root, 'add', '.')
    git(h.root, 'commit', '-qm', 'drop during hold')
    // The only reflog entry is a fetch during the hold.
    git(h.root, 'update-ref', 'refs/remotes/origin/main', 'HEAD')
    await refresh(h)
    expect(readActivation(REPO, h.state)!.migrationBaseline).toBeUndefined()
    await expect(migrate(h)).rejects.toThrow(/0009_drop\.sql:1 drops table t/u)
  })

  it('a fresh entry pins the baseline before the hold, even when resumed after a landing', async () => {
    const h = harness()
    const beforeHold = git(h.root, 'rev-parse', 'HEAD')
    h.github.runs.push({ id: 72, workflow: 2, status: 'in_progress' })
    await expect(enter(h)).rejects.toThrow(/still settling/u)
    expect(readActivation(REPO, h.state)!.migrationBaseline).toMatchObject({
      commit: beforeHold,
      source: 'hold',
    })
    writeFileSync(join(h.root, 'migrations', '0009_drop.sql'), 'drop table t;\n')
    git(h.root, 'add', '.')
    git(h.root, 'commit', '-qm', 'drop during hold')
    git(h.root, 'update-ref', 'refs/remotes/origin/main', 'HEAD')
    h.github.runs[0].status = 'completed'
    await enter(h)
    expect(readActivation(REPO, h.state)!.migrationBaseline?.commit).toBe(beforeHold)
    await expect(migrate(h)).rejects.toThrow(/0009_drop\.sql:1 drops table t/u)
  })

  it('judges pre-enrollment history for an expand-contract app (narduk-farm shape)', async () => {
    const h = harness()
    // narduk-farm's declaration: expand-contract, no contractMigrations waivers.
    patchDeployment(h.root, (_development, deployment) => {
      deployment.migrations = {
        compatibility: 'expand-contract',
        credential: 'cloudflare/prd/fixture-app-migrate',
        databases: [{ binding: 'DB', sources: 'migrations.sources.json' }],
      }
    })
    // Merged under "CI after": foundation 12.9 FAILS this on main, but it
    // landed before enrollment, so it sits inside the baseline.
    writeFileSync(join(h.root, 'migrations', '0002_drop.sql'), 'drop table t;\n')
    git(h.root, 'add', '.')
    git(h.root, 'commit', '-qm', 'unwaived drop')
    git(h.root, 'update-ref', 'refs/remotes/origin/main', 'HEAD')
    const baseline = git(h.root, 'rev-parse', 'HEAD')
    await enter(h)
    expect(readActivation(REPO, h.state)!.migrationBaseline?.commit).toBe(baseline)
    writeFileSync(join(h.root, 'migrations', '0003_add.sql'), 'alter table t add column x;\n')
    git(h.root, 'add', '.')
    git(h.root, 'commit', '-qm', 'expand')
    const ran: string[][] = []
    await expect(
      runDevelopmentExec(
        {
          operation: 'migration',
          approvalRef: 'owner#m',
          commit: git(h.root, 'rev-parse', 'HEAD'),
          argv: ['apply'],
        },
        { ...h.context, exec: (argv) => (ran.push(argv), 0) },
      ),
    ).rejects.toThrow(
      /0002_drop\.sql:1 drops table t\..*declares deployment\.migrations \(expand-contract\), so every file is judged/u,
    )
    expect(ran).toEqual([])
    expect(readActivation(REPO, h.state)!.appliedMigrations).toEqual([])
    // Reviewed and waived on the production branch: the baseline file is then
    // applied as a contract migration, so rollback pages across it.
    const digest = createHash('sha256').update('drop table t;\n').digest('hex')
    patchDeployment(h.root, (_development, deployment) => {
      ;(deployment.migrations as { contractMigrations?: unknown[] }).contractMigrations = [
        { path: 'migrations/0002_drop.sql', sha256: digest, reason: 'no version reads t' },
      ]
    })
    const { record } = await migrate(h)
    expect(record.appliedMigrations.at(-1)?.compatibility).toBe('contract')
  })
})

describe('background validation worker', () => {
  const sha = (char: string) => char.repeat(40)
  const request = (checkout: string, char: string, buildId: string): DeployedValidationRequest => ({
    repository: REPO,
    checkout,
    sha: sha(char),
    buildId,
    reason: 'verified development deploy',
    gated: false,
    queuedAt: new Date().toISOString(),
  })

  it('pushes only the newest queued commit and cancels what it supersedes', () => {
    const state = temp('dev-validation-')
    const pushed: string[] = []
    const cancelled: number[] = []
    const deleted: string[] = []
    const github = {
      requestDeployedValidation: (_cwd: string, value: string) => {
        const ref = `narduk-validation/${value}/${pushed.length}`
        pushed.push(ref)
        return ref
      },
      activeValidationRuns: (ref: string) => (ref.includes(sha('b')) ? [77] : []),
      cancelRun: (id: number) => {
        cancelled.push(id)
      },
      deleteValidationRef: (_cwd: string, ref: string) => {
        deleted.push(ref)
      },
    }
    const log = (): void => undefined
    enqueueDeployedValidation(request(state, 'a', 'dev-1'), state)
    enqueueDeployedValidation(request(state, 'b', 'dev-2'), state)
    expect(
      drainDeployedValidations({ repository: REPO, stateDirectory: state, github, log }),
    ).toEqual([`narduk-validation/${sha('b')}/0`])
    enqueueDeployedValidation(request(state, 'c', 'dev-3'), state)
    drainDeployedValidations({ repository: REPO, stateDirectory: state, github, log })
    expect(cancelled).toEqual([77])
    // Only the newest automatic validation branch stays on GitHub.
    expect(deleted).toEqual([`narduk-validation/${sha('b')}/0`])
    const history = readValidationHistory(state, REPO)
    expect(
      history.map((entry) => [
        entry.buildId,
        Boolean(entry.supersededAt),
        Boolean(entry.branchDeletedAt),
      ]),
    ).toEqual([
      ['dev-2', true, true],
      ['dev-3', false, false],
    ])
  })

  it('retries a failed branch delete on the next drain', () => {
    const state = temp('dev-validation-')
    let failDelete = true
    const deleted: string[] = []
    const github = {
      requestDeployedValidation: (_cwd: string, value: string) => `narduk-validation/${value}/x`,
      activeValidationRuns: (): number[] => [],
      cancelRun: (): void => undefined,
      deleteValidationRef: (_cwd: string, ref: string) => {
        if (failDelete) throw new Error('offline')
        deleted.push(ref)
      },
    }
    const drain = () =>
      drainDeployedValidations({ repository: REPO, stateDirectory: state, github, log: () => {} })
    enqueueDeployedValidation(request(state, 'a', 'dev-1'), state)
    drain()
    enqueueDeployedValidation(request(state, 'b', 'dev-2'), state)
    drain()
    expect(readValidationHistory(state, REPO)[0].branchDeletedAt).toBeUndefined()
    failDelete = false
    enqueueDeployedValidation(request(state, 'c', 'dev-3'), state)
    drain()
    expect(deleted).toEqual([`narduk-validation/${sha('a')}/x`, `narduk-validation/${sha('b')}/x`])
  })

  it('keeps an undeleted branch in history past the entry limit until it is deleted', () => {
    const state = temp('dev-validation-')
    let failPush = false
    let failDelete = true
    const deleted: string[] = []
    const github = {
      requestDeployedValidation: (_cwd: string, value: string) => {
        if (failPush) throw new Error('push rejected')
        return `narduk-validation/${value}/x`
      },
      activeValidationRuns: (): number[] => [],
      cancelRun: (): void => undefined,
      deleteValidationRef: (_cwd: string, ref: string) => {
        if (failDelete) throw new Error('offline')
        deleted.push(ref)
      },
    }
    const drain = () =>
      drainDeployedValidations({
        repository: REPO,
        stateDirectory: state,
        github,
        log: () => {},
        retryDelayMs: 0,
      })
    const buildIds = () => readValidationHistory(state, REPO).map((entry) => entry.buildId)
    enqueueDeployedValidation(request(state, 'a', 'dev-a'), state)
    drain()
    // b supersedes a, whose delete fails; then 25 pushes fail outright.
    enqueueDeployedValidation(request(state, 'b', 'dev-b'), state)
    drain()
    failPush = true
    for (let index = 0; index < 25; index += 1) {
      enqueueDeployedValidation(request(state, 'd', `dev-d${index}`), state)
      drain()
    }
    expect(buildIds()).toHaveLength(22)
    expect(buildIds().slice(0, 2)).toEqual(['dev-a', 'dev-b'])
    failPush = false
    failDelete = false
    enqueueDeployedValidation(request(state, 'e', 'dev-e'), state)
    drain()
    expect(deleted).toEqual([`narduk-validation/${sha('a')}/x`, `narduk-validation/${sha('b')}/x`])
    expect(buildIds()).toHaveLength(20)
    expect(buildIds()).not.toContain('dev-a')
  })

  it('records a push that never succeeds instead of dropping it', () => {
    const state = temp('dev-validation-')
    let attempts = 0
    const cancelled: number[] = []
    const github = {
      requestDeployedValidation: (_cwd: string, value: string) => {
        if (value === sha('b')) {
          attempts += 1
          throw new Error('Validation-ref push was not confirmed')
        }
        return `narduk-validation/${value}/x`
      },
      activeValidationRuns: (): number[] => [5],
      cancelRun: (id: number) => {
        cancelled.push(id)
      },
      deleteValidationRef: (): void => undefined,
    }
    const args = {
      repository: REPO,
      stateDirectory: state,
      github,
      log: (): void => undefined,
      retryDelayMs: 0,
    }
    enqueueDeployedValidation(request(state, 'a', 'dev-1'), state)
    drainDeployedValidations(args)
    enqueueDeployedValidation(request(state, 'b', 'dev-2'), state)
    expect(drainDeployedValidations(args)).toEqual([])
    expect(attempts).toBe(2)
    // Nothing newer was pushed, so the older validation keeps running.
    expect(cancelled).toEqual([])
    const history = readValidationHistory(state, REPO)
    expect(history.at(-1)).toMatchObject({
      buildId: 'dev-2',
      failed: { attempts: 2, error: 'Validation-ref push was not confirmed' },
    })
    expect(history.at(-1)?.validationRef).toBeUndefined()
    expect(history[0].supersededAt).toBeUndefined()
  })

  it('leaves the queue to a live worker', () => {
    const state = temp('dev-validation-')
    const lock = join(validationDirectory(state, REPO), 'worker.lock')
    mkdirSync(lock, { recursive: true, mode: 0o700 })
    writePrivateJson(join(lock, 'owner.json'), {
      pid: process.pid,
      workstation: hostname(),
      startedAt: new Date().toISOString(),
    })
    enqueueDeployedValidation(request(state, 'a', 'dev-1'), state)
    const github = {
      requestDeployedValidation: (): string => {
        throw new Error('must not push')
      },
      activeValidationRuns: (): number[] => [],
      cancelRun: (): void => undefined,
      deleteValidationRef: (): void => undefined,
    }
    expect(
      drainDeployedValidations({
        repository: REPO,
        stateDirectory: state,
        github,
        log: (): void => undefined,
      }),
    ).toEqual([])
    expect(existsSync(join(validationDirectory(state, REPO), 'queue.json'))).toBe(true)
  })
})

describe('guard building blocks', () => {
  it('matches ** across directories and * within one segment', () => {
    expect(
      matchProtectedPaths(
        [
          'apps/web/server/auth/login.ts',
          'auth/x.ts',
          'apps/web/authz.ts',
          'migrations/0001.sql',
          'a/migrations/0001.sql',
        ],
        ['**/auth/**', 'migrations/**'],
      ),
    ).toEqual(['apps/web/server/auth/login.ts', 'auth/x.ts', 'migrations/0001.sql'])
    expect(globToRegExp('apps/*/wrangler.jsonc').test('apps/web/wrangler.jsonc')).toBe(true)
    expect(globToRegExp('apps/*/wrangler.jsonc').test('apps/web/x/wrangler.jsonc')).toBe(false)
    expect(globToRegExp('**/*.sql').test('0001.sql')).toBe(true)
    expect(globToRegExp('a?c').test('abc')).toBe(true)
    expect(globToRegExp('a.c').test('abc')).toBe(false)
  })

  it('requires a rehearsal reference before automatic rollback can be switched on', () => {
    expect(() =>
      developmentSchema.parse({ ...developmentFixture(), rollback: { automatic: true } }),
    ).toThrow(/live rollback rehearsal/u)
    expect(
      developmentSchema.parse({
        ...developmentFixture(),
        rollback: { automatic: true, rehearsalRef: 'narduk-farm#147' },
      }).rollback,
    ).toEqual({ automatic: true, rehearsalRef: 'narduk-farm#147' })
    // Absent stays absent, so enrolled apps keep their declaration digest.
    expect('protectedPaths' in developmentFixture()).toBe(false)
    expect('rollback' in developmentFixture()).toBe(false)
  })

  it('parses --gated and --red-main-fix', () => {
    expect(parseDevelopmentDeployArgs(['--gated', '--red-main-fix', '#12'])).toMatchObject({
      gated: true,
      redMainFix: 12,
    })
    expect(() => parseDevelopmentDeployArgs(['--red-main-fix', 'soon'])).toThrow(/issue number/u)
    expect(DEVELOPMENT_USAGE.join('\n')).toMatch(/development rollback --to/u)
  })
})

/** Records the validation push instead of running `git push`. */
class NoPushGitHub extends DevelopmentGitHub {
  pushed: string[] = []
  override requestValidation(
    _cwd: string,
    branch: string,
    sha: string,
    reason: string,
    beforePush: Parameters<DevelopmentGitHub['requestValidation']>[4],
  ): string {
    const validationRef = `narduk-validation/${sha}/fixture`
    beforePush({ branch, sha, reason, validationRef })
    this.pushed.push(validationRef)
    return validationRef
  }
}

describe('development validate on a host without the activation record', () => {
  const flags = { ref: 'feature', sha: 'a'.repeat(40), reason: 'PR needs ci / Required' }
  function noPush(h: Harness): NoPushGitHub {
    const client = new NoPushGitHub(REPO, h.github.request)
    h.context.github = () => client
    return client
  }

  it('refuses, naming the evidence, while normal CI is running', async () => {
    const h = harness()
    const client = noPush(h)
    expect(() => runDevelopmentValidate(flags, h.context)).toThrow(
      /^Not enrolled: none of \.github\/workflows\/ci\.yml, \.github\/workflows\/promote\.yml is held on GitHub/u,
    )
    expect(client.pushed).toEqual([])
    expect(formatStatus(await runDevelopmentStatus({ remote: true }, h.context))).toBe(
      `${REPO}: normal delivery (not enrolled in development mode on this workstation)`,
    )
  })

  it('validates when GitHub shows the CI held by another workstation', async () => {
    const h = harness()
    const client = noPush(h)
    for (const workflow of h.github.workflows.slice(0, 2)) workflow.state = 'disabled_manually'
    const validationRef = runDevelopmentValidate(flags, h.context)
    expect(client.pushed).toEqual([validationRef])
    expect(h.logs.join('\n')).toMatch(
      /ci\.yml \(disabled_manually\), .*promote\.yml \(disabled_manually\): CI is held by an enrollment on another workstation/u,
    )
    expect(readActivation(REPO, h.state)).toBeUndefined()
    const status = formatStatus(await runDevelopmentStatus({ remote: true }, h.context))
    expect(status).toContain(
      '  held on GitHub: .github/workflows/ci.yml (disabled_manually), .github/workflows/promote.yml (disabled_manually)',
    )
    expect(status).toContain('run development validate for a full CI result')
  })
})
