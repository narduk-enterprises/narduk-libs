import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
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
import type { DevelopmentCommand } from '../src/development-config.js'
import { runDevelopmentDeploy, type DevelopmentContext } from '../src/development-deploy.js'
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
  runDevelopmentStatus,
  runDevelopmentUnpin,
  type LifecycleContext,
} from '../src/development-lifecycle.js'
import { DevelopmentCloudflare } from '../src/development-provider.js'
import { readActivation, writeActivation } from '../src/development-records.js'
import { acquireTargetLocks, readPrivateJson } from '../src/development-state.js'
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
  }
  mkdirSync(join(root, 'Config'))
  mkdirSync(join(root, 'migrations'))
  writeFileSync(join(root, 'migrations', '0001_init.sql'), 'create table t (id integer);\n')
  writeFileSync(join(root, 'package.json'), JSON.stringify({ packageManager: 'pnpm@10.33.4' }))
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
      })
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
  }> = []
  calls: string[] = []
  mainHead = ''
  request = (path: string, method = 'GET'): unknown => {
    this.calls.push(`${method} ${path}`)
    const url = new URL(`https://api.github.com/${path}`)
    const route = url.pathname.replace(`/repos/${REPO}/`, '')
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
        html_url: `https://github.com/${REPO}/actions/runs/${run.id}`,
        run_attempt: 1,
        repository: { full_name: REPO },
        head_repository: { full_name: REPO },
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
  fail: Set<string>
  proofFails: Set<string>
  registryToken: Record<string, string | undefined>
  context: LifecycleContext & DevelopmentContext
  logs: string[]
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
    fail: new Set(),
    proofFails: new Set(),
    registryToken: {},
    logs: [],
    context: {},
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
      h.uploads += 1
      if (!env?.CLOUDFLARE_API_TOKEN) throw new Error('upload lacked deployment credential')
      const name = JSON.parse(readFileSync(join(appDir ?? '', 'wrangler.jsonc'), 'utf8'))
        .name as string
      cloudflare.upload(name, args[2]!, args[4]!)
      return 0
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

describe('deploy:dev transaction', { timeout: 30_000 }, () => {
  it('deploys dirty edits, deletions and untracked source without GitHub access', async () => {
    const h = harness()
    await enter(h)
    const githubCalls = h.github.calls.length
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
