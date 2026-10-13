/**
 * Every reader of Config/cloudflare-app.json / Config/project-lifecycle.json,
 * driven from the portal's copy through an injected fetch, with NO local file in
 * the checkout. One portal-mode test per converted reader, plus the loud failure
 * each one owes when neither source resolves.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  AppConfigError,
  clearPrimedAppConfig,
  primeAppCheckoutConfig,
  primeAppConfig,
} from '../../src/app-config/resolve.js'
import { withPrimedAppCheckout } from '../../src/commands/checkout-root.js'
import {
  assertMigrationRunnerOwnership,
  readDeclaredDatabaseOwnership,
} from '../../src/database-ownership.js'
import {
  DEPLOY_APP_CONFIG_LOCATE,
  primeDeployAppConfig,
  selectDeployConfig,
  writeFlattenedWranglerDeployConfig,
} from '../../src/deploy.js'
import { defaultDeploymentBlock } from '../../src/deployment-config.js'
import { findMigrationCheckout, planDeploymentMigrations } from '../../src/deployment-migrations.js'
import { planD1Create, PLACEHOLDER_D1_DATABASE_ID } from '../../src/d1-create.js'
import { runDeploymentCheck } from '../../src/foundation/evaluate-deployment.js'
import { readWaiverConfig } from '../../src/foundation/evaluate-nac-status.js'
import { readCloudflareApp } from '../../src/foundation/items/item-1-scaffold-parity.js'
import { AppRepo } from '../../src/foundation/source.js'
import { validateCloudflareManifest } from '../../src/manifests-validate.js'
import { readProductionTarget } from '../../src/ship-support.js'
import { fakePortal, TOKEN } from './fake-portal.js'

const REPO = 'example/app'
const ACCOUNT = '0123456789abcdef0123456789abcdef'
const dirs: string[] = []

beforeEach(() => {
  clearPrimedAppConfig()
  vi.stubEnv('NARDUK_APP_CONFIG_SOURCE', 'portal')
  vi.stubEnv('OPERATOR_PORTAL_APP_CONFIG_TOKEN', TOKEN)
  vi.stubEnv('GITHUB_REPOSITORY', REPO)
})
afterEach(() => {
  vi.unstubAllEnvs()
  for (const dir of dirs.splice(0)) rmSync(dir, { force: true, recursive: true })
  clearPrimedAppConfig()
})

/** A checkout with NO Config/ directory at all, as an app looks once its files are deleted. */
function checkout(files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'narduk-readers-'))
  dirs.push(root)
  mkdirSync(join(root, '.git'))
  const all = { 'package.json': '{"name":"fixture","private":true}\n', ...files }
  for (const [rel, text] of Object.entries(all)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true })
    writeFileSync(join(root, rel), text)
  }
  return root
}

const served = (document: unknown, file = 'cloudflare-app.json') =>
  fakePortal({
    [`${REPO}/${file}`]: { contractOwnership: 'portal-owned', ...(document as object) },
  })

const WRANGLER = JSON.stringify({
  name: 'app',
  account_id: ACCOUNT,
  d1_databases: [
    { binding: 'DB', database_name: 'app-db', database_id: PLACEHOLDER_D1_DATABASE_ID },
  ],
})

describe('foundation checks (AppRepo)', () => {
  it('reads cloudflare-app.json and project-lifecycle.json from the portal', async () => {
    const root = checkout()
    const portal = fakePortal({
      [`${REPO}/cloudflare-app.json`]: {
        contractOwnership: 'portal-owned',
        access: { exposureClass: 'public' },
      },
      [`${REPO}/project-lifecycle.json`]: { contractOwnership: 'portal-owned', environments: [] },
    })
    await primeAppCheckoutConfig(root, { fetch: portal.fetch })
    const repo = new AppRepo(root)
    expect(repo.exists('Config/cloudflare-app.json')).toBe(true)
    expect(readCloudflareApp(repo)).toMatchObject({ access: { exposureClass: 'public' } })
    expect(JSON.parse(repo.read('Config/project-lifecycle.json')!)).toMatchObject({
      environments: [],
    })
    // No file was written: the portal copy is not a cache on disk.
    expect(() => readFileSync(join(root, 'Config/cloudflare-app.json'))).toThrow()
  })

  it('an unprimed read throws instead of reporting the file absent', () => {
    expect(() => new AppRepo(checkout()).read('Config/cloudflare-app.json')).toThrow(AppConfigError)
  })

  it('withPrimedAppCheckout resolves both documents before a command runs', async () => {
    const root = checkout()
    await expect(
      withPrimedAppCheckout({ checkoutDir: root }, 'test', {
        fetch: fakePortal({}, { status: 503 }).fetch,
      }),
    ).rejects.toMatchObject({ code: 'unavailable' })
    await withPrimedAppCheckout({ checkoutDir: root }, 'test', { fetch: fakePortal().fetch })
    expect(new AppRepo(root).read('Config/cloudflare-app.json')).toBeNull()
  })

  it('foundation:check:deployment judges the portal declaration', async () => {
    const root = checkout({ 'apps/web/wrangler.json': WRANGLER })
    const portal = served({
      worker: { wranglerConfig: 'apps/web/wrangler.json' },
      deployment: { ...defaultDeploymentBlock({ appSlug: 'app' }), accountId: ACCOUNT },
    })
    await primeAppCheckoutConfig(root, { fetch: portal.fetch })
    const artefact = runDeploymentCheck({
      root,
      toolVersion: '0.0.0-test',
      generated: '2026-10-13T00:00:00Z',
    })
    expect(artefact.declaration.standard).toBe('narduk-v1')
  })
})

describe('waivers', () => {
  it('reads waivers from the portal document', async () => {
    const root = checkout()
    const waiver = { check: 'packages', issue: '#1', expires: '2026-12-01' }
    await primeAppCheckoutConfig(root, { fetch: served({ waivers: [waiver] }).fetch })
    expect(readWaiverConfig(root)).toEqual([waiver])
  })

  it('never drops waivers because nothing resolved', async () => {
    const root = checkout()
    expect(() => readWaiverConfig(root)).toThrow(AppConfigError)
    await expect(
      primeAppCheckoutConfig(root, { fetch: fakePortal({}, { status: 401 }).fetch }),
    ).rejects.toMatchObject({ code: 'unauthorized' })
    expect(() => readWaiverConfig(root)).toThrow(AppConfigError)
  })

  it('an authoritative 404 means the repository declares none', async () => {
    const root = checkout()
    await primeAppCheckoutConfig(root, { fetch: fakePortal({}).fetch })
    expect(readWaiverConfig(root)).toEqual([])
  })
})

describe('manifests validate', () => {
  it('compares wrangler with the portal declaration', async () => {
    const root = checkout({
      'apps/web/wrangler.jsonc': JSON.stringify({
        ...JSON.parse(WRANGLER),
        workers_dev: false,
        preview_urls: false,
      }),
    })
    const declaration = (d1: unknown[]) =>
      served({
        worker: {
          wranglerConfig: 'apps/web/wrangler.jsonc',
          workersDev: false,
          previewUrls: false,
        },
        bindings: { d1, kv: [], r2: [], queues: [], cron: [] },
      })
    await primeAppCheckoutConfig(root, { fetch: declaration([{ binding: 'DB' }]).fetch })
    expect(validateCloudflareManifest(root).findings).toEqual([])

    clearPrimedAppConfig()
    await primeAppCheckoutConfig(root, { fetch: declaration([]).fetch })
    expect(validateCloudflareManifest(root).findings.map((f) => f.field)).toContain('bindings.d1')
  })
})

describe('db create', () => {
  it('takes the database name from the portal declaration', async () => {
    const root = checkout({ 'apps/web/wrangler.jsonc': WRANGLER })
    const env = {
      CLOUDFLARE_ACCOUNT_ID: ACCOUNT,
      NARDUK_APP_CONFIG_SOURCE: 'portal',
    } as NodeJS.ProcessEnv
    const portal = served({
      worker: { name: 'app', wranglerConfig: 'apps/web/wrangler.jsonc' },
      bindings: { d1: [{ binding: 'DB' }] },
    })
    await primeAppCheckoutConfig(root, { fetch: portal.fetch })
    expect(planD1Create({ checkoutDir: root, env })).toMatchObject({
      databaseName: 'app-db',
      binding: 'DB',
    })
  })

  it('refuses when the declaration cannot be resolved', () => {
    expect(() =>
      planD1Create({ checkoutDir: checkout(), env: { CLOUDFLARE_ACCOUNT_ID: ACCOUNT } }),
    ).toThrow(AppConfigError)
  })
})

describe('database ownership guard', () => {
  const ownership = {
    deployment: {
      databaseOwnership: [
        {
          binding: 'READ_MODEL',
          owner: 'contract',
          contract: 'contracts/read-model.json',
          verify: 'pnpm run read-model:check',
        },
      ],
    },
  }

  it('enforces contract ownership declared on the portal row', async () => {
    const root = checkout()
    await primeAppConfig({
      dir: root,
      files: ['cloudflare-app.json'],
      fetch: served(ownership).fetch,
    })
    expect(readDeclaredDatabaseOwnership(root)).toMatchObject({ kind: 'declared', root })
    expect(() => assertMigrationRunnerOwnership({ database: 'READ_MODEL', cwd: root })).toThrow(
      /contract-owned/,
    )
    expect(() => assertMigrationRunnerOwnership({ database: 'DB', cwd: root })).not.toThrow()
  })

  it('does not switch itself off when the portal cannot be asked', async () => {
    const root = checkout()
    expect(() => readDeclaredDatabaseOwnership(root)).toThrow(AppConfigError)
    await expect(
      primeAppConfig({
        dir: root,
        files: ['cloudflare-app.json'],
        fetch: fakePortal({}, { status: 503 }).fetch,
      }),
    ).rejects.toMatchObject({ code: 'unavailable' })
    expect(() => assertMigrationRunnerOwnership({ database: 'DB', cwd: root })).toThrow(
      AppConfigError,
    )
  })

  it('outside any checkout it refuses in portal mode and says "none" only in file mode', () => {
    const outside = mkdtempSync(join(tmpdir(), 'narduk-outside-'))
    dirs.push(outside)
    expect(() => readDeclaredDatabaseOwnership(outside)).toThrow(/NARDUK_APP_CONFIG_SOURCE=file/)
    vi.stubEnv('NARDUK_APP_CONFIG_SOURCE', 'file')
    expect(readDeclaredDatabaseOwnership(outside)).toEqual({ kind: 'none' })
  })
})

describe('deployment migrations', () => {
  it('plans from the portal declaration', async () => {
    const root = checkout({
      'apps/web/wrangler.json': JSON.stringify({
        account_id: ACCOUNT,
        d1_databases: [
          {
            binding: 'DB',
            database_name: 'prod',
            database_id: 'c9c9a190-7e04-4fb7-a2ed-d82d26bf50a1',
          },
        ],
      }),
      'apps/web/sql/0001.sql': 'CREATE TABLE example (id TEXT);',
      'apps/web/migrations.sources.json': JSON.stringify({
        sources: [{ source: 'app', path: 'sql', sourceVersion: '1' }],
      }),
    })
    const portal = served({
      product: { repository: REPO },
      worker: { wranglerConfig: 'apps/web/wrangler.json' },
      deployment: {
        ...defaultDeploymentBlock({ appSlug: 'app' }),
        accountId: ACCOUNT,
        promotion: {
          mode: 'auto-on-green',
          gateCheck: 'ci / Required',
          credential: 'cloudflare/prd/app-promote',
        },
        migrations: {
          compatibility: 'expand-contract',
          credential: 'cloudflare/prd/app-migrate',
          databases: [{ binding: 'DB', sources: 'apps/web/migrations.sources.json' }],
        },
      },
    })
    await primeAppConfig({ dir: root, files: ['cloudflare-app.json'], fetch: portal.fetch })
    const found = findMigrationCheckout(join(root, 'apps/web'))
    expect(found).toBe(root)
    expect(planDeploymentMigrations(found, 'production').databases[0]?.binding).toBe('DB')
  })

  it('names the missing declaration instead of planning from nothing', () => {
    expect(() => planDeploymentMigrations(checkout(), 'production')).toThrow(AppConfigError)
  })
})

describe('deploy (versions-upload on a branch build)', () => {
  function app() {
    const root = checkout({
      'apps/web/wrangler.json': JSON.stringify({
        name: 'app',
        kv_namespaces: [{ binding: 'KV', id: 'prod-kv' }],
      }),
    })
    const appDir = join(root, 'apps/web')
    const sourceConfigPath = join(appDir, 'wrangler.json')
    const productionConfigPath = writeFlattenedWranglerDeployConfig(sourceConfigPath)
    return { root, appDir, sourceConfigPath, productionConfigPath }
  }
  const env = {
    NARDUK_APP_CONFIG_SOURCE: 'portal',
    OPERATOR_PORTAL_APP_CONFIG_TOKEN: TOKEN,
    GITHUB_REPOSITORY: REPO,
    WORKERS_CI_BRANCH: 'feature-x',
  }
  const select = (a: ReturnType<typeof app>) =>
    selectDeployConfig({
      action: 'versions-upload',
      appDir: a.appDir,
      sourceConfigPath: a.sourceConfigPath,
      productionConfigPath: a.productionConfigPath,
      passthroughArgs: [],
      env,
      log: () => {},
    })

  it('rebinds a preview branch from the portal declaration', async () => {
    const a = app()
    const portal = served({
      deployment: {
        ...defaultDeploymentBlock({ appSlug: 'app' }),
        nonProductionBranchBuilds: true,
        previewBindings: {
          d1: [],
          kv: [{ binding: 'KV', id: 'preview-kv' }],
          r2: [],
        },
      },
    })
    await primeDeployAppConfig(['versions-upload'], a.appDir, env, { fetch: portal.fetch })
    const path = select(a)
    expect(path).not.toBe(a.productionConfigPath)
    expect(readFileSync(path, 'utf8')).toContain('preview-kv')
    expect(readFileSync(path, 'utf8')).not.toContain('prod-kv')
  })

  it('fails loudly, never with production bindings, when nothing resolves', async () => {
    const a = app()
    expect(() => select(a)).toThrow(AppConfigError)
    await expect(
      primeDeployAppConfig(['versions-upload'], a.appDir, env, { fetch: fakePortal({}).fetch }),
    ).rejects.toMatchObject({ code: 'not-found' })
    await expect(
      primeDeployAppConfig(
        ['versions-upload'],
        a.appDir,
        { ...env, OPERATOR_PORTAL_APP_CONFIG_TOKEN: '' },
        {
          fetch: served({}).fetch,
        },
      ),
    ).rejects.toMatchObject({ code: 'no-token' })
  })

  it('does not reach for the portal for an action or branch that never reads the declaration', async () => {
    const a = app()
    const portal = fakePortal()
    await primeDeployAppConfig(['deploy'], a.appDir, env, { fetch: portal.fetch })
    await primeDeployAppConfig(
      ['versions-upload'],
      a.appDir,
      { ...env, WORKERS_CI_BRANCH: '' },
      { fetch: portal.fetch },
    )
    expect(portal.calls).toHaveLength(0)
    expect(DEPLOY_APP_CONFIG_LOCATE.maxDepth).toBe(6)
  })
})

describe('ship', () => {
  it('reads the production target from the portal declaration', async () => {
    const root = checkout({
      'wrangler.jsonc': JSON.stringify({ name: 'example', account_id: ACCOUNT }),
    })
    const env = {
      NARDUK_APP_CONFIG_SOURCE: 'portal',
      OPERATOR_PORTAL_APP_CONFIG_TOKEN: TOKEN,
      GITHUB_REPOSITORY: REPO,
    }
    const portal = served({
      worker: { name: 'example' },
      deployment: { ...defaultDeploymentBlock({ appSlug: 'example' }), accountId: ACCOUNT },
    })
    await primeAppConfig({
      ...DEPLOY_APP_CONFIG_LOCATE,
      env,
      dir: root,
      files: ['cloudflare-app.json'],
      required: true,
      fetch: portal.fetch,
    })
    expect(readProductionTarget(root, env)).toMatchObject({
      accountId: ACCOUNT,
      workerName: 'example',
    })
  })

  it('says why when there is no declaration, rather than "Missing"', () => {
    const root = checkout({ 'wrangler.jsonc': JSON.stringify({ name: 'example' }) })
    expect(() => readProductionTarget(root, { NARDUK_APP_CONFIG_SOURCE: 'portal' })).toThrow(
      AppConfigError,
    )
  })
})

describe('the CLI primes before it reads', () => {
  it('manifests validate resolves the declaration through the global fetch', async () => {
    const root = checkout({
      'apps/web/wrangler.jsonc': JSON.stringify({
        ...JSON.parse(WRANGLER),
        workers_dev: false,
        preview_urls: false,
      }),
    })
    const portal = served({
      worker: { wranglerConfig: 'apps/web/wrangler.jsonc', workersDev: false, previewUrls: false },
      bindings: { d1: [{ binding: 'DB' }], kv: [], r2: [], queues: [], cron: [] },
    })
    vi.stubGlobal('fetch', (url: string, init: Parameters<typeof portal.fetch>[1]) =>
      portal.fetch(url, init),
    )
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { main } = await import('../../src/cli.js')
    expect(await main(['manifests', 'validate', '--checkout', root])).toBe(0)
    expect(portal.calls.map((call) => call.url.searchParams.get('file')).sort()).toEqual([
      'cloudflare-app.json',
      'project-lifecycle.json',
    ])
    expect(log.mock.calls.flat().join('\n')).toContain('agree')
    vi.unstubAllGlobals()
    log.mockRestore()
  })

  it('a portal outage stops the command with a scrubbed message and exit 1', async () => {
    const root = checkout()
    const portal = fakePortal({}, { error: new Error(`reset while sending ${TOKEN}`) })
    vi.stubGlobal('fetch', (url: string, init: Parameters<typeof portal.fetch>[1]) =>
      portal.fetch(url, init),
    )
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { main } = await import('../../src/cli.js')
    expect(await main(['manifests', 'validate', '--checkout', root])).toBe(1)
    const printed = errors.mock.calls.flat().join('\n')
    expect(printed).toContain('Could not reach the portal')
    expect(printed).not.toContain(TOKEN)
    vi.unstubAllGlobals()
    errors.mockRestore()
  })
})
