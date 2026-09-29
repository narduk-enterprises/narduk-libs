import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { defaultDeploymentBlock } from '../src/deployment-config.js'
import type { WranglerVersionsClient } from '../src/promote.js'
import {
  assertProductionBuildSecret,
  hotfixBuildEnv,
  hotfixProductionEnv,
  readDeployment,
  readProductionTarget,
  scanPublicAssetsForSecretLeaks,
} from '../src/ship-support.js'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function appWithPublic(files: Record<string, string>): string {
  const app = mkdtempSync(join(tmpdir(), 'ship-support-'))
  roots.push(app)
  for (const [name, content] of Object.entries(files)) {
    const path = join(app, '.output', 'public', name)
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, content)
  }
  return app
}

describe('scanPublicAssetsForSecretLeaks', () => {
  it('names each secret found in a nested text asset', () => {
    const app = appWithPublic({
      'a/leak.js': 'const t = "synthetic-secret-value"',
      'clean.css': 'body{}',
    })
    const hits = scanPublicAssetsForSecretLeaks(app, { API_TOKEN: 'synthetic-secret-value' })
    expect(hits).toHaveLength(1)
    expect(hits[0]).toContain('API_TOKEN appears in')
    expect(hits[0]).toContain('leak.js')
  })

  it('ignores short values, binary extensions and a missing output directory', () => {
    const app = appWithPublic({ 'logo.png': 'synthetic-secret-value', 'a.js': 'short' })
    expect(
      scanPublicAssetsForSecretLeaks(app, { X: 'short', Y: 'synthetic-secret-value' }),
    ).toEqual([])
    expect(
      scanPublicAssetsForSecretLeaks(join(app, 'missing'), { Y: 'synthetic-secret-value' }),
    ).toEqual([])
  })
})

describe('build environments', () => {
  const env = { PATH: process.env.PATH, HOME: process.env.HOME }
  const identity = { sha: 'a'.repeat(40), baseUrl: 'https://example.com' }

  it('only forwards public build configuration and forces the exact build identity', () => {
    const result = hotfixBuildEnv(
      {
        ...env,
        GH_PACKAGES_READ: 'secret',
        NUXT_SESSION_PASSWORD: 'secret',
        CLOUDFLARE_API_TOKEN: 'token',
        GITHUB_SHA: 'wrong',
        NUXT_PUBLIC_BUILD_VERSION: 'wrong',
        NUXT_PUBLIC_TITLE: 'Title',
        WORKERS_CI_BRANCH: 'preview',
      },
      identity,
    )
    expect(result).toMatchObject({
      BUILD_VERSION: identity.sha,
      NUXT_PUBLIC_BUILD_VERSION: identity.sha,
      NUXT_PUBLIC_TITLE: 'Title',
      SITE_URL: identity.baseUrl,
    })
    for (const key of [
      'GH_PACKAGES_READ',
      'NUXT_SESSION_PASSWORD',
      'CLOUDFLARE_API_TOKEN',
      'WORKERS_CI_BRANCH',
    ])
      expect(result).not.toHaveProperty(key)
  })

  it('passes stable app secrets only to the production build and rejects CI placeholders', () => {
    const stable = 'synthetic-app-build-secret-1234567890'
    const result = hotfixProductionEnv({ ...env, NUXT_OG_IMAGE_SECRET: stable }, identity)
    expect(result.NUXT_OG_IMAGE_SECRET).toBe(stable)
    expect(result.NARDUK_ALLOW_LOCAL_WRANGLER_DEPLOY).toBe('1')
    expect(hotfixBuildEnv({ ...env, NUXT_OG_IMAGE_SECRET: stable }, identity)).not.toHaveProperty(
      'NUXT_OG_IMAGE_SECRET',
    )
    expect(() =>
      hotfixProductionEnv(
        { ...env, NUXT_OG_IMAGE_SECRET: 'narduk-test-only-og-image-secret-000000' },
        identity,
      ),
    ).toThrow('test placeholder')
    expect(() => hotfixProductionEnv({ ...env, NUXT_SESSION_PASSWORD: 'short' }, identity)).toThrow(
      'production build secret',
    )
    expect(() => assertProductionBuildSecret('OTHER', 'short')).not.toThrow()
  })
})

describe('readDeployment', () => {
  const client = (rows: unknown): WranglerVersionsClient =>
    ({ listDeployments: vi.fn(async () => rows) }) as unknown as WranglerVersionsClient
  const row = (id: string, createdOn: string, versions: Array<[string, number]>) => ({
    id,
    created_on: createdOn,
    versions: versions.map(([version_id, percentage]) => ({ version_id, percentage })),
  })

  it('returns the single version serving 100%', async () => {
    const current = row('d1', '2026-09-29T01:00:00Z', [['v1', 100]])
    await expect(readDeployment(client([current]))).resolves.toEqual(current)
  })

  it('rejects split traffic, an ambiguous timestamp and malformed history', async () => {
    await expect(
      readDeployment(
        client([
          row('d1', '2026-09-29T01:00:00Z', [
            ['v1', 50],
            ['v2', 50],
          ]),
        ]),
      ),
    ).rejects.toThrow('single-version')
    await expect(
      readDeployment(
        client([
          row('d1', '2026-09-29T01:00:00Z', [['v1', 100]]),
          row('d2', '2026-09-29T01:00:00Z', [['v2', 100]]),
        ]),
      ),
    ).rejects.toThrow('ambiguous')
    await expect(readDeployment(client([{ id: 'x' }]))).rejects.toThrow()
  })
})

describe('readProductionTarget', () => {
  const ACCOUNT = 'a'.repeat(32)

  function target(wrangler: Record<string, unknown>, workerName = 'example'): string {
    const root = mkdtempSync(join(tmpdir(), 'ship-target-'))
    roots.push(root)
    mkdirSync(join(root, 'Config'))
    writeFileSync(join(root, 'wrangler.jsonc'), JSON.stringify(wrangler))
    writeFileSync(
      join(root, 'Config/cloudflare-app.json'),
      JSON.stringify({
        worker: { name: workerName },
        deployment: { ...defaultDeploymentBlock({ appSlug: 'example' }), accountId: ACCOUNT },
      }),
    )
    return root
  }

  it('reads the committed account and Worker name', () => {
    const result = readProductionTarget(target({ name: 'example', account_id: ACCOUNT }), {})
    expect(result).toMatchObject({ accountId: ACCOUNT, workerName: 'example' })
  })

  it('refuses a Wrangler build hook, a name mismatch and a cross-account environment', () => {
    expect(() =>
      readProductionTarget(
        target({ name: 'example', account_id: ACCOUNT, build: { command: 'pnpm run build' } }),
        {},
      ),
    ).toThrow('upload must not rebuild')
    expect(() => readProductionTarget(target({ name: 'other', account_id: ACCOUNT }), {})).toThrow(
      'Worker names disagree',
    )
    expect(() =>
      readProductionTarget(target({ name: 'example', account_id: ACCOUNT }), {
        CLOUDFLARE_ACCOUNT_ID: 'b'.repeat(32),
      }),
    ).toThrow('account IDs disagree')
  })
})
