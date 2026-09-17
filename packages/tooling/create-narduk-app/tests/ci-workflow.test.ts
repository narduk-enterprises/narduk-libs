import { spawnSync } from 'node:child_process'
import { chmod, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createCiRegistryAuthScript,
  createCiWorkflow,
  createCopilotSetupWorkflow,
} from '../src/ci-workflow.js'
import { buildGeneratedFiles } from '../src/generate.js'
import { createRootPackageManifest } from '../src/manifest.js'

describe('generated CI boundaries', () => {
  it('keeps all private gates in the pinned shared workflow with separate runner classes', () => {
    const workflow = createCiWorkflow('private')
    const runner = JSON.parse(workflow.match(/runner: '(.*)'/u)![1]!)
    const browser = JSON.parse(workflow.match(/e2e-runner: '(.*)'/u)![1]!)
    expect(runner.group).toBe('linux-ci')
    expect(browser.group).toBe('playwright-isolated')
    expect(browser.labels).toContain('proxmox-playwright-x64')
    expect(workflow).toMatch(/nuxt-cloudflare.yml@[a-f0-9]{40}\n/u)
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
    expect(workflow).toContain('workflow_dispatch:')
    // Cancel superseded pull-request runs only; a push (main) run queues
    // instead, so the commit that merged keeps a completed CI record.
    expect(workflow).toContain("cancel-in-progress: ${{ github.event_name == 'pull_request' }}")
    const manifest = JSON.parse(createRootPackageManifest('ci-fixture', [], 'private'))
    expect(manifest.scripts['test:unit']).toBe('pnpm --filter web run test:unit')
    expect(manifest.scripts['test:e2e']).toBe('playwright test')
    expect(manifest.scripts.quality).toContain('pnpm run test')
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
    const actions = [...workflow.matchAll(/uses: [^@\s]+@(\S+)/gu)]
    expect(new Set(actions.map((action) => action[0].split('@')[0])).size).toBe(5)
    for (const action of actions) expect(action[1]).toMatch(/^[a-f0-9]{40}$/u)
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

  it('private registry bootstrap runs before dependencies and refuses unsafe existing targets', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'narduk-private-ci-auth-'))
    try {
      const generated = buildGeneratedFiles({
        appName: 'private-ci-auth',
        targetDir: directory,
        noGit: true,
        visibility: 'private',
      })
      const script = generated.find((file) => file.path === 'scripts/package-registry-auth.mjs')!
      expect(script.contents).toBe(createCiRegistryAuthScript())
      const executable = join(directory, 'bootstrap.mjs')
      const target = join(directory, '.npmrc.auth')
      await writeFile(executable, script.contents)
      const run = (token: string) =>
        spawnSync(process.execPath, [executable], {
          cwd: directory,
          encoding: 'utf8',
          env: { ...process.env, NARDUK_PLATFORM_GH_PACKAGES_READ: token },
        })
      expect(run('').status).toBe(1)
      expect(run('test-value\nextra-line').status).toBe(1)
      expect(await readdir(directory)).toEqual(['bootstrap.mjs'])
      const success = run('test-value')
      expect(success.status, success.stderr).toBe(0)
      expect(success.stdout + success.stderr).not.toContain('test-value')
      expect((await stat(target)).mode & 0o777).toBe(0o600)
      expect(await readFile(target, 'utf8')).toBe('//npm.pkg.github.com/:_authToken=test-value\n')
      expect(run('replacement').status).toBe(1)
      expect(await readFile(target, 'utf8')).toContain('test-value')
      await rm(target)
      const sentinel = join(directory, 'sentinel')
      await writeFile(sentinel, 'untouched')
      await symlink(sentinel, target)
      expect(run('replacement').status).toBe(1)
      expect(await readFile(sentinel, 'utf8')).toBe('untouched')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('the emitted public install removes private auth on success and failure', async () => {
    const workflow = createCiWorkflow('public')
    const script = workflow
      .split('        run: |\n')[1]!
      .split('      - run:')[0]!
      .split('\n')
      .map((line) => line.slice(10))
      .join('\n')
    const directory = await mkdtemp(join(tmpdir(), 'narduk-generated-ci-auth-'))
    try {
      const executable = join(directory, 'pnpm')
      await writeFile(
        executable,
        `#!/bin/bash\nset -euo pipefail\ntest -f "$NPM_CONFIG_USERCONFIG"\ntest "$NPM_CONFIG_GLOBALCONFIG" = /dev/null\ntest "$(cat "$NPM_CONFIG_USERCONFIG")" = '//npm.pkg.github.com/:_authToken=test-value'\nexit "$INSTALL_EXIT"\n`,
      )
      await chmod(executable, 0o755)
      for (const status of [0, 7]) {
        const result = spawnSync('bash', ['-c', script], {
          encoding: 'utf8',
          env: {
            ...process.env,
            PATH: `${directory}:${process.env.PATH}`,
            RUNNER_TEMP: directory,
            GH_PACKAGES_READ: 'test-value',
            INSTALL_EXIT: String(status),
          },
        })
        expect(result.status, result.stderr).toBe(status)
        expect((await readdir(directory)).filter((name) => name.startsWith('npmrc-auth.'))).toEqual(
          [],
        )
        expect(result.stdout).not.toContain('test-value')
        expect(result.stderr).not.toContain('test-value')
      }
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
