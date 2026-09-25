import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

const plainTextVars = vi.hoisted(() => ({ value: {} as Record<string, string> }))
vi.mock('../src/cloudflare.js', () => ({
  fetchWorkerPlainTextVars: vi.fn(async () => plainTextVars.value),
}))
const spawnSync = vi.hoisted(() => vi.fn(() => ({ status: 0, stdout: '', stderr: '' })))
vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawnSync,
}))

const { runDeployLocal } = await import('../src/deploy-local.js')

const tempDirs: string[] = []
afterEach(() => {
  for (const path of tempDirs.splice(0)) rmSync(path, { force: true, recursive: true })
  spawnSync.mockClear()
})

function appDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'narduk-deploy-local-'))
  tempDirs.push(dir)
  writeFileSync(join(dir, 'wrangler.jsonc'), JSON.stringify({ name: 'example-app' }))
  return dir
}

const env = {
  CLOUDFLARE_ACCOUNT_ID: 'account',
  CLOUDFLARE_API_TOKEN: 'token',
  GH_PACKAGES_READ: 'x',
  NUXT_OG_IMAGE_SECRET: 'x',
  NUXT_SESSION_PASSWORD: 'x',
}
const flags = { dryRun: false, force: true, noProbe: false, skipMigrate: false, yes: true }

describe('deploy-local SITE_URL (#877)', () => {
  it.each([[''], ['http://example.com'], ['https://localhost:3000']])(
    'refuses %j before running anything',
    async (siteUrl) => {
      plainTextVars.value = siteUrl ? { SITE_URL: siteUrl } : {}
      await expect(runDeployLocal({ cwd: appDir(), env, flags })).rejects.toThrow(
        'Refusing deploy: SITE_URL must be a non-local https URL',
      )
      expect(spawnSync).not.toHaveBeenCalled()
    },
  )

  it('refuses in a dry run too, so the preview matches the real run', async () => {
    plainTextVars.value = { SITE_URL: 'http://127.0.0.1' }
    await expect(
      runDeployLocal({ cwd: appDir(), env, flags: { ...flags, dryRun: true } }),
    ).rejects.toThrow('Refusing deploy')
  })

  it('leaves SITE_URL alone under --no-probe', async () => {
    plainTextVars.value = {}
    await expect(
      runDeployLocal({ cwd: appDir(), env, flags: { ...flags, dryRun: true, noProbe: true } }),
    ).resolves.toBe(0)
  })
})
