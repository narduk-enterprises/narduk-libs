import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { defaultDeploymentBlock } from '../src/deployment-config.js'
import {
  assertMigrationContext,
  planDeploymentMigrations,
  parseDeploymentMigrationArgs,
  writeDeploymentMigrationBundle,
} from '../src/deployment-migrations.js'
import { materializeMigrationBundle, readMigrationBundle } from '../src/migration-bundle.js'
import { discoverMigrations, loadMigrationConfig } from '../src/migrations.js'

const paths: string[] = []
afterEach(() => {
  for (const path of paths.splice(0)) rmSync(path, { force: true, recursive: true })
})
const productionId = 'c9c9a190-7e04-4fb7-a2ed-d82d26bf50a1'
const previewId = 'd9c9a190-7e04-4fb7-a2ed-d82d26bf50a1'
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'narduk-deployment-migrations-'))
  paths.push(root)
  mkdirSync(join(root, 'Config'))
  mkdirSync(join(root, 'apps/web/sql'), { recursive: true })
  writeFileSync(join(root, 'apps/web/sql/0001.sql'), 'CREATE TABLE example (id TEXT);')
  writeFileSync(
    join(root, 'apps/web/migrations.sources.json'),
    JSON.stringify({ sources: [{ source: 'app', path: 'sql', sourceVersion: '1' }] }),
  )
  const manifest = {
    product: { repository: 'example/app' },
    worker: { wranglerConfig: 'apps/web/wrangler.json' },
    deployment: {
      ...defaultDeploymentBlock({ appSlug: 'app' }),
      accountId: 'a'.repeat(32),
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
      previewBindings: {
        d1: [{ binding: 'DB', database_name: 'preview-db', database_id: previewId }],
        kv: [],
        r2: [],
      },
    },
  }
  const save = () =>
    writeFileSync(join(root, 'Config/cloudflare-app.json'), JSON.stringify(manifest))
  save()
  writeFileSync(
    join(root, 'apps/web/wrangler.json'),
    JSON.stringify({
      account_id: 'a'.repeat(32),
      d1_databases: [{ binding: 'DB', database_name: 'production-db', database_id: productionId }],
    }),
  )
  execFileSync('git', ['init', '-q'], { cwd: root })
  execFileSync('git', ['add', '.'], { cwd: root })
  execFileSync(
    'git',
    ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'fixture'],
    { cwd: root },
  )
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  return { root, manifest, save, sha }
}
describe('deployment migration targets and trust boundary', () => {
  it('resolves preview IDs with a minimal explicit config, never a build redirect', () => {
    const f = fixture()
    const p = planDeploymentMigrations(f.root, 'preview')
    expect(p.databases[0]?.databaseId).toBe(previewId)
    expect(JSON.stringify(p.config)).not.toContain(productionId)
    expect(Object.keys(p.config).sort()).toEqual(['account_id', 'd1_databases'])
  })
  it('refuses missing coverage and a preview pointing at production', () => {
    const f = fixture()
    f.manifest.deployment.previewBindings.d1[0]!.database_id = productionId
    f.save()
    expect(() => planDeploymentMigrations(f.root, 'preview')).toThrow('Unsafe preview')
    f.manifest.deployment.migrations.databases = []
    f.save()
    expect(() => planDeploymentMigrations(f.root, 'production')).toThrow()
  })
  it('requires exact-SHA same-repo successful CI and a matching checked-out production commit', () => {
    const f = fixture()
    const plan = planDeploymentMigrations(f.root, 'production')
    const event = join(f.root, 'event.json')
    const run = {
      conclusion: 'success',
      head_sha: f.sha,
      head_branch: 'main',
      head_repository: { full_name: 'example/app' },
    }
    writeFileSync(event, JSON.stringify({ workflow_run: run }))
    const env = {
      GITHUB_ACTIONS: 'true',
      GITHUB_EVENT_NAME: 'workflow_run',
      GITHUB_EVENT_PATH: event,
      GITHUB_REPOSITORY: 'example/app',
    }
    expect(() => assertMigrationContext(plan, f.sha, f.root, env)).not.toThrow()
    expect(() => assertMigrationContext(plan, 'b'.repeat(40), f.root, env)).toThrow(
      'exact CI-verified SHA',
    )
    expect(() =>
      assertMigrationContext(plan, f.sha, f.root, { ...env, GITHUB_REPOSITORY: 'fork/app' }),
    ).toThrow()
    run.head_branch = 'feature'
    writeFileSync(event, JSON.stringify({ workflow_run: run }))
    expect(() => assertMigrationContext(plan, f.sha, f.root, env)).toThrow('production branch')
    expect(() =>
      assertMigrationContext(planDeploymentMigrations(f.root, 'preview'), f.sha, f.root, env),
    ).toThrow('SQL-only bundle')
    expect(() =>
      assertMigrationContext(
        planDeploymentMigrations(f.root, 'preview'),
        f.sha,
        f.root,
        { ...env, GITHUB_REF: 'refs/heads/main' },
        true,
      ),
    ).not.toThrow()
  })
  it('round trips SQL as data without retaining paths or executable files', () => {
    const f = fixture()
    const path = join(f.root, 'bundle.json')
    writeDeploymentMigrationBundle(path, f.root)
    const bundle = readMigrationBundle(path, 'example/app', f.sha)
    const directory = join(f.root, 'unpacked')
    mkdirSync(directory)
    const sources = materializeMigrationBundle(bundle, directory)
    const loaded = loadMigrationConfig(join(directory, sources.get('DB')!))
    expect(discoverMigrations(loaded.config, loaded.baseDir)[0]?.checksum).toBe(
      bundle.databases[0]?.migrations[0]?.checksum,
    )
    expect(readFileSync(path, 'utf8')).not.toContain(f.root)
    expect(() => readMigrationBundle(path, 'fork/app', f.sha)).toThrow('repository/SHA')
    bundle.databases[0]!.migrations[0]!.sql = 'DROP TABLE example;'
    writeFileSync(path, JSON.stringify(bundle))
    expect(() => readMigrationBundle(path, 'example/app', f.sha)).toThrow('checksum differs')
  })
  it('rejects unsafe bundle filenames', () => {
    const f = fixture()
    const path = join(f.root, 'bundle.json')
    writeDeploymentMigrationBundle(path, f.root)
    const bundle = JSON.parse(readFileSync(path, 'utf8'))
    bundle.databases[0].migrations[0].filename = '../escape.sql'
    writeFileSync(path, JSON.stringify(bundle))
    expect(() => readMigrationBundle(path, 'example/app', f.sha)).toThrow()
  })
  it('checks arguments before opening credentials or a target', () => {
    expect(parseDeploymentMigrationArgs(['--target', 'preview', '--check'])).toEqual({
      target: 'preview',
      check: true,
    })
    expect(() => parseDeploymentMigrationArgs(['--target', 'production'])).toThrow('--sha')
    expect(() =>
      parseDeploymentMigrationArgs([
        '--target',
        'production',
        '--bundle',
        'bundle.json',
        '--sha',
        'a'.repeat(40),
      ]),
    ).toThrow('--bundle')
  })
})

describe('preview bundle edge cases', () => {
  it('keeps empty source directories so a database with no new SQL can be checked', () => {
    const f = fixture()
    rmSync(join(f.root, 'apps/web/sql/0001.sql'))
    const path = join(f.root, 'empty.json')
    writeDeploymentMigrationBundle(path, f.root)
    const bundle = readMigrationBundle(path, 'example/app', f.sha)
    const directory = join(f.root, 'unpacked')
    mkdirSync(directory)
    const sources = materializeMigrationBundle(bundle, directory)
    const loaded = loadMigrationConfig(join(directory, sources.get('DB')!))
    expect(discoverMigrations(loaded.config, loaded.baseDir)).toEqual([])
  })
  it('rejects SQL addressing the runner coordination tables even with a valid checksum', () => {
    const f = fixture()
    writeFileSync(join(f.root, 'apps/web/sql/0001.sql'), 'DELETE FROM _narduk_migration_lock;')
    const path = join(f.root, 'unsafe.json')
    writeDeploymentMigrationBundle(path, f.root)
    expect(() => readMigrationBundle(path, 'example/app', f.sha)).toThrow('runner ledger or lock')
  })
  it('refuses using the promote credential or an escaping source manifest', () => {
    const f = fixture()
    f.manifest.deployment.migrations.credential = f.manifest.deployment.promotion.credential
    f.save()
    expect(() => planDeploymentMigrations(f.root, 'production')).toThrow('separate Cloudflare')
    f.manifest.deployment.migrations.credential = 'cloudflare/prd/app-migrate'
    f.manifest.deployment.migrations.databases[0]!.sources = '/etc/hosts'
    f.save()
    expect(() => planDeploymentMigrations(f.root, 'production')).toThrow('relative to the checkout')
  })
})
