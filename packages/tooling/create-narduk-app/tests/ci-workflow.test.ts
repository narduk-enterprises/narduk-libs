import { NUXT_CLOUDFLARE_WORKFLOW_SHA } from '../src/workflow-pin.js'
import { spawnSync } from 'node:child_process'
import { access, chmod, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as YAML from 'yaml'
import {
  createCiWorkflow,
  createGhPackagesRunScript,
  SHARED_WORKFLOW_CALLER_PERMISSIONS,
} from '../src/ci-workflow.js'
import {
  BUILD_CI_MARKS_OUTPUT,
  BUILD_CI_OUTPUT_MARKER,
  BUILD_CI_REFUSES_DEPLOYED_BUILD,
  CI_TEST_ONLY_NUXT_OG_IMAGE_SECRET,
  CI_TEST_ONLY_NUXT_SESSION_PASSWORD,
  buildCiMarksOutput,
} from '../src/ci-test-env.js'
import { buildGeneratedFiles } from '../src/generate.js'
import { createRootPackageManifest, createWebPackageManifest } from '../src/manifest.js'

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
    expect(workflow).toContain(`nuxt-cloudflare.yml@${NUXT_CLOUDFLARE_WORKFLOW_SHA}`)
    // workflows#199: the shared jobs request id-token: write, so the caller must grant it.
    expect(NUXT_CLOUDFLARE_WORKFLOW_SHA).toBe('73e050ae42ece50497ff3140e21767505cca0076')
    expect(workflow).toContain(`@${NUXT_CLOUDFLARE_WORKFLOW_SHA} # v2 + id-token (workflows#199)`)
    expect(workflow).not.toContain('NARDUK_PLATFORM_GH_PACKAGES_READ')
    expect(workflow).not.toMatch(/^ {4}secrets:/mu)
    expect(workflow).toContain('require-scripts: true')
    expect(workflow).toContain('run-tests: true')
    expect(workflow).toContain('run-e2e: true')
    expect(workflow).toContain('e2e-shards: 3')
    expect(workflow).toContain(
      "extra-scripts: 'format:check lint knip manifests:validate foundation:shared-ui-pinned foundation:check:coverage foundation:check:toolchain foundation:check:deployment'",
    )
    expect(workflow).toContain('foundation-check: true')
    // workflows#158: the standard gates, with the budget pointed at the
    // workspace app. The header probe needs a preview check, so the caller
    // must never pass `preview-checks: none` (the default is `og`).
    expect(workflow).toContain('      quality-level: standard')
    expect(workflow).toContain(
      "      performance-budget-args: '--app-dir apps/web --font-total-budget-kb 140'",
    )
    expect(workflow).not.toContain('preview-checks')
    expect(workflow).not.toContain('quality-opt-out')
    expect(workflow).toContain('e2e-install-browsers: false')
    expect(workflow).not.toContain('e2e-browsers-path:')
    expect(workflow).not.toContain('playwright install')
    expect(workflow).toContain('selected-repository membership')
    // No generated job may use a GitHub-hosted runner in a private app: the
    // Operator Portal's runner-policy gate flags every one (a missing runner
    // group assignment is caught centrally by runner-queue-eligibility).
    const parsed = YAML.parse(workflow) as {
      jobs: Record<string, { 'runs-on'?: unknown; needs?: unknown }>
    }
    expect(Object.keys(parsed.jobs)).not.toContain('runner-onboarding')
    expect(workflow).not.toContain('Runner group onboarding')
    for (const [name, job] of Object.entries(parsed.jobs)) {
      expect(JSON.stringify(job['runs-on'] ?? null), name).not.toMatch(/ubuntu-/u)
    }
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
    expect(manifest.scripts['build:ci']).toContain(
      'NUXT_SESSION_PASSWORD=narduk-test-only-session-password-000000',
    )
    expect(workflow).not.toContain('secrets.NUXT_OG_IMAGE_SECRET')
    expect(workflow).not.toContain('secrets.NUXT_SESSION_PASSWORD')
  })

  it('grants the shared-workflow caller every permission the pinned workflow requests', () => {
    // The pin's preview job requests pull-requests: write and its reuse-plan and
    // e2e-plan jobs request actions: read. GitHub validates every job's request
    // before any job runs, so a caller granting less is a zero-job
    // startup_failure (cloudflarestat-us, 2026-09-28). From workflows#199 on
    // the jobs that run narduk-app also request id-token: write.
    const expected = {
      actions: 'read',
      contents: 'read',
      'id-token': 'write',
      packages: 'read',
      'pull-requests': 'write',
    }
    const ci = YAML.parse(createCiWorkflow('private')) as {
      jobs: { ci: { permissions: Record<string, string> } }
    }
    expect(ci.jobs.ci.permissions).toEqual(expected)
    expect(Object.keys(expected).sort()).toEqual(
      SHARED_WORKFLOW_CALLER_PERMISSIONS.map((entry) => entry.split(':')[0]).sort(),
    )
  })

  it('keeps the literal build:ci prefix in manifest.ts equal to ci-test-env.ts', () => {
    // manifest.ts is loaded by repo scripts through Node's type stripping, so
    // it carries the placeholders as literals instead of importing them.
    const manifest = JSON.parse(createRootPackageManifest('pinned-prefix', [], 'private')) as {
      scripts: Record<string, string>
    }
    expect(manifest.scripts['build:ci']).toBe(
      BUILD_CI_REFUSES_DEPLOYED_BUILD +
        ' && ' +
        `NUXT_OG_IMAGE_SECRET=${CI_TEST_ONLY_NUXT_OG_IMAGE_SECRET} ` +
        `NUXT_SESSION_PASSWORD=${CI_TEST_ONLY_NUXT_SESSION_PASSWORD} ` +
        'NARDUK_CLOUDFLARE_BUILD=1 NITRO_PRESET=cloudflare_module pnpm run build && ' +
        BUILD_CI_MARKS_OUTPUT,
    )
  })

  it('refuses to run build:ci for a deployed build and lets CI run it', () => {
    const manifest = JSON.parse(createRootPackageManifest('guard', [], 'private')) as {
      scripts: Record<string, string>
    }
    const guard = manifest.scripts['build:ci'].split(' && ')[0] ?? ''
    expect(guard).toBe(BUILD_CI_REFUSES_DEPLOYED_BUILD)
    const clean = { PATH: process.env.PATH }
    const run = (env: Record<string, string | undefined>) =>
      spawnSync('sh', ['-c', guard], { encoding: 'utf8', env })
    expect(run(clean).status).toBe(0)
    expect(
      run({ ...clean, NARDUK_CLOUDFLARE_BUILD: '1', NARDUK_DEPLOY_TARGET: 'production' }).status,
    ).toBe(0)
    for (const env of [
      { WORKERS_CI: '1' },
      { WORKERS_CI_BRANCH: 'main' },
      { NARDUK_ALLOW_LOCAL_WRANGLER_DEPLOY: '1' },
    ]) {
      const result = run({ ...clean, ...env })
      expect(result.status, JSON.stringify(env)).toBe(1)
      expect(result.stderr).toContain('cannot run for a deployed build')
    }
    for (const key of ['build', 'cf:build', 'ship:build']) {
      expect(manifest.scripts[key] ?? '').not.toContain('narduk-test-only')
    }
  })

  it('marks build:ci output beside the Nitro directory for each layout', async () => {
    const manifest = JSON.parse(createRootPackageManifest('marker', [], 'private')) as {
      scripts: Record<string, string>
    }
    expect(manifest.scripts['build:ci']?.endsWith(BUILD_CI_MARKS_OUTPUT)).toBe(true)
    expect(BUILD_CI_MARKS_OUTPUT).toBe(buildCiMarksOutput('apps-web'))
    expect(manifest.scripts['quality:static']).toContain('pnpm run build:ci')
    const web = JSON.parse(createWebPackageManifest('marker', [], 3000)) as {
      scripts: Record<string, string>
    }
    for (const key of [
      'cf:deploy',
      'cf:deploy:preview',
      'deploy',
      'deploy:dry-run',
      'deploy:version',
    ] as const) {
      expect(web.scripts[key] ?? '', key).not.toContain(BUILD_CI_OUTPUT_MARKER)
    }

    const present = async (path: string): Promise<boolean> => {
      try {
        await access(path)
        return true
      } catch {
        return false
      }
    }
    const directory = await mkdtemp(join(tmpdir(), 'build-ci-marker-'))
    const rootDirectory = await mkdtemp(join(tmpdir(), 'build-ci-marker-root-'))
    try {
      const marked = spawnSync('sh', ['-c', BUILD_CI_MARKS_OUTPUT], {
        cwd: directory,
        encoding: 'utf8',
      })
      expect(marked.status).toBe(0)
      expect(await present(join(directory, 'apps', 'web', '.output', BUILD_CI_OUTPUT_MARKER))).toBe(
        true,
      )
      expect(await present(join(directory, '.output', BUILD_CI_OUTPUT_MARKER))).toBe(false)

      const rootMarked = spawnSync('sh', ['-c', buildCiMarksOutput('root')], {
        cwd: rootDirectory,
        encoding: 'utf8',
      })
      expect(rootMarked.status).toBe(0)
      expect(await present(join(rootDirectory, '.output', BUILD_CI_OUTPUT_MARKER))).toBe(true)
      expect(
        await present(join(rootDirectory, 'apps', 'web', '.output', BUILD_CI_OUTPUT_MARKER)),
      ).toBe(false)
    } finally {
      await rm(directory, { recursive: true, force: true })
      await rm(rootDirectory, { recursive: true, force: true })
    }
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
    // quality:static is the build the item-10 probe step serves, so every
    // secret-free build env above also reaches that probe.
    expect(workflow.jobs.quality?.steps?.at(-3)?.run).toBe('pnpm run quality:static')
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

  it('does not emit a Copilot setup workflow', () => {
    for (const visibility of ['private', 'public'] as const) {
      const generated = buildGeneratedFiles({
        appName: 'no-copilot',
        targetDir: '/tmp/no-copilot',
        noGit: true,
        visibility,
      })
      expect(
        generated.some((file) => file.path === '.github/workflows/copilot-setup-steps.yml'),
        visibility,
      ).toBe(false)
    }
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
      expect(ci).not.toContain('_authToken')
      expect(ci).not.toContain('NARDUK_PLATFORM_GH_PACKAGES_READ')
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

  it('the emitted public install is a frozen lockfile install from a job-owned store', () => {
    const workflow = createCiWorkflow('public')
    expect(workflow).toContain('pnpm install --frozen-lockfile')
    expect(workflow).toContain('NPM_CONFIG_STORE_DIR=%s')
    expect(workflow).not.toContain('_authToken')
    expect(workflow).not.toContain('npm.pkg.github.com')
    expect(workflow).not.toContain('GH_PACKAGES_READ')
    expect(workflow).not.toContain('NARDUK_PLATFORM_GH_PACKAGES_READ')
  })
})
