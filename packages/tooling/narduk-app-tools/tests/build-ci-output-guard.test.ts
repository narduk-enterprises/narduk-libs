import type * as ChildProcess from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

const spawnSync = vi.hoisted(() =>
  vi.fn((_file: string, _args?: readonly string[]) => ({ status: 0, stdout: '', stderr: '' })),
)
vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof ChildProcess>()),
  spawnSync,
}))
vi.mock('../src/cloudflare.js', () => ({
  fetchWorkerPlainTextVars: vi.fn(async () => ({ SITE_URL: 'https://example.com' })),
}))

const { BUILD_CI_OUTPUT_MARKER, buildCiOutputNotice, resolveAppDir, runDeploy } =
  await import('../src/deploy.js')
const { runDeployLocal } = await import('../src/deploy-local.js')

/**
 * Same token the packed-consumer smoke fails on
 * (scripts/consumer-smoke-output.mjs). A dry-run notice has to stay clear of it.
 */
const warningOrErrorTokenPattern =
  /(?:^|[\s:[(])(?:warn(?:ing)?|error)(?=$|[\s:\])])|(?:deprecation|experimental|MaxListenersExceeded)Warning:/iu

const tempDirs: string[] = []
afterEach(() => {
  for (const path of tempDirs.splice(0)) rmSync(path, { force: true, recursive: true })
  spawnSync.mockClear()
})

type Layout = 'root' | 'apps-web'

function fixture(layout: Layout, marker: boolean): { root: string; appDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'narduk-build-ci-guard-'))
  tempDirs.push(root)
  const appDir = layout === 'root' ? root : join(root, 'apps', 'web')
  mkdirSync(join(appDir, '.output', 'server'), { recursive: true })
  writeFileSync(join(appDir, 'wrangler.jsonc'), JSON.stringify({ name: 'fixture-app' }))
  writeFileSync(join(appDir, '.output', 'server', 'index.mjs'), 'export default {}\n')
  if (marker) writeFileSync(join(appDir, '.output', BUILD_CI_OUTPUT_MARKER), 'build:ci\n')
  return { root, appDir }
}

const allowLocal = { NARDUK_ALLOW_LOCAL_WRANGLER_DEPLOY: '1' }

function stderrLines(): string[] {
  return vi
    .mocked(console.error)
    .mock.calls.map((call) => call.map((part) => String(part)).join(' '))
}

function spawnArgv(index = 0): readonly string[] {
  const argv = (index < 0 ? spawnSync.mock.calls.at(-1) : spawnSync.mock.calls[index])?.[1]
  if (!argv) throw new Error(`spawnSync call ${index} has no argv`)
  return argv
}

describe('build:ci output cannot be published', () => {
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  afterEach(() => {
    errorSpy.mockClear()
  })

  it('keeps the dry-run notice off the packed-consumer warning scan', () => {
    for (const dryRun of [true, false]) {
      const notice = buildCiOutputNotice(dryRun)
      expect(notice).toContain(`.output/${BUILD_CI_OUTPUT_MARKER}`)
      expect(notice).toContain('cf:build')
      expect(warningOrErrorTokenPattern.test(notice)).toBe(false)
    }
  })

  describe.each(['root', 'apps-web'] as const)('%s layout', (layout) => {
    it('refuses deploy and versions-upload when the marker is present', () => {
      const { root, appDir } = fixture(layout, true)
      expect(resolveAppDir(root)).toBe(resolve(appDir))
      for (const args of [['deploy'], ['versions-upload']] as const) {
        spawnSync.mockClear()
        errorSpy.mockClear()
        expect(runDeploy([...args], appDir, allowLocal)).toBe(1)
        expect(spawnSync).not.toHaveBeenCalled()
        expect(stderrLines().join('\n')).toContain(BUILD_CI_OUTPUT_MARKER)
        expect(stderrLines().join('\n')).toContain('cf:build')
        expect(stderrLines().join('\n')).toContain('refusing to publish')
      }
    })

    it('dry-run prints the notice and exits 0', () => {
      const { appDir } = fixture(layout, true)
      for (const args of [
        ['deploy', '--dry-run'],
        ['versions-upload', '--dry-run'],
      ] as const) {
        spawnSync.mockClear()
        errorSpy.mockClear()
        expect(runDeploy([...args], appDir, {})).toBe(0)
        expect(spawnSync).toHaveBeenCalledOnce()
        expect(spawnArgv()).toContain('--dry-run')
        expect(stderrLines().join('\n')).toContain('caution:')
        expect(stderrLines().join('\n')).toContain('cf:build')
        expect(warningOrErrorTokenPattern.test(stderrLines().join('\n'))).toBe(false)
      }
    })

    it('deploys a cf:build output that has no marker', () => {
      const { appDir } = fixture(layout, false)
      for (const args of [['deploy'], ['versions-upload']] as const) {
        spawnSync.mockClear()
        errorSpy.mockClear()
        expect(runDeploy([...args], appDir, allowLocal)).toBe(0)
        expect(spawnSync).toHaveBeenCalledOnce()
        expect(spawnArgv()).toContain(args[0] === 'deploy' ? 'deploy' : 'upload')
        expect(stderrLines().join('\n')).not.toContain(BUILD_CI_OUTPUT_MARKER)
      }
    })

    it('still applies triggers when a build:ci marker is present', () => {
      const { appDir } = fixture(layout, true)
      expect(runDeploy(['triggers-deploy'], appDir, allowLocal)).toBe(0)
      expect(spawnArgv(-1)).toContain('triggers')
      expect(stderrLines().join('\n')).not.toContain('refusing to publish')
    })

    it('deploy-local refuses a marker that survived cf:build', async () => {
      const { root } = fixture(layout, true)
      const status = await runDeployLocal({
        cwd: root,
        env: {
          CLOUDFLARE_ACCOUNT_ID: 'account',
          CLOUDFLARE_API_TOKEN: 'token',
          GH_PACKAGES_READ: 'packages-read-value',
          NUXT_OG_IMAGE_SECRET: 'og-image-secret-value',
          NUXT_SESSION_PASSWORD: 'session-password-value',
        },
        flags: { dryRun: false, force: true, noProbe: true, skipMigrate: true, yes: true },
      })
      expect(status).toBe(1)
      const commands = spawnSync.mock.calls.map((call) => (call[1] ?? []).join(' '))
      expect(commands.some((command) => command.includes('cf:build'))).toBe(true)
      expect(commands.some((command) => command.includes('wrangler'))).toBe(false)
      expect(stderrLines().join('\n')).toContain('refusing to publish')
    })
  })
})
