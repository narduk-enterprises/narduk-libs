import { spawn, spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { createCiWorkflow } from '../src/ci-workflow.js'
import {
  FROZEN_INSTALL_COMMAND,
  JOB_PNPM_STORE_ENV,
  JOB_PNPM_STORE_STEP_NAME,
} from '../src/install-policy.js'
import { createMigrationWorkflowFiles } from '../src/migration-workflows.js'

/**
 * The install policy of every generated GitHub job (install-policy.ts,
 * agent-infrastructure#3549). The first block reads the rendered YAML; the
 * second executes the emitted steps with the real pnpm against disposable
 * fixtures, because a string match cannot show which store pnpm picks.
 */

interface Step {
  name?: string
  uses?: string
  run?: string
  with?: Record<string, unknown>
  env?: Record<string, string>
  'working-directory'?: string
}

function ciJobs(visibility: 'public' | 'private'): Record<string, { steps: Step[] }> {
  return parse(createCiWorkflow(visibility)).jobs
}

function migrationJobs(): Record<string, Step[]> {
  const files = new Map(createMigrationWorkflowFiles('private').map((f) => [f.path, f.contents]))
  return {
    'ci-d1-bundle': parse(files.get('docs/deployment/ci-d1-bundle.job.yml')!).jobs['d1-bundle']
      .steps,
    'preview-d1': parse(files.get('docs/deployment/preview-d1.yml')!).jobs.migrate.steps,
  }
}

const indexOfStep = (steps: Step[], pick: (step: Step) => boolean): number => steps.findIndex(pick)

describe('rendered install policy', () => {
  const generatedSetupJobs = (): Array<[string, Step[]]> => [
    ...Object.entries(ciJobs('public'))
      .filter(([, job]) => job.steps.some((s) => s.run?.includes(FROZEN_INSTALL_COMMAND)))
      .map(([name, job]): [string, Step[]] => [`ci:${name}`, job.steps]),
    ...Object.entries(migrationJobs()).map(([name, steps]): [string, Step[]] => [
      `migration:${name}`,
      steps,
    ]),
  ]

  it('covers the three public CI jobs and both migration jobs', () => {
    expect(generatedSetupJobs().map(([name]) => name)).toEqual([
      'ci:quality',
      'ci:browser',
      'ci:browser-report',
      'migration:ci-d1-bundle',
      'migration:preview-d1',
    ])
  })

  it.each(generatedSetupJobs())(
    '%s creates the job store, then installs frozen with the store asserted, in that order',
    (_name, steps) => {
      const store = indexOfStep(steps, (s) => s.name === JOB_PNPM_STORE_STEP_NAME)
      const install = indexOfStep(steps, (s) => s.run?.includes(FROZEN_INSTALL_COMMAND) === true)
      const node = indexOfStep(steps, (s) => s.uses?.startsWith('actions/setup-node@') === true)
      expect(store).toBeGreaterThan(node)
      expect(install).toBe(store + 1)

      // The store is chosen once per job and inherited, never a flag on one
      // install: a flag would not reach the nested install in `cf:build`.
      expect(steps[store].run).toContain('mktemp -d "$RUNNER_TEMP/pnpm-store.XXXXXX"')
      expect(steps[store].run).toContain(`${JOB_PNPM_STORE_ENV}=%s`)
      expect(steps[store].run).toContain('>> "$GITHUB_ENV"')
      expect(JSON.stringify(steps)).not.toContain('--store-dir')

      // Frozen, and refused unless pnpm really resolves the job's store.
      expect(steps[install].run).toContain('pnpm store path')
      expect(steps[install].run!.indexOf('pnpm store path')).toBeLessThan(
        steps[install].run!.indexOf(FROZEN_INSTALL_COMMAND),
      )
      expect(steps[install].run).toContain('exit 1')
      expect(steps[install].run).not.toMatch(/--no-frozen-lockfile|--force|--prefer-offline/u)

      // The setup that already existed is untouched.
      const setupNode = steps[node]
      expect(setupNode.with?.['package-manager-cache']).toBe(false)
      expect(steps.filter((s) => s.run?.includes('pnpm install'))).toHaveLength(1)
    },
  )

  it('migration jobs start the CLI right after the install, before any D1 step', () => {
    for (const [name, steps] of Object.entries(migrationJobs())) {
      const install = indexOfStep(steps, (s) => s.run?.includes(FROZEN_INSTALL_COMMAND) === true)
      const smoke = steps[install + 1]
      expect(smoke.run, name).toBe('pnpm exec narduk-app --help')
      // The directory the real steps run `pnpm exec narduk-app` from, where the
      // generated app declares narduk-app-tools.
      expect(smoke['working-directory'], name).toBe('apps/web')
      const firstD1 = indexOfStep(steps, (s) => /narduk-app (?:db|deploy)/u.test(s.run ?? ''))
      expect(firstD1, name).toBeGreaterThan(install + 1)
      expect(steps[firstD1]['working-directory'], name).toBe('apps/web')
    }
  })

  it('keeps the migration guards, credentials and runner labels', () => {
    const files = createMigrationWorkflowFiles('private')
    const preview = parse(files.find((f) => f.path.endsWith('preview-d1.yml'))!.contents)
    expect(preview.concurrency['cancel-in-progress']).toBe(false)
    expect(preview.jobs.migrate.permissions['id-token']).toBe('write')
    expect(preview.jobs.migrate['runs-on'].labels).toContain('proxmox-deploy')
    const migrate = preview.jobs.migrate.steps.find((s: Step) => s.env?.CLOUDFLARE_API_TOKEN)
    expect(migrate.env.CLOUDFLARE_API_TOKEN).toBe('${{ secrets.D1_MIGRATE_API_TOKEN }}')
    const bundle = files.find((f) => f.path.endsWith('ci-d1-bundle.job.yml'))!.contents
    expect(bundle).not.toMatch(/D1_MIGRATE_API_TOKEN|CLOUDFLARE_API_TOKEN/u)
  })
})

describe('emitted steps against the real pnpm', () => {
  const pnpmAvailable = spawnSync('pnpm', ['--version']).status === 0
  const sandbox = mkdtempSync(join(tmpdir(), 'narduk-install-policy-'))
  // A canonical sandbox path, so a store under it compares equal to pnpm's own.
  const root = realpathSync(sandbox)
  let counter = 0
  afterAll(() => rmSync(sandbox, { recursive: true, force: true }))
  beforeAll(() => expect(pnpmAvailable, 'install pnpm to run these tests').toBe(true))

  interface Fixture {
    repo: string
    runnerTemp: string
    githubEnv: string
    /** What a persistent runner's shared store would be: `.npmrc` points at it. */
    sharedStore: string
    env: NodeJS.ProcessEnv
  }

  /**
   * A workspace with a linked `narduk-app` bin (no registry, no downloads) and
   * a root `inner` script that runs a nested frozen install, as `cf:build` does.
   */
  function fixture(options: { cli: 'ok' | 'broken'; workspaceStoreDir?: boolean }): Fixture {
    const dir = join(root, `fx-${++counter}`)
    const repo = join(dir, 'repo')
    const sharedStore = join(dir, 'shared-store')
    const runnerTemp = join(dir, 'runner-temp')
    const emptyConfig = join(dir, 'empty.npmrc')
    for (const path of [join(repo, 'apps/web'), join(repo, 'tools/fake-tools'), runnerTemp]) {
      mkdirSync(path, { recursive: true })
    }
    writeFileSync(emptyConfig, '')
    writeFileSync(
      join(repo, 'pnpm-workspace.yaml'),
      'packages:\n  - apps/*\n  - tools/*\n' +
        (options.workspaceStoreDir ? `storeDir: ${join(dir, 'workspace-store')}\n` : ''),
    )
    // The Harmony shape: a committed store-dir pointing at the persistent store.
    writeFileSync(join(repo, '.npmrc'), `store-dir=${sharedStore}\n`)
    writeFileSync(
      join(repo, 'package.json'),
      JSON.stringify({
        name: 'fixture',
        private: true,
        scripts: {
          inner: `pnpm store path > "${join(dir, 'inner-store.txt')}" && pnpm install --frozen-lockfile`,
        },
      }),
    )
    writeFileSync(
      join(repo, 'tools/fake-tools/package.json'),
      JSON.stringify({ name: 'fake-tools', version: '1.0.0', bin: { 'narduk-app': './bin.mjs' } }),
    )
    writeFileSync(
      join(repo, 'tools/fake-tools/bin.mjs'),
      [
        '#!/usr/bin/env node',
        // A named export that does not exist fails at link time, before any
        // statement runs: the shape of a skewed published artifact.
        options.cli === 'broken'
          ? "import { exportThatIsNotThere } from 'node:fs'\nconsole.log(exportThatIsNotThere)"
          : "import { writeFileSync } from 'node:fs'",
        'const args = process.argv.slice(2)',
        "if (args.includes('--help')) { console.log('usage'); process.exit(0) }",
        "const out = args[args.indexOf('--output') + 1]",
        "if (out) writeFileSync(out, 'bundle')",
        '',
      ].join('\n'),
    )
    writeFileSync(
      join(repo, 'apps/web/package.json'),
      JSON.stringify({
        name: 'web',
        private: true,
        devDependencies: { 'fake-tools': 'workspace:*' },
      }),
    )
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      CI: 'true',
      RUNNER_TEMP: runnerTemp,
      GITHUB_ENV: join(dir, 'github-env'),
      // Hermetic: no user or global config, and a default store inside the sandbox.
      NPM_CONFIG_USERCONFIG: emptyConfig,
      NPM_CONFIG_GLOBALCONFIG: emptyConfig,
      XDG_DATA_HOME: join(dir, 'xdg'),
    }
    delete env[JOB_PNPM_STORE_ENV]
    delete env.npm_config_store_dir
    writeFileSync(env.GITHUB_ENV!, '')
    // The lockfile a committed app has; resolving a workspace with no registry
    // dependency touches no network.
    const lock = spawnSync('pnpm', ['install', '--lockfile-only'], { cwd: repo, env })
    expect(lock.status, String(lock.stderr)).toBe(0)
    // Generating the lockfile touched the shared store; start each case clean.
    rmSync(sharedStore, { recursive: true, force: true })
    rmSync(join(dir, 'xdg'), { recursive: true, force: true })
    rmSync(join(dir, 'workspace-store'), { recursive: true, force: true })
    return {
      repo,
      runnerTemp,
      githubEnv: env.GITHUB_ENV!,
      sharedStore,
      env,
    }
  }

  /** `$GITHUB_ENV` as the runner applies it to the steps that follow. */
  function exported(fx: Fixture): Record<string, string> {
    const out: Record<string, string> = {}
    for (const line of readFileSync(fx.githubEnv, 'utf8').split('\n')) {
      const eq = line.indexOf('=')
      if (eq > 0) out[line.slice(0, eq)] = line.slice(eq + 1)
    }
    return out
  }

  function runStep(fx: Fixture, step: Step): { status: number | null; output: string } {
    const script = join(dirname(fx.githubEnv), `step-${++counter}.sh`)
    writeFileSync(script, step.run!)
    const result = spawnSync('bash', ['-e', script], {
      cwd: join(fx.repo, step['working-directory'] ?? '.'),
      env: { ...fx.env, ...exported(fx) },
      encoding: 'utf8',
    })
    return { status: result.status, output: `${result.stdout}${result.stderr}` }
  }

  /** The steps the runner would execute in order, stopping at the first failure. */
  function runJob(fx: Fixture, steps: Step[]): { ran: string[]; failed?: string } {
    const ran: string[] = []
    for (const step of steps) {
      if (!step.run) continue
      const { status } = runStep(fx, step)
      ran.push(step.name ?? step.run)
      if (status !== 0) return { ran, failed: step.name ?? step.run }
    }
    return { ran }
  }

  const storeStep = (steps: Step[]) => steps.find((s) => s.name === JOB_PNPM_STORE_STEP_NAME)!
  const installStep = (steps: Step[]) => steps.find((s) => s.run?.includes(FROZEN_INSTALL_COMMAND))!
  const bundleJob = () => migrationJobs()['ci-d1-bundle']

  it('control: without the job store, the install lands in the persistent shared store', () => {
    const fx = fixture({ cli: 'ok' })
    expect(runStep(fx, { run: 'pnpm install --frozen-lockfile' }).status).toBe(0)
    expect(existsSync(fx.sharedStore)).toBe(true)
  })

  it('the first and the nested install both use the job store, never the shared one', () => {
    const fx = fixture({ cli: 'ok' })
    const steps = bundleJob()
    expect(runStep(fx, storeStep(steps)).status).toBe(0)
    const store = exported(fx)[JOB_PNPM_STORE_ENV]
    expect(store.startsWith(join(fx.runnerTemp, 'pnpm-store.'))).toBe(true)
    expect(existsSync(store)).toBe(true)

    const install = runStep(fx, installStep(steps))
    expect(install.status, install.output).toBe(0)
    // The nested install: a later step running a script that installs again.
    const nested = runStep(fx, { run: 'pnpm run inner' })
    expect(nested.status, nested.output).toBe(0)
    expect(readFileSync(join(dirname(fx.githubEnv), 'inner-store.txt'), 'utf8').trim()).toBe(
      join(store, 'v10'),
    )
    expect(existsSync(store)).toBe(true)
    expect(existsSync(fx.sharedStore)).toBe(false)
  })

  it('a retry and concurrent jobs get different stores under the same RUNNER_TEMP', async () => {
    const fx = fixture({ cli: 'ok' })
    const script = join(dirname(fx.githubEnv), 'store.sh')
    writeFileSync(script, storeStep(bundleJob()).run!)
    const run = (envFile: string) =>
      new Promise<number | null>((resolve) => {
        writeFileSync(envFile, '')
        spawn('bash', ['-e', script], {
          env: { ...fx.env, GITHUB_ENV: envFile },
          stdio: 'ignore',
        }).on('close', resolve)
      })
    const files = ['a', 'b', 'c', 'retry-of-a'].map((n) => join(dirname(fx.githubEnv), `env-${n}`))
    expect(await Promise.all(files.map(run))).toEqual([0, 0, 0, 0])
    const stores = files.map((f) =>
      readFileSync(f, 'utf8').trim().replace(`${JOB_PNPM_STORE_ENV}=`, ''),
    )
    expect(new Set(stores).size).toBe(4)
    for (const store of stores) expect(existsSync(store)).toBe(true)
  })

  it('refuses to install when pnpm-workspace.yaml storeDir would override the job store', () => {
    const fx = fixture({ cli: 'ok', workspaceStoreDir: true })
    const steps = bundleJob()
    expect(runStep(fx, storeStep(steps)).status).toBe(0)
    const result = runStep(fx, installStep(steps))
    expect(result.status).toBe(1)
    expect(result.output).toContain('pnpm resolves a store outside the job-owned')
    expect(existsSync(join(fx.repo, 'node_modules'))).toBe(false)
    expect(existsSync(join(dirname(fx.githubEnv), 'workspace-store'))).toBe(false)
  })

  it('refuses to install when the store step did not run', () => {
    const fx = fixture({ cli: 'ok' })
    const result = runStep(fx, installStep(bundleJob()))
    expect(result.status).not.toBe(0)
    expect(existsSync(join(fx.repo, 'node_modules'))).toBe(false)
    expect(existsSync(fx.sharedStore)).toBe(false)
  })

  it('stays a frozen install: a lockfile that disagrees with the manifest fails', () => {
    const fx = fixture({ cli: 'ok' })
    const steps = bundleJob()
    expect(runStep(fx, storeStep(steps)).status).toBe(0)
    writeFileSync(
      join(fx.repo, 'apps/web/package.json'),
      JSON.stringify({
        name: 'web',
        private: true,
        devDependencies: { 'fake-tools': 'workspace:*', 'left-pad': '1.3.0' },
      }),
    )
    const result = runStep(fx, installStep(steps))
    expect(result.status).not.toBe(0)
    expect(result.output).toMatch(/frozen-lockfile|ERR_PNPM_OUTDATED_LOCKFILE/u)
  })

  it('runs the emitted d1-bundle job to the bundle step when the CLI starts', () => {
    const fx = fixture({ cli: 'ok' })
    const { ran, failed } = runJob(fx, bundleJob())
    expect(failed).toBeUndefined()
    expect(ran.at(-1)).toBe('Package migration SQL and checksums only')
    expect(readFileSync(join(fx.repo, 'd1-migrations.json'), 'utf8')).toBe('bundle')
    expect(existsSync(fx.sharedStore)).toBe(false)
  })

  it('a CLI that cannot start stops the job before the migration step', () => {
    const fx = fixture({ cli: 'broken' })
    const { ran, failed } = runJob(fx, bundleJob())
    expect(failed).toBe('Prove narduk-app starts before it touches D1')
    expect(ran).not.toContain('Package migration SQL and checksums only')
    expect(existsSync(join(fx.repo, 'd1-migrations.json'))).toBe(false)
  })

  it('a CLI that cannot start stops preview-d1 before it reaches the credentialed step', () => {
    const steps = migrationJobs()['preview-d1']
    const smoke = indexOfStep(
      steps,
      (s) => s.name === 'Prove narduk-app starts before it touches D1',
    )
    // Steps after the smoke carry `${{ }}` expressions only the runner resolves;
    // the contract is that nothing past the smoke runs, so run up to and including it.
    const beforeCredential = steps.slice(0, smoke + 1)
    const ok = runJob(fixture({ cli: 'ok' }), beforeCredential)
    expect(ok.failed).toBeUndefined()
    const broken = runJob(fixture({ cli: 'broken' }), beforeCredential)
    expect(broken.failed).toBe('Prove narduk-app starts before it touches D1')
    const credentialed = steps.findIndex((s) => s.env?.CLOUDFLARE_API_TOKEN)
    expect(credentialed).toBeGreaterThan(smoke)
  })

  it('the public CI install steps work the same way', () => {
    const fx = fixture({ cli: 'ok' })
    const steps = ciJobs('public').quality.steps
    const { failed } = runJob(fx, [storeStep(steps), installStep(steps)])
    expect(failed).toBeUndefined()
    expect(existsSync(fx.sharedStore)).toBe(false)
  })
})
