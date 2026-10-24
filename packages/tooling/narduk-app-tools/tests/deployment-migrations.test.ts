import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { defaultDeploymentBlock } from '../src/deployment-config.js'
import {
  assertCiGateGreen,
  assertMigrationContext,
  checkDeploymentMigrationContext,
  planDeploymentMigrations,
  parseDeploymentMigrationArgs,
  writeDeploymentMigrationBundle,
} from '../src/deployment-migrations.js'
import { materializeMigrationBundle, readMigrationBundle } from '../src/migration-bundle.js'
import { discoverMigrations, loadMigrationConfig } from '../src/migrations.js'

import type { GitHubGet } from '../src/commit-containment.js'

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
})

describe('push / workflow_dispatch migration context (operator-portal#2791)', () => {
  const check = 'ci / Required'
  const headSha = 'c'.repeat(40)
  const run = (conclusion: string | null, started: string, extra: object = {}) => ({
    name: check,
    status: conclusion ? 'completed' : 'in_progress',
    conclusion,
    started_at: started,
    app: { slug: 'github-actions' },
    ...extra,
  })
  const checks = (...runs: object[]) => ({ total_count: runs.length, check_runs: runs })
  const checkPath = (commit: string) =>
    `commits/${commit}/check-runs?check_name=${encodeURIComponent(check)}&per_page=100`
  /** A GitHub whose answers are the table; any other path is a failed read (null). */
  const github =
    (answers: Record<string, unknown>): GitHubGet =>
    (path) =>
      answers[path] ?? null
  const pull = (sha: string, extra: object = {}) => ({
    number: 7,
    merged_at: '2026-10-24T01:00:00Z',
    merge_commit_sha: sha,
    base: { ref: 'main' },
    head: { sha: headSha, repo: { full_name: 'example/app' } },
    ...extra,
  })
  const setup = () => {
    const f = fixture()
    const plan = planDeploymentMigrations(f.root, 'production')
    const gate = { check, sha: f.sha }
    const env = (over: Record<string, string> = {}) => ({
      GITHUB_ACTIONS: 'true',
      GITHUB_EVENT_NAME: 'push',
      GITHUB_REPOSITORY: 'example/app',
      GITHUB_REF: 'refs/heads/main',
      GITHUB_SHA: f.sha,
      GITHUB_TOKEN: 'token',
      ...over,
    })
    const green = github({ [checkPath(f.sha)]: checks(run('success', '2026-10-24T00:00:00Z')) })
    const viaPull = github({
      [checkPath(f.sha)]: checks(),
      [`commits/${f.sha}/pulls?per_page=30`]: [pull(f.sha)],
      [checkPath(headSha)]: checks(run('success', '2026-10-23T00:00:00Z')),
    })
    return { f, plan, gate, env, green, viaPull }
  }
  const context = (t: ReturnType<typeof setup>, over: object = {}) => ({
    gate: t.gate,
    get: t.green,
    ...over,
  })

  it('accepts a push and a dispatch on the production branch with the check green on the commit', () => {
    const t = setup()
    expect(assertMigrationContext(t.plan, t.f.sha, t.f.root, t.env(), false, context(t))).toContain(
      `${check} succeeded on ${t.f.sha}`,
    )
    expect(() =>
      assertMigrationContext(
        t.plan,
        t.f.sha,
        t.f.root,
        t.env({ GITHUB_EVENT_NAME: 'workflow_dispatch' }),
        false,
        context(t),
      ),
    ).not.toThrow()
  })

  it('accepts a merged same-repository pull request that landed as the commit when the commit has no run', () => {
    const t = setup()
    expect(
      assertMigrationContext(
        t.plan,
        t.f.sha,
        t.f.root,
        t.env(),
        false,
        context(t, { get: t.viaPull }),
      ),
    ).toContain(`head ${headSha}, merged as ${t.f.sha}`)
  })

  it('refuses every event and ref that is not a push or dispatch on the production branch', () => {
    const t = setup()
    for (const over of [
      { GITHUB_EVENT_NAME: 'pull_request' },
      { GITHUB_EVENT_NAME: 'pull_request_target' },
      { GITHUB_EVENT_NAME: 'schedule' },
      { GITHUB_EVENT_NAME: 'repository_dispatch' },
      { GITHUB_EVENT_NAME: '' },
      { GITHUB_REF: 'refs/heads/feature' },
      { GITHUB_REF: 'refs/pull/7/merge' },
      { GITHUB_REF: 'refs/tags/main' },
      { GITHUB_REPOSITORY: 'fork/app' },
      { GITHUB_ACTIONS: 'false' },
    ] as Array<Record<string, string>>) {
      expect(() =>
        assertMigrationContext(t.plan, t.f.sha, t.f.root, t.env(over), false, context(t)),
      ).toThrow()
    }
  })

  it('refuses a SHA that is not the one the run is for, and a gate for another commit', () => {
    const t = setup()
    const other = 'b'.repeat(40)
    expect(() =>
      assertMigrationContext(
        t.plan,
        t.f.sha,
        t.f.root,
        t.env({ GITHUB_SHA: other }),
        false,
        context(t),
      ),
    ).toThrow('only the commit it runs on')
    expect(() =>
      assertMigrationContext(
        t.plan,
        other,
        t.f.root,
        t.env({ GITHUB_SHA: other }),
        false,
        context(t),
      ),
    ).toThrow('--gate-verified names')
    expect(() =>
      assertMigrationContext(t.plan, t.f.sha, t.f.root, t.env(), false, context(t, { gate: null })),
    ).toThrow('needs --gate-verified')
  })

  it('refuses without a GitHub token rather than skipping the proof', () => {
    const t = setup()
    expect(() =>
      assertMigrationContext(
        t.plan,
        t.f.sha,
        t.f.root,
        t.env({ GITHUB_TOKEN: '' }),
        false,
        context(t),
      ),
    ).toThrow('GITHUB_TOKEN')
  })

  it('never lets a push or dispatch write a preview database or a bundle', () => {
    const t = setup()
    const preview = planDeploymentMigrations(t.f.root, 'preview')
    expect(() =>
      assertMigrationContext(preview, t.f.sha, t.f.root, t.env(), false, context(t)),
    ).toThrow('cannot migrate preview')
    expect(() =>
      assertMigrationContext(t.plan, t.f.sha, t.f.root, t.env(), true, context(t)),
    ).toThrow('cannot migrate preview')
  })

  it('refuses a checkout that is not the migrated commit', () => {
    const t = setup()
    writeFileSync(join(t.f.root, 'later'), 'x')
    execFileSync('git', ['add', '.'], { cwd: t.f.root })
    execFileSync(
      'git',
      ['-c', 'user.name=T', '-c', 'user.email=t@example.com', 'commit', '-qm', 'later'],
      { cwd: t.f.root },
    )
    expect(() =>
      assertMigrationContext(t.plan, t.f.sha, t.f.root, t.env(), false, context(t)),
    ).toThrow('HEAD differs')
  })

  describe('the gate is read from GitHub, not taken on trust', () => {
    const sha = 'a'.repeat(40)
    const gate = { check, sha }
    const pullsPath = `commits/${sha}/pulls?per_page=30`
    const now = '2026-10-24T00:00:00Z'
    const old = '2026-10-23T00:00:00Z'
    const refusal = (get: GitHubGet) => () => assertCiGateGreen(get, gate, 'example/app', 'main')

    it('refuses red, pending, missing and unreadable answers', () => {
      const failed = github({ [checkPath(sha)]: checks(run('failure', now)) })
      const cancelled = github({ [checkPath(sha)]: checks(run('cancelled', now)) })
      const none = github({ [checkPath(sha)]: checks(), [pullsPath]: [] })
      const pending = github({ [checkPath(sha)]: checks(run(null, now)), [pullsPath]: [] })
      const unreadable = github({})
      const malformed = github({ [checkPath(sha)]: { check_runs: 'nope' } })
      const noPulls = github({ [checkPath(sha)]: checks(), [pullsPath]: 'nope' })
      const truncated = github({
        [checkPath(sha)]: { total_count: 101, check_runs: [run('success', now)] },
      })
      expect(refusal(failed)).toThrow('did not succeed')
      expect(refusal(cancelled)).toThrow('did not succeed')
      expect(refusal(none)).toThrow('not green')
      expect(refusal(pending)).toThrow('not green')
      expect(refusal(unreadable)).toThrow('Could not read')
      expect(refusal(malformed)).toThrow('Could not read')
      expect(refusal(noPulls)).toThrow('Could not list')
      expect(refusal(truncated)).toThrow('more runs than one page')
    })

    it('lets the newest run decide, in both directions', () => {
      const rerunGreen = github({
        [checkPath(sha)]: checks(run('failure', old), run('success', now)),
      })
      const rerunRed = github({
        [checkPath(sha)]: checks(run('success', old), run('failure', now)),
      })
      expect(assertCiGateGreen(rerunGreen, gate, 'example/app', 'main')).toContain('succeeded')
      expect(refusal(rerunRed)).toThrow('did not succeed')
    })

    it('does not let a pull request overrule a red run on the commit itself', () => {
      const get = github({
        [checkPath(sha)]: checks(run('failure', now)),
        [pullsPath]: [pull(sha)],
        [checkPath(headSha)]: checks(run('success', now)),
      })
      expect(refusal(get)).toThrow('did not succeed')
    })

    it('ignores a same-named check that GitHub Actions did not create', () => {
      const get = github({
        [checkPath(sha)]: checks(run('success', now, { app: { slug: 'other-app' } })),
        [pullsPath]: [],
      })
      expect(refusal(get)).toThrow('not green')
    })

    it('accepts only a pull request that merged into the production branch as this commit from this repository', () => {
      const answers = (p: object) =>
        github({
          [checkPath(sha)]: checks(),
          [pullsPath]: [p],
          [checkPath(headSha)]: checks(run('success', now)),
        })
      expect(assertCiGateGreen(answers(pull(sha)), gate, 'example/app', 'main')).toContain('#7')
      const unmerged = answers(pull(sha, { merged_at: null }))
      const otherMerge = answers(pull(sha, { merge_commit_sha: 'b'.repeat(40) }))
      const otherBase = answers(pull(sha, { base: { ref: 'release' } }))
      const fork = answers(pull(sha, { head: { sha: headSha, repo: { full_name: 'fork/app' } } }))
      const noRepo = answers(pull(sha, { head: { sha: headSha, repo: null } }))
      const shortHead = answers(
        pull(sha, { head: { sha: 'short', repo: { full_name: 'example/app' } } }),
      )
      for (const get of [unmerged, otherMerge, otherBase, fork, noRepo, shortHead]) {
        expect(refusal(get)).toThrow('not green')
      }
    })

    it('refuses a pull request whose head is not green', () => {
      const get = github({
        [checkPath(sha)]: checks(),
        [pullsPath]: [pull(sha)],
        [checkPath(headSha)]: checks(run('failure', now)),
      })
      expect(refusal(get)).toThrow('not green')
    })
  })

  it('reads the context proof without a Cloudflare credential, and parses its flags', () => {
    const t = setup()
    const options = parseDeploymentMigrationArgs([
      '--target',
      'production',
      '--sha',
      t.f.sha,
      '--gate-verified',
      `${check}@${t.f.sha}`,
      '--check-context',
    ])
    expect(options).toMatchObject({ checkContext: true, gate: { check, sha: t.f.sha } })
    const before = { ...process.env }
    Object.assign(process.env, t.env())
    delete process.env.CLOUDFLARE_API_TOKEN
    try {
      expect(
        checkDeploymentMigrationContext({ ...options, cwd: t.f.root }, { get: t.green }),
      ).toContain('succeeded')
      process.env.GITHUB_EVENT_NAME = 'pull_request'
      expect(() =>
        checkDeploymentMigrationContext({ ...options, cwd: t.f.root }, { get: t.green }),
      ).toThrow()
    } finally {
      for (const key of Object.keys(process.env)) if (!(key in before)) delete process.env[key]
      Object.assign(process.env, before)
    }
    expect(() =>
      parseDeploymentMigrationArgs(['--target', 'production', '--check-context']),
    ).toThrow('--check-context')
    expect(() =>
      parseDeploymentMigrationArgs([
        '--target',
        'production',
        '--sha',
        t.f.sha,
        '--gate-verified',
        `${check}@${'b'.repeat(40)}`,
      ]),
    ).toThrow('must name the --sha')
  })
})

describe('deployment migration bundles', () => {
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
