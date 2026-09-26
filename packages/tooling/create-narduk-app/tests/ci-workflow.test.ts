import { spawnSync } from 'node:child_process'
import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as YAML from 'yaml'
import {
  createCiWorkflow,
  createCopilotSetupWorkflow,
  createGhPackagesRunScript,
  createRunnerOnboardingScript,
  RUNNER_ONBOARDING_JOB_NAME,
  RUNNER_ONBOARDING_MESSAGE,
} from '../src/ci-workflow.js'
import {
  CI_TEST_ONLY_NUXT_OG_IMAGE_SECRET,
  CI_TEST_ONLY_NUXT_SESSION_PASSWORD,
} from '../src/ci-test-env.js'
import { buildGeneratedFiles } from '../src/generate.js'
import { createRootPackageManifest } from '../src/manifest.js'

/**
 * The caller's environment minus npm's registry config. An outer
 * `gh-packages-run` exports `NPM_CONFIG_USERCONFIG`, which sends the generated
 * script down its short-circuit, so a test that inherited it would be decided
 * by who ran it (narduk-libs#634).
 */
function callerEnvWithoutNpmConfig(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !/^npm_config_(?:userconfig|globalconfig)$/iu.test(key),
    ),
  )
}
describe('generated CI boundaries', () => {
  it('keeps all private gates in the pinned shared workflow with separate runner classes', () => {
    const workflow = createCiWorkflow('private')
    const runner = JSON.parse(workflow.match(/runner: '(.*)'/u)![1]!)
    const browser = JSON.parse(workflow.match(/e2e-runner: '(.*)'/u)![1]!)
    expect(runner.group).toBe('linux-ci')
    expect(browser.group).toBe('playwright-isolated')
    expect(browser.labels).toContain('proxmox-playwright-x64')
    expect(workflow).toContain('nuxt-cloudflare.yml@1513b2a2f4b147b2e625478e56eb9de0cc5d5399')
    expect(workflow).not.toContain('NARDUK_PLATFORM_GH_PACKAGES_READ')
    expect(workflow).not.toMatch(/^ {4}secrets:/mu)
    expect(workflow).toContain('require-scripts: true')
    expect(workflow).toContain('run-tests: true')
    expect(workflow).toContain('run-e2e: true')
    expect(workflow).toContain('e2e-shards: 3')
    expect(workflow).toContain(
      "extra-scripts: 'format:check lint knip manifests:validate foundation:shared-ui-pinned'",
    )
    expect(workflow).toContain('foundation-check: true')
    expect(workflow).toContain('e2e-install-browsers: false')
    expect(workflow).not.toContain('e2e-browsers-path:')
    expect(workflow).not.toContain('playwright install')
    expect(workflow).toContain('selected-repository membership')
    expect(workflow).toContain(`name: ${RUNNER_ONBOARDING_JOB_NAME}`)
    expect(workflow).toContain('runner-onboarding:')
    expect(workflow).toContain('runs-on: ubuntu-24.04')
    expect(workflow).toContain(RUNNER_ONBOARDING_MESSAGE)
    const parsed = YAML.parse(workflow) as {
      jobs: Record<
        string,
        { name?: string; 'runs-on'?: string; needs?: unknown; 'timeout-minutes'?: number }
      >
    }
    expect(parsed.jobs['runner-onboarding']?.name).toBe(RUNNER_ONBOARDING_JOB_NAME)
    expect(parsed.jobs['runner-onboarding']?.['runs-on']).toBe('ubuntu-24.04')
    expect(parsed.jobs['runner-onboarding']?.['timeout-minutes']).toBe(5)
    expect(parsed.jobs['runner-onboarding']?.needs).toBeUndefined()
    expect(parsed.jobs.ci?.needs).toBeUndefined()
    expect(workflow).toContain('workflow_dispatch:')
    // Cancel superseded pull-request runs only; a push (main) run queues
    // instead, so the commit that merged keeps a completed CI record.
    expect(workflow).toContain("cancel-in-progress: ${{ github.event_name == 'pull_request' }}")
    const manifest = JSON.parse(createRootPackageManifest('ci-fixture', [], 'private'))
    expect(manifest.scripts['test:unit']).toBe('pnpm --filter web run test:unit')
    expect(manifest.scripts['test:e2e']).toBe('playwright test')
    expect(manifest.scripts.quality).toContain('pnpm run test')
    expect(manifest.scripts['build:ci']).toContain(
      'NUXT_OG_IMAGE_SECRET=narduk-test-only-og-image-secret-000000',
    )
    expect(manifest.scripts['build:ci']).not.toContain('NUXT_SESSION_PASSWORD')
    const authManifest = JSON.parse(createRootPackageManifest('ci-fixture', ['auth'], 'private'))
    expect(authManifest.scripts['build:ci']).toContain(
      'NUXT_SESSION_PASSWORD=narduk-test-only-session-password-000000',
    )
    expect(workflow).not.toContain('secrets.NUXT_OG_IMAGE_SECRET')
    expect(workflow).not.toContain('secrets.NUXT_SESSION_PASSWORD')
  })

  it('keeps the literal build:ci prefix in manifest.ts equal to ci-test-env.ts', () => {
    // manifest.ts is loaded by repo scripts through Node's type stripping, so
    // it carries the placeholders as literals instead of importing them.
    const manifest = JSON.parse(createRootPackageManifest('pinned-prefix', [], 'private')) as {
      scripts: Record<string, string>
    }
    expect(manifest.scripts['build:ci']).toBe(
      `NUXT_OG_IMAGE_SECRET=${CI_TEST_ONLY_NUXT_OG_IMAGE_SECRET} ` +
        'NARDUK_CLOUDFLARE_BUILD=1 NITRO_PRESET=cloudflare_module pnpm run build',
    )
    const authManifest = JSON.parse(
      createRootPackageManifest('pinned-prefix', ['auth'], 'private'),
    ) as {
      scripts: Record<string, string>
    }
    expect(authManifest.scripts['build:ci']).toBe(
      `NUXT_OG_IMAGE_SECRET=${CI_TEST_ONLY_NUXT_OG_IMAGE_SECRET} ` +
        `NUXT_SESSION_PASSWORD=${CI_TEST_ONLY_NUXT_SESSION_PASSWORD} ` +
        'NARDUK_CLOUDFLARE_BUILD=1 NITRO_PRESET=cloudflare_module pnpm run build',
    )
  })

  it('manifest.ts has no runtime import, so Node type stripping can load it alone', async () => {
    const source = await readFile(new URL('../src/manifest.ts', import.meta.url), 'utf8')
    const runtimeImports = source
      .split('\n')
      .filter((line) => /^import\s/u.test(line) && !/^import\s+type\s/u.test(line))
    expect(runtimeImports).toEqual([])
  })

  it('public build jobs carry committed test-only Nuxt env, not repository secrets', () => {
    const workflow = YAML.parse(createCiWorkflow('public')) as {
      jobs: Record<string, { env?: Record<string, string>; steps?: Array<{ run?: string }> }>
    }
    for (const name of ['quality', 'browser']) {
      expect(workflow.jobs[name]?.env?.NUXT_OG_IMAGE_SECRET).toBe(
        'narduk-test-only-og-image-secret-000000',
      )
      expect(workflow.jobs[name]?.env?.NUXT_SESSION_PASSWORD).toBe(
        'narduk-test-only-session-password-000000',
      )
    }
    expect(workflow.jobs.quality?.steps?.at(-1)?.run).toBe('pnpm run quality:static')
    expect(createCiWorkflow('public')).not.toContain('${{ secrets.NUXT_')
  })

  it('public callers stay hosted, pin every action and retain the complete quality command', () => {
    const workflow = createCiWorkflow('public')
    expect(workflow).toContain('runs-on: ubuntu-24.04')
    expect(workflow).not.toContain('self-hosted')
    expect(workflow).not.toContain('narduk-enterprises/workflows')
    expect(workflow).toContain('timeout-minutes: 30')
    expect(workflow).toContain("cancel-in-progress: ${{ github.event_name == 'pull_request' }}")
    expect(workflow).toContain('persist-credentials: false')
    expect(workflow).toContain('pnpm run quality')
    // build:ci sets NARDUK_CLOUDFLARE_BUILD=1 + NITRO_PRESET=cloudflare_module
    // so the hosted browser job also builds the real deployable Worker shape.
    expect(workflow).toContain('pnpm run build:ci')
    expect(workflow).toContain('NUXT_OG_IMAGE_SECRET: narduk-test-only-og-image-secret-000000')
    expect(workflow).toContain('NUXT_SESSION_PASSWORD: narduk-test-only-session-password-000000')
    expect(workflow).not.toContain('secrets.NUXT_OG_IMAGE_SECRET')
    expect(workflow).not.toContain('secrets.NUXT_SESSION_PASSWORD')
    const actions = [...workflow.matchAll(/uses: [^@\s]+@(\S+)/gu)]
    expect(new Set(actions.map((action) => action[0].split('@')[0])).size).toBe(5)
    for (const action of actions) expect(action[1]).toMatch(/^[a-f0-9]{40}$/u)
  })

  // narduk-libs#787: a bot-dispatched main run starts promote.yml only after
  // the gate job, without waiting on anything, on the workflow's runner class.
  it('starts Promote after the gate on both visibilities without waiting on a run', () => {
    for (const [visibility, needs] of [
      ['public', 'Required'],
      ['private', 'ci'],
    ] as const) {
      const workflow = createCiWorkflow(visibility)
      const jobs = (YAML.parse(workflow) as { jobs: Record<string, Record<string, unknown>> }).jobs
      const dispatch = jobs['promote-dispatch']
      expect(dispatch?.needs, visibility).toBe(needs)
      expect(dispatch?.['timeout-minutes'], visibility).toBe(5)
      expect(dispatch?.['runs-on'], visibility).toEqual(
        visibility === 'public'
          ? 'ubuntu-24.04'
          : { group: 'linux-ci', labels: ['self-hosted', 'Linux', 'X64', 'proxmox', 'linux-ci'] },
      )
      expect(workflow, visibility).not.toContain('gh run watch')
    }
  })

  it('emits a visibility-independent Copilot setup workflow with concurrency and a job timeout', () => {
    const workflow = createCopilotSetupWorkflow()
    expect(workflow).toContain('on:\n  workflow_dispatch:')
    expect(workflow).toContain('environment: copilot')
    expect(workflow).toContain('timeout-minutes: 30')
    expect(workflow).toContain('concurrency:')
    expect(workflow).toContain('cancel-in-progress: true')
    expect(workflow).toContain('runs-on: ubuntu-latest')
    const actions = [...workflow.matchAll(/uses: [^@\s]+@(\S+)/gu)]
    expect(actions.length).toBeGreaterThan(0)
    for (const action of actions) expect(action[1]).toMatch(/^[a-f0-9]{40}$/u)
  })

  it('does not emit a default CI token bootstrap', () => {
    for (const visibility of ['private', 'public'] as const) {
      const generated = buildGeneratedFiles({
        appName: 'private-ci-auth',
        targetDir: '/tmp/private-ci-auth',
        noGit: true,
        visibility,
      })
      expect(generated.some((file) => file.path === 'scripts/package-registry-auth.mjs')).toBe(
        false,
      )
      const ci = generated.find((file) => file.path === '.github/workflows/ci.yml')?.contents ?? ''
      const copilot =
        generated.find((file) => file.path === '.github/workflows/copilot-setup-steps.yml')
          ?.contents ?? ''
      expect(ci).not.toContain('_authToken')
      expect(ci).not.toContain('NARDUK_PLATFORM_GH_PACKAGES_READ')
      expect(copilot).toContain('run: pnpm install --frozen-lockfile')
      expect(copilot).not.toContain('_authToken')
      expect(copilot).not.toContain('NARDUK_PLATFORM_GH_PACKAGES_READ')
    }
  })

  it.each(['private', 'public'] as const)(
    'emits a process-scoped gh-packages-run helper for %s apps',
    (visibility) => {
      const generated = buildGeneratedFiles({
        appName: 'workers-auth',
        targetDir: '/tmp/workers-auth',
        noGit: true,
        visibility,
      })
      const script = generated.find((file) => file.path === 'scripts/gh-packages-run.mjs')
      expect(script?.contents).toBe(createGhPackagesRunScript())
      expect(script?.contents).toContain("flag: 'wx'")
      expect(script?.contents).toContain('process.umask(0o077)')
      expect(script?.contents).toContain('${GH_PACKAGES_READ}')
      expect(script?.contents).not.toContain('.npmrc.auth')
      const root = JSON.parse(generated.find((file) => file.path === 'package.json')!.contents) as {
        scripts: Record<string, string>
      }
      expect(root.scripts['cf:build']).toBe(
        'pnpm install --frozen-lockfile && pnpm --filter web run cf:build',
      )
      expect(root.scripts['cf:build']).not.toContain('gh-packages-run')
    },
  )

  it('gh-packages-run writes a temp userconfig, runs the command, and removes the file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'narduk-gh-packages-run-'))
    try {
      const generated = buildGeneratedFiles({
        appName: 'workers-auth-run',
        targetDir: directory,
        noGit: true,
        visibility: 'public',
      })
      const script = generated.find((file) => file.path === 'scripts/gh-packages-run.mjs')!
      const executable = join(directory, 'gh-packages-run.mjs')
      await writeFile(executable, script.contents)
      await writeFile(
        join(directory, 'pnpm-stub.sh'),
        `#!/bin/bash\nset -euo pipefail\ntest -f "$NPM_CONFIG_USERCONFIG"\ntest "$NPM_CONFIG_GLOBALCONFIG" = /dev/null\ntest "$(cat "$NPM_CONFIG_USERCONFIG")" = '//npm.pkg.github.com/:_authToken=\${GH_PACKAGES_READ}'\nprintf '%s\\n' "$*" > "${directory}/args.txt"\nexit "$INSTALL_EXIT"\n`,
      )
      await chmod(join(directory, 'pnpm-stub.sh'), 0o755)

      const run = (env: NodeJS.ProcessEnv, args: string[]) =>
        spawnSync(process.execPath, [executable, ...args], {
          cwd: directory,
          encoding: 'utf8',
          env: {
            ...callerEnvWithoutNpmConfig(),
            ...env,
            PATH: `${directory}:${process.env.PATH}`,
            RUNNER_TEMP: directory,
          },
        })

      const stub = join(directory, 'pnpm-stub.sh')
      expect(run({ GH_PACKAGES_READ: '' }, ['--', stub, 'install']).status).toBe(1)
      expect(run({ GH_PACKAGES_READ: 'test-value\nextra' }, ['--', stub, 'install']).status).toBe(1)
      expect(run({ GH_PACKAGES_READ: 'test-value' }, []).status).toBe(1)

      for (const status of [0, 7]) {
        const result = run({ GH_PACKAGES_READ: 'test-value', INSTALL_EXIT: String(status) }, [
          '--',
          stub,
          'install',
          '--frozen-lockfile',
        ])
        expect(result.status, result.stderr).toBe(status)
        expect(result.stdout).not.toContain('test-value')
        expect(result.stderr).not.toContain('test-value')
        expect((await readdir(directory)).filter((name) => name.startsWith('npmrc-auth.'))).toEqual(
          [],
        )
        expect(await readFile(join(directory, 'args.txt'), 'utf8')).toBe(
          'install --frozen-lockfile\n',
        )
      }

      // A caller that already supplies a userconfig (an outer gh-packages-run)
      // is left alone: its file is used, and no temp userconfig is written.
      const callerConfig = join(directory, 'caller-userconfig')
      await writeFile(callerConfig, '')
      const passthrough = join(directory, 'passthrough-stub.sh')
      await writeFile(
        passthrough,
        `#!/bin/bash\nset -euo pipefail\ntest "$NPM_CONFIG_USERCONFIG" = "${callerConfig}"\nexit 0\n`,
      )
      await chmod(passthrough, 0o755)
      const nested = run({ GH_PACKAGES_READ: 'test-value', NPM_CONFIG_USERCONFIG: callerConfig }, [
        '--',
        passthrough,
      ])
      expect(nested.status, nested.stderr).toBe(0)
      expect((await readdir(directory)).filter((name) => name.startsWith('npmrc-auth.'))).toEqual(
        [],
      )
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('the emitted public install is a plain frozen lockfile install', () => {
    const workflow = createCiWorkflow('public')
    expect(workflow).toContain('run: pnpm install --frozen-lockfile')
    expect(workflow).not.toContain('_authToken')
    expect(workflow).not.toContain('npm.pkg.github.com')
    expect(workflow).not.toContain('GH_PACKAGES_READ')
    expect(workflow).not.toContain('NARDUK_PLATFORM_GH_PACKAGES_READ')
  })

  it('does not emit the hosted runner-onboarding job on public apps', () => {
    const workflow = createCiWorkflow('public')
    expect(workflow).not.toContain(RUNNER_ONBOARDING_JOB_NAME)
    expect(workflow).not.toContain('runner-onboarding:')
  })
})

describe('runner-onboarding detection script', () => {
  /** One canned `gh api` answer: the body `gh` prints on stdout, and its exit. */
  interface GhAnswer {
    body: unknown
    status?: number
  }

  /**
   * A `gh` stand-in that answers by path and applies `--jq` with the real jq,
   * the way `gh api --jq` does. A refused call prints its JSON error body as a
   * line on stdout and exits 1 -- what `gh api` really does on a 403.
   */
  const FAKE_GH = `#!/bin/bash
path=''
jq_expr=''
while [ $# -gt 0 ]; do
  case "$1" in
    api | --paginate) shift ;;
    --jq) jq_expr="$2"; shift 2 ;;
    *) path="$1"; shift ;;
  esac
done
case "$path" in
  orgs/*/actions/runner-groups/*/repositories) id="\${path#*/runner-groups/}"; key="members-\${id%%/*}" ;;
  orgs/*/actions/runner-groups) key=groups ;;
  repos/*/actions/runs/*/jobs*) key=jobs ;;
  *) echo "unexpected gh api $path" >&2; exit 2 ;;
esac
dir="$(dirname "$0")"
[ -f "$dir/$key.json" ] || { echo "no answer for $path" >&2; exit 2; }
if [ "$(cat "$dir/$key.status")" != 0 ]; then
  cat "$dir/$key.json"
  echo
  echo "gh: Resource not accessible by integration (HTTP 403)" >&2
  exit 1
fi
if [ -n "$jq_expr" ]; then jq -r "$jq_expr" "$dir/$key.json"; else cat "$dir/$key.json"; fi
`

  const FORBIDDEN: GhAnswer = {
    body: {
      documentation_url: 'https://docs.github.com/rest/actions/self-hosted-runner-groups',
      message: 'Resource not accessible by integration',
      status: '403',
    },
    status: 1,
  }

  const LINUX_CI_LABELS = ['self-hosted', 'Linux', 'X64', 'proxmox', 'linux-ci']

  function job(name: string, fields: Record<string, unknown>) {
    return { conclusion: null, labels: LINUX_CI_LABELS, name, runner_id: null, ...fields }
  }

  const ONBOARDING = job(RUNNER_ONBOARDING_JOB_NAME, {
    labels: ['ubuntu-24.04'],
    runner_id: 3,
    status: 'in_progress',
  })

  async function runScript(answers: Record<string, GhAnswer>) {
    const directory = await mkdtemp(join(tmpdir(), 'runner-onboard-'))
    try {
      const gh = join(directory, 'gh')
      await writeFile(gh, FAKE_GH)
      await chmod(gh, 0o755)
      for (const [key, answer] of Object.entries(answers)) {
        await writeFile(join(directory, `${key}.json`), JSON.stringify(answer.body))
        await writeFile(join(directory, `${key}.status`), String(answer.status ?? 0))
      }
      const executable = join(directory, 'check.sh')
      await writeFile(executable, createRunnerOnboardingScript())
      return spawnSync('bash', [executable], {
        encoding: 'utf8',
        env: {
          PATH: `${directory}:${process.env.PATH}`,
          REPO: 'narduk-enterprises/new-app',
          RUN_ID: '99',
          RUNNER_ONBOARDING_WAIT_SECONDS: '0',
          RUNNER_ONBOARDING_POLL_SECONDS: '0',
        },
      })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }

  function groups(...entries: Array<[number, string, string]>): GhAnswer {
    return {
      body: {
        runner_groups: entries.map(([id, visibility, name]) => ({ id, name, visibility })),
      },
    }
  }

  function members(...names: string[]): GhAnswer {
    return { body: { repositories: names.map((full_name) => ({ full_name })) } }
  }

  it('has the real jq the fake gh applies --jq with', () => {
    expect(spawnSync('jq', ['--version']).status, 'install jq to run these tests').toBe(0)
  })

  it('fails when the org API shows the repo is not in linux-ci', async () => {
    const result = await runScript({
      groups: groups([1, 'selected', 'linux-ci']),
      'members-1': members('narduk-enterprises/other'),
    })
    expect(result.status, result.stderr).toBe(1)
    expect(result.stdout).toContain('Not a member of linux-ci (id 1).')
    expect(result.stdout).toContain(`::error::${RUNNER_ONBOARDING_MESSAGE}`)
  })

  it('succeeds when the org API lists the repo in the named groups', async () => {
    const result = await runScript({
      groups: groups([1, 'selected', 'linux-ci'], [2, 'selected', 'playwright-isolated']),
      'members-1': members('narduk-enterprises/other', 'narduk-enterprises/new-app'),
      'members-2': members('narduk-enterprises/new-app'),
    })
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('Repository is listed in the named runner groups.')
    expect(result.stdout).not.toContain('::warning::')
    expect(result.stdout).not.toContain('::error::')
  })

  it('counts a group open to every private repository as membership', async () => {
    const result = await runScript({
      groups: groups([1, 'private', 'linux-ci'], [2, 'all', 'playwright-isolated']),
    })
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('Repository is listed in the named runner groups.')
  })

  it('treats a forbidden org listing as unknown, not as a listed group', async () => {
    // Post-onboarding and healthy: the token still cannot list org groups,
    // and the self-hosted Build job has a runner.
    const result = await runScript({
      groups: FORBIDDEN,
      jobs: {
        body: {
          jobs: [
            ONBOARDING,
            job('ci / Build', { runner_id: 41, status: 'in_progress' }),
            job('ci / Checks', { status: 'queued' }),
          ],
        },
      },
    })
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).not.toContain('Not a member')
    expect(result.stdout).not.toContain('::error::')
    expect(result.stdout).not.toContain('::warning::')
    expect(result.stdout).toContain('runner groups look reachable')
  })

  it('warns when self-hosted jobs stay queued beside skipped and hosted siblings', async () => {
    // The #625 first push: Build and Checks never get a runner. Extra gate and
    // Deploy dry run skip at once (`completed`, no runner), and Caller lint
    // starts on a hosted lightweight runner -- none of which proves the
    // self-hosted groups are reachable.
    const result = await runScript({
      groups: FORBIDDEN,
      jobs: {
        body: {
          jobs: [
            ONBOARDING,
            job('ci / Build', { status: 'queued' }),
            job('ci / Checks', { status: 'queued' }),
            job('ci / Extra gate', { conclusion: 'skipped', status: 'completed' }),
            job('ci / Deploy dry run', {
              conclusion: 'skipped',
              labels: [],
              runner_id: 0,
              status: 'completed',
            }),
            job('ci / Caller lint', {
              labels: ['ubuntu-latest'],
              runner_id: 7,
              status: 'in_progress',
            }),
          ],
        },
      },
    })
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).not.toContain('look reachable')
    expect(result.stdout).toContain(`::warning::${RUNNER_ONBOARDING_MESSAGE}`)
    expect(result.stdout).not.toContain('::error::')
  })

  it('falls back to the sibling jobs when a group membership listing is refused', async () => {
    const result = await runScript({
      groups: groups([1, 'selected', 'linux-ci']),
      jobs: { body: { jobs: [ONBOARDING, job('ci / Build', { status: 'queued' })] } },
      'members-1': FORBIDDEN,
    })
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('Could not list the repositories in linux-ci (id 1).')
    expect(result.stdout).toContain(`::warning::${RUNNER_ONBOARDING_MESSAGE}`)
    expect(result.stdout).not.toContain('::error::')
  })

  it('warns rather than failing when the jobs listing is refused too', async () => {
    const result = await runScript({ groups: FORBIDDEN, jobs: FORBIDDEN })
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain(`::warning::${RUNNER_ONBOARDING_MESSAGE}`)
    expect(result.stderr).not.toContain('integer expression expected')
  })

  it('has nothing to report when no sibling job asks for a self-hosted runner', async () => {
    const result = await runScript({
      groups: FORBIDDEN,
      jobs: {
        body: {
          jobs: [
            ONBOARDING,
            job('ci / Build', {
              labels: ['blacksmith-2vcpu-ubuntu-2404'],
              status: 'queued',
            }),
          ],
        },
      },
    })
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('No sibling job in this run asks for a self-hosted runner.')
    expect(result.stdout).not.toContain('::warning::')
  })
})
