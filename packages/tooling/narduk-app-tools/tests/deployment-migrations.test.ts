import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { defaultDeploymentBlock } from '../src/deployment-config.js'
import {
  assertCiGateGreen,
  assertMigrationContext,
  checkDeploymentMigrationContext,
  deploymentMigrationPaths,
  planDeploymentMigrations,
  parseDeploymentMigrationArgs,
  runDeploymentMigrations,
  writeDeploymentMigrationBundle,
} from '../src/deployment-migrations.js'
import { materializeMigrationBundle, readMigrationBundle } from '../src/migration-bundle.js'
import {
  discoverMigrations,
  loadMigrationConfig,
  type MigrationExecutor,
} from '../src/migrations.js'

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
  const workflow = '.github/workflows/ci.yml'
  const headSha = 'c'.repeat(40)
  const tree = 'd'.repeat(40)
  const checkPath = (commit: string) =>
    `commits/${commit}/check-runs?check_name=${encodeURIComponent(check)}&filter=latest&per_page=100`
  const runsPath = (commit: string) => `actions/runs?head_sha=${commit}&per_page=100`
  const treePath = (commit: string) => `git/commits/${commit}`

  /** One CI workflow run of `commit` and the check run it produced. */
  interface Ev {
    suite: number
    number: number
    conclusion?: string | null
    event?: string
    path?: string
    branch?: string
    repo?: string
    app?: string
    name?: string
    startedAt?: string
    /** The workflow run is in progress and has produced no gate check run yet. */
    noCheckYet?: boolean
    /** Overrides the workflow run's status (a re-run in flight keeps its old green check). */
    runStatus?: string
    /** Pull requests the workflow run belongs to; defaults to #7 for a pull_request run. */
    pulls?: number[]
    /** The gate check run is left from an earlier attempt of a run being re-run. */
    staleCheck?: boolean
  }
  const runId = (e: Ev) => 5000 + e.suite
  const checkId = (e: Ev) => 9000 + e.suite
  const jobsPath = (e: Ev) =>
    `actions/runs/${String(runId(e))}/attempts/${e.staleCheck ? '2' : '1'}/jobs?per_page=100`
  const ci = (commit: string, evs: Ev[]): Record<string, unknown> => ({
    [checkPath(commit)]: {
      total_count: evs.filter((e) => !e.noCheckYet).length,
      check_runs: evs
        .filter((e) => !e.noCheckYet)
        .map((e) => ({
          id: checkId(e),
          name: e.name ?? check,
          status: e.conclusion === null ? 'in_progress' : 'completed',
          conclusion: e.conclusion === undefined ? 'success' : e.conclusion,
          started_at: e.startedAt ?? '2026-10-24T00:00:00Z',
          app: { slug: e.app ?? 'github-actions' },
          check_suite: { id: e.suite },
        })),
    },
    [runsPath(commit)]: {
      total_count: evs.length,
      workflow_runs: evs.map((e) => ({
        id: runId(e),
        run_number: e.number,
        run_attempt: e.staleCheck ? 2 : 1,
        path: e.path ?? workflow,
        event: e.event ?? 'schedule',
        head_sha: commit,
        head_branch: e.branch ?? 'main',
        check_suite_id: e.suite,
        pull_requests: (e.pulls ?? (e.event === 'pull_request' ? [7] : [])).map((number) => ({
          number,
        })),
        status:
          e.runStatus ??
          (e.conclusion === null || (e.noCheckYet && e.conclusion === undefined)
            ? 'in_progress'
            : 'completed'),
        head_repository: { full_name: e.repo ?? 'example/app' },
      })),
    },
    ...Object.fromEntries(
      evs.map((e) => [
        jobsPath(e),
        { total_count: 1, jobs: [{ id: e.staleCheck ? checkId(e) + 1 : checkId(e) }] },
      ]),
    ),
  })
  /** A GitHub whose answers are the table; any other path is a failed read (null). */
  const github =
    (...tables: Array<Record<string, unknown>>): GitHubGet =>
    (path) =>
      Object.assign({}, ...tables)[path] ?? null
  const pull = (sha: string, extra: object = {}) => ({
    number: 7,
    merged_at: '2026-10-24T01:00:00Z',
    merge_commit_sha: sha,
    base: { ref: 'main' },
    head: { sha: headSha, ref: 'feature', repo: { full_name: 'example/app' } },
    ...extra,
  })
  const pullTables = (sha: string, p: object, headEvs: Ev[], headTree = tree) => [
    ci(sha, []),
    { [`commits/${sha}/pulls?per_page=30`]: [p] },
    ci(headSha, headEvs),
    { [treePath(sha)]: { tree: { sha: tree } }, [treePath(headSha)]: { tree: { sha: headTree } } },
  ]
  const prEv: Ev = { suite: 9, number: 4, event: 'pull_request', branch: 'feature' }

  /** A GitHub git tree holding `leaves` (path -> "<mode> <sha>"), and its `git/trees` answers. */
  const fakeTree = (leaves: Record<string, string>) => {
    const table: Record<string, unknown> = {}
    const build = (prefix: string): string => {
      const names = new Set(
        Object.keys(leaves)
          .filter((path) => path.startsWith(prefix))
          .map((path) => path.slice(prefix.length).split('/')[0]!),
      )
      const entries = [...names].sort().map((name) => {
        const leaf = leaves[prefix + name]
        if (leaf === undefined)
          return { path: name, mode: '040000', type: 'tree', sha: build(`${prefix}${name}/`) }
        const [mode, sha] = leaf.split(' ')
        return { path: name, mode, type: mode === '040000' ? 'tree' : 'blob', sha }
      })
      const sha = createHash('sha1').update(JSON.stringify(entries)).digest('hex')
      table[`git/trees/${sha}`] = { sha, tree: entries, truncated: false }
      return sha
    }
    return { root: build(''), table }
  }
  const mergedLeaves = {
    'Config/cloudflare-app.json': `100644 ${'a'.repeat(40)}`,
    'apps/web/wrangler.json': `100644 ${'b'.repeat(40)}`,
    'apps/web/migrations.sources.json': `100644 ${'1'.repeat(40)}`,
    'apps/web/sql': `040000 ${'2'.repeat(40)}`,
    'pnpm-lock.yaml': `100644 ${'3'.repeat(40)}`,
    'README.md': `100644 ${'4'.repeat(40)}`,
  }
  const behindMain = { ...mergedLeaves, 'README.md': `100644 ${'5'.repeat(40)}` }
  /** Recursive listings of the leaf directories: plain SQL, and SQL beside a symlink or a submodule. */
  const subtree = (sha: string, ...modes: string[]) => ({
    [`git/trees/${sha}?recursive=1`]: {
      sha,
      truncated: false,
      tree: modes.map((mode, index) => ({
        path: `000${String(index)}.sql`,
        mode,
        sha: '9'.repeat(40),
      })),
    },
  })
  const subtrees = {
    ...subtree('2'.repeat(40), '100644', '100644'),
    ...subtree('6'.repeat(40), '100644'),
    ...subtree('7'.repeat(40), '100644', '120000'),
    ...subtree('8'.repeat(40), '100644', '160000'),
  }
  /** A merged pull request whose head tree is `headLeaves` and whose merge commit's is `mergedLeaves`. */
  const landedTables = (
    sha: string,
    headLeaves: Record<string, string>,
    headEvs: Ev[] = [prEv],
    landedLeaves: Record<string, string> = mergedLeaves,
  ) => {
    const head = fakeTree(headLeaves)
    const merged = fakeTree(landedLeaves)
    return [
      ci(sha, []),
      { [`commits/${sha}/pulls?per_page=30`]: [pull(sha)] },
      ci(headSha, headEvs),
      head.table,
      merged.table,
      subtrees,
      {
        [treePath(sha)]: { tree: { sha: merged.root } },
        [treePath(headSha)]: { tree: { sha: head.root } },
      },
    ]
  }

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
    const green = github(ci(f.sha, [{ suite: 1, number: 10 }]))
    const proof = (over: object = {}) => ({ gate, gateWorkflow: workflow, get: green, ...over })
    return { f, plan, gate, env, green, proof }
  }

  it('accepts a push and a dispatch on the production branch with the gate green on the commit', () => {
    const t = setup()
    expect(assertMigrationContext(t.plan, t.f.sha, t.f.root, t.env(), false, t.proof())).toContain(
      `${check} succeeded on ${t.f.sha}`,
    )
    expect(() =>
      assertMigrationContext(
        t.plan,
        t.f.sha,
        t.f.root,
        t.env({ GITHUB_EVENT_NAME: 'workflow_dispatch' }),
        false,
        t.proof(),
      ),
    ).not.toThrow()
  })

  it('accepts a merged same-repository pull request that landed as the commit with an identical tree', () => {
    const t = setup()
    const get = github(...pullTables(t.f.sha, pull(t.f.sha), [prEv]))
    expect(
      assertMigrationContext(t.plan, t.f.sha, t.f.root, t.env(), false, t.proof({ get })),
    ).toContain('with an identical tree')
  })

  it('accepts a pull request merged behind the production branch when the migrations it would apply are identical (operator-portal#3173)', () => {
    const t = setup()
    expect(deploymentMigrationPaths(t.plan, t.f.root)).toEqual([
      'Config/cloudflare-app.json',
      'apps/web/migrations.sources.json',
      'apps/web/sql',
      'apps/web/wrangler.json',
    ])
    const run = (headLeaves: Record<string, string>) => () =>
      assertMigrationContext(
        t.plan,
        t.f.sha,
        t.f.root,
        t.env(),
        false,
        t.proof({ get: github(...landedTables(t.f.sha, headLeaves)) }),
      )
    expect(run(behindMain)()).toContain(
      'with identical migrations (Config/cloudflare-app.json, apps/web/migrations.sources.json, apps/web/sql, apps/web/wrangler.json)',
    )
    expect(run({ ...behindMain, 'apps/web/sql': `040000 ${'6'.repeat(40)}` })).toThrow(
      'identical migrations; refusing to migrate',
    )
  })

  it('refuses every event, ref and repository that is not a push or dispatch on the production branch', () => {
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
        assertMigrationContext(t.plan, t.f.sha, t.f.root, t.env(over), false, t.proof()),
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
        t.proof(),
      ),
    ).toThrow('only the commit it runs on')
    expect(() =>
      assertMigrationContext(
        t.plan,
        other,
        t.f.root,
        t.env({ GITHUB_SHA: other }),
        false,
        t.proof(),
      ),
    ).toThrow('--gate-verified names')
    expect(() =>
      assertMigrationContext(t.plan, t.f.sha, t.f.root, t.env(), false, t.proof({ gate: null })),
    ).toThrow('needs --gate-verified')
  })

  it('binds the gate to deployment.promotion.gateCheck, never to the caller', () => {
    const t = setup()
    const get = github(ci(t.f.sha, [{ suite: 1, number: 10, name: 'red-main / reconcile' }]))
    expect(() =>
      assertMigrationContext(
        t.plan,
        t.f.sha,
        t.f.root,
        t.env(),
        false,
        t.proof({ gate: { check: 'red-main / reconcile', sha: t.f.sha }, get }),
      ),
    ).toThrow('only the declared gate')
  })

  it('needs the CI workflow file to be named', () => {
    const t = setup()
    for (const gateWorkflow of [null, '', 'ci.yml', '../ci.yml', '.github/workflows/a/b.yml']) {
      expect(() =>
        assertMigrationContext(
          t.plan,
          t.f.sha,
          t.f.root,
          t.env(),
          false,
          t.proof({ gateWorkflow }),
        ),
      ).toThrow('--gate-workflow')
    }
  })

  it('refuses a GH_REPO that points the reader at another repository', () => {
    const t = setup()
    expect(() =>
      assertMigrationContext(
        t.plan,
        t.f.sha,
        t.f.root,
        t.env({ GH_REPO: 'attacker/fork' }),
        false,
        t.proof(),
      ),
    ).toThrow('GH_REPO')
    expect(() =>
      assertMigrationContext(
        t.plan,
        t.f.sha,
        t.f.root,
        t.env({ GH_REPO: 'example/app' }),
        false,
        t.proof(),
      ),
    ).not.toThrow()
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
        t.proof(),
      ),
    ).toThrow('GITHUB_TOKEN')
  })

  it('never lets a push or dispatch write a preview database or a bundle', () => {
    const t = setup()
    const preview = planDeploymentMigrations(t.f.root, 'preview')
    expect(() =>
      assertMigrationContext(preview, t.f.sha, t.f.root, t.env(), false, t.proof()),
    ).toThrow('cannot migrate preview')
    expect(() =>
      assertMigrationContext(t.plan, t.f.sha, t.f.root, t.env(), true, t.proof()),
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
      assertMigrationContext(t.plan, t.f.sha, t.f.root, t.env(), false, t.proof()),
    ).toThrow('HEAD differs')
  })

  describe('the gate is read from GitHub as CI evidence, not taken on trust', () => {
    const sha = 'a'.repeat(40)
    const gate = {
      check,
      sha,
      workflow,
      repository: 'example/app',
      productionBranch: 'main',
    }
    const pullsPath = `commits/${sha}/pulls?per_page=30`
    const refusal = (get: GitHubGet) => () => assertCiGateGreen(get, gate)
    const direct = (...evs: Ev[]) => github(ci(sha, evs), { [pullsPath]: [] })

    it('refuses red, cancelled, pending, missing and unreadable answers', () => {
      expect(refusal(direct({ suite: 1, number: 1, conclusion: 'failure' }))).toThrow(
        'did not succeed',
      )
      expect(refusal(direct({ suite: 1, number: 1, conclusion: 'cancelled' }))).toThrow(
        'did not succeed',
      )
      expect(refusal(direct({ suite: 1, number: 1, conclusion: null }))).toThrow('still running')
      expect(refusal(direct())).toThrow('not green')
      expect(refusal(github({}))).toThrow('Could not read')
      expect(refusal(github({ [checkPath(sha)]: { check_runs: 'nope' } }))).toThrow(
        'Could not read',
      )
      expect(
        refusal(github(ci(sha, [{ suite: 1, number: 1 }]), { [runsPath(sha)]: null })),
      ).toThrow('Could not read')
      expect(refusal(github(ci(sha, []), { [pullsPath]: 'nope' }))).toThrow('Could not list')
      expect(
        refusal(
          github(ci(sha, [{ suite: 1, number: 1 }]), {
            [runsPath(sha)]: { total_count: 101, workflow_runs: [] },
          }),
        ),
      ).toThrow('more entries than one page')
    })

    it('lets the newest GitHub run_number decide, in both directions', () => {
      const rerunGreen = direct(
        { suite: 1, number: 1, conclusion: 'failure' },
        { suite: 2, number: 2 },
      )
      const rerunRed = direct(
        { suite: 1, number: 1 },
        { suite: 2, number: 2, conclusion: 'failure' },
      )
      expect(assertCiGateGreen(rerunGreen, gate)).toContain('succeeded')
      expect(refusal(rerunRed)).toThrow('did not succeed')
    })

    it('does not order by started_at, which the run creator sets', () => {
      const get = direct(
        { suite: 1, number: 2, conclusion: 'failure', startedAt: '2020-01-01T00:00:00Z' },
        { suite: 2, number: 1, startedAt: '2099-01-01T00:00:00Z' },
      )
      expect(refusal(get)).toThrow('did not succeed')
    })

    it('lets a pending newest run refuse over an older red or green, and never falls through to a pull request', () => {
      for (const older of ['failure', 'success']) {
        const get = direct(
          { suite: 1, number: 1, conclusion: older },
          { suite: 2, number: 2, conclusion: null },
        )
        expect(refusal(get)).toThrow('still running')
      }
      const withPull = github(
        ci(sha, [{ suite: 1, number: 2, conclusion: null }]),
        { [pullsPath]: [pull(sha)] },
        ci(headSha, [prEv]),
        { [treePath(sha)]: { tree: { sha: tree } }, [treePath(headSha)]: { tree: { sha: tree } } },
      )
      expect(refusal(withPull)).toThrow('still running')
    })

    it('treats a newer CI run that has produced no gate check run yet as pending, not as nothing and not as a reason to try the pull request', () => {
      for (const older of ['failure', 'success']) {
        expect(
          refusal(
            direct(
              { suite: 1, number: 1, conclusion: older },
              { suite: 2, number: 2, noCheckYet: true },
            ),
          ),
        ).toThrow('still running')
      }
      const withPull = github(
        ci(sha, [{ suite: 2, number: 2, noCheckYet: true }]),
        { [pullsPath]: [pull(sha)] },
        ci(headSha, [prEv]),
        { [treePath(sha)]: { tree: { sha: tree } }, [treePath(headSha)]: { tree: { sha: tree } } },
      )
      expect(refusal(withPull)).toThrow('still running')
      // A finished newest run that never produced the gate check proves nothing
      // and does not hand authority back to an older green one.
      expect(
        refusal(
          direct(
            { suite: 1, number: 1 },
            { suite: 2, number: 2, noCheckYet: true, conclusion: 'skipped' },
          ),
        ),
      ).toThrow('did not succeed')
    })

    it('judges the gate check, not the whole run: a finished gate check of the current attempt decides while other jobs still run (operator-portal#3173)', () => {
      expect(
        assertCiGateGreen(direct({ suite: 1, number: 1, runStatus: 'in_progress' }), gate),
      ).toContain('succeeded')
      expect(
        refusal(direct({ suite: 1, number: 1, runStatus: 'in_progress', conclusion: 'failure' })),
      ).toThrow('did not succeed')
      expect(
        refusal(direct({ suite: 1, number: 1, runStatus: 'in_progress', conclusion: null })),
      ).toThrow('still running')
    })

    it('does not accept a gate check left from an earlier attempt while the run is being re-run', () => {
      for (const runStatus of ['in_progress', 'queued']) {
        for (const conclusion of ['success', 'failure']) {
          expect(
            refusal(direct({ suite: 1, number: 1, runStatus, conclusion, staleCheck: true })),
          ).toThrow('still running')
        }
      }
      // Once the re-run finishes, its own (latest) gate check decides.
      expect(assertCiGateGreen(direct({ suite: 1, number: 1, staleCheck: true }), gate)).toContain(
        'succeeded',
      )
    })

    it('needs every gate check of an unfinished run to belong to its current attempt', () => {
      const ev: Ev = { suite: 1, number: 1, runStatus: 'in_progress' }
      const checkRun = (id: number) => ({
        id,
        name: check,
        status: 'completed',
        conclusion: 'success',
        app: { slug: 'github-actions' },
        check_suite: { id: 1 },
      })
      const get = github(ci(sha, [ev]), {
        [checkPath(sha)]: { total_count: 2, check_runs: [checkRun(checkId(ev)), checkRun(1)] },
        [pullsPath]: [],
      })
      expect(refusal(get)).toThrow('still running')
    })

    it('refuses when the jobs of the current attempt cannot be read', () => {
      const ev: Ev = { suite: 1, number: 1, runStatus: 'in_progress' }
      expect(refusal(github(ci(sha, [ev]), { [jobsPath(ev)]: null, [pullsPath]: [] }))).toThrow(
        'Could not read',
      )
      expect(
        refusal(
          github(ci(sha, [ev]), {
            [jobsPath(ev)]: { total_count: 101, jobs: [] },
            [pullsPath]: [],
          }),
        ),
      ).toThrow('more entries than one page')
    })

    it('binds the fallback to the pull request that merged, not to another pull request of the same head', () => {
      const answers = (...headEvs: Ev[]) => github(...pullTables(sha, pull(sha), headEvs))
      // A newer green run of a release-branch pull request must not override this one's red run.
      expect(
        refusal(
          answers(
            { ...prEv, suite: 9, number: 4, conclusion: 'failure' },
            { ...prEv, suite: 10, number: 5, pulls: [8] },
          ),
        ),
      ).toThrow('not green')
      // Evidence from a run of some other pull request alone is not evidence.
      expect(refusal(answers({ ...prEv, pulls: [8] }))).toThrow('not green')
      // GitHub empties pull_requests once the pull request merges (operator-portal
      // run 40380182555 after #3173): the run on the pull request's own head
      // branch is its evidence, and a run of the same head from another branch is not.
      expect(assertCiGateGreen(answers({ ...prEv, pulls: [] }), gate)).toContain('#7')
      expect(refusal(answers({ ...prEv, pulls: [], branch: 'release-copy' }))).toThrow('not green')
      expect(
        refusal(
          answers(
            { ...prEv, suite: 9, number: 4, pulls: [], conclusion: 'failure' },
            { ...prEv, suite: 10, number: 5, pulls: [], branch: 'release-copy' },
          ),
        ),
      ).toThrow('not green')
      expect(
        refusal(
          github(
            ...pullTables(
              sha,
              pull(sha, { head: { sha: headSha, repo: { full_name: 'example/app' } } }),
              [{ ...prEv, pulls: [] }],
            ),
          ),
        ),
      ).toThrow('not green')
      expect(assertCiGateGreen(answers({ ...prEv, pulls: [7, 8] }), gate)).toContain('#7')
    })

    it('refuses a tie that holds any red, and accepts only a tie that agrees', () => {
      expect(
        refusal(direct({ suite: 1, number: 3 }, { suite: 2, number: 3, conclusion: 'failure' })),
      ).toThrow('did not succeed')
      expect(
        refusal(direct({ suite: 1, number: 3, conclusion: null }, { suite: 2, number: 3 })),
      ).toThrow('still running')
      expect(
        assertCiGateGreen(direct({ suite: 1, number: 3 }, { suite: 2, number: 3 }), gate),
      ).toContain('succeeded')
    })

    it('does not let a pull request overrule a red run on the commit itself', () => {
      const get = github(
        ci(sha, [{ suite: 1, number: 2, conclusion: 'failure' }]),
        { [pullsPath]: [pull(sha)] },
        ci(headSha, [prEv]),
        { [treePath(sha)]: { tree: { sha: tree } }, [treePath(headSha)]: { tree: { sha: tree } } },
      )
      expect(refusal(get)).toThrow('did not succeed')
    })

    it('ignores a green check of the same name from another workflow, app, event, branch or repository', () => {
      const foreign: Ev[] = [
        { suite: 1, number: 5, path: '.github/workflows/e2e.yml' },
        { suite: 2, number: 5, path: '.github/workflows/ci.yml.evil.yml' },
        { suite: 3, number: 5, app: 'other-app' },
        { suite: 4, number: 5, event: 'pull_request' },
        { suite: 5, number: 5, event: 'pull_request_target' },
        { suite: 6, number: 5, branch: 'feature' },
        { suite: 7, number: 5, repo: 'fork/app' },
      ]
      for (const ev of foreign) expect(refusal(direct(ev))).toThrow('refusing to migrate')
      // A CI run whose only gate check came from another App has no gate at all.
      expect(refusal(direct({ suite: 3, number: 5, app: 'other-app' }))).toThrow('did not succeed')
    })

    it('is not fooled by a green non-CI workflow next to a red CI run', () => {
      const get = direct(
        { suite: 1, number: 1, conclusion: 'failure' },
        {
          suite: 2,
          number: 99,
          path: '.github/workflows/e2e.yml',
          startedAt: '2099-01-01T00:00:00Z',
        },
      )
      expect(refusal(get)).toThrow('did not succeed')
    })

    it('accepts the workflow path spelled with the production branch ref', () => {
      const get = direct({ suite: 1, number: 1, path: `${workflow}@refs/heads/main` })
      expect(assertCiGateGreen(get, gate)).toContain('succeeded')
    })

    it('accepts only a pull request that merged into the production branch as this commit, from this repository, with an identical tree', () => {
      const ok = (p: object, headTree = tree, evs: Ev[] = [prEv]) =>
        github(...pullTables(sha, p, evs, headTree))
      expect(assertCiGateGreen(ok(pull(sha)), gate)).toContain('#7')
      const bad = [
        ok(pull(sha, { merged_at: null })),
        ok(pull(sha, { merge_commit_sha: 'b'.repeat(40) })),
        ok(pull(sha, { base: { ref: 'release' } })),
        ok(pull(sha, { head: { sha: headSha, ref: 'feature', repo: { full_name: 'fork/app' } } })),
        ok(pull(sha, { head: { sha: headSha, ref: 'feature', repo: null } })),
        ok(
          pull(sha, { head: { sha: 'short', ref: 'feature', repo: { full_name: 'example/app' } } }),
        ),
        ok(pull(sha), 'e'.repeat(40)),
        ok(pull(sha), tree, [{ ...prEv, conclusion: 'failure' }]),
        ok(pull(sha), tree, [{ ...prEv, conclusion: null }]),
        ok(pull(sha), tree, [{ ...prEv, event: 'schedule' }]),
        ok(pull(sha), tree, [{ ...prEv, repo: 'fork/app' }]),
        ok(pull(sha), tree, [{ ...prEv, path: '.github/workflows/e2e.yml' }]),
      ]
      for (const get of bad) expect(refusal(get)).toThrow('not green')
    })

    describe('a pull request merged behind the production branch', () => {
      const paths = [
        'Config/cloudflare-app.json',
        'apps/web/migrations.sources.json',
        'apps/web/sql',
        'apps/web/wrangler.json',
        'pnpm-lock.yaml',
      ]
      const migrationsGate = { ...gate, migrationPaths: paths }
      const landed = (headLeaves: Record<string, string>, headEvs?: Ev[]) =>
        github(...landedTables(sha, headLeaves, headEvs))

      it('is accepted when its tree differs only outside the migration paths', () => {
        expect(assertCiGateGreen(landed(behindMain), migrationsGate)).toContain(
          `#7 head ${headSha}, merged as ${sha} with identical migrations`,
        )
        expect(assertCiGateGreen(landed(mergedLeaves), migrationsGate)).toContain(
          'with an identical tree',
        )
      })

      it('is refused when anything it would apply differs, or the head is not green', () => {
        const refused = (get: GitHubGet) => () => assertCiGateGreen(get, migrationsGate)
        const differs = [
          { ...behindMain, 'apps/web/sql': `040000 ${'6'.repeat(40)}` },
          { ...behindMain, 'apps/web/migrations.sources.json': `100644 ${'6'.repeat(40)}` },
          { ...behindMain, 'pnpm-lock.yaml': `100644 ${'6'.repeat(40)}` },
          { ...behindMain, 'apps/web/wrangler.json': `100644 ${'6'.repeat(40)}` },
          { ...behindMain, 'Config/cloudflare-app.json': `100644 ${'6'.repeat(40)}` },
          // A submodule's commit pointer is not the content behind it.
          { ...behindMain, 'apps/web/sql': `160000 ${'2'.repeat(40)}` },
          // A behind-main head lacking the migrations main added.
          Object.fromEntries(
            Object.entries(behindMain).filter(([path]) => path !== 'apps/web/sql'),
          ),
          // Same id, but a file where the merge commit has a directory.
          { ...behindMain, 'apps/web/sql': `100644 ${'2'.repeat(40)}` },
        ]
        for (const leaves of differs)
          expect(refused(landed(leaves))).toThrow('identical migrations; refusing to migrate')
        // Identical on both sides is still refused when git cannot vouch for what the runner reads.
        const both = (leaves: Record<string, string>) =>
          refused(
            github(
              ...landedTables(
                sha,
                { ...leaves, 'README.md': `100644 ${'5'.repeat(40)}` },
                [prEv],
                leaves,
              ),
            ),
          )
        const without = (path: string) =>
          Object.fromEntries(Object.entries(mergedLeaves).filter(([key]) => key !== path))
        const sameEverywhere = [
          // A symlink on the way: its blob says nothing about what it points at.
          { ...without('apps/web/sql'), 'apps/web/sql': `120000 ${'2'.repeat(40)}` },
          // A symlink or a submodule inside the migrations directory.
          { ...mergedLeaves, 'apps/web/sql': `040000 ${'7'.repeat(40)}` },
          { ...mergedLeaves, 'apps/web/sql': `040000 ${'8'.repeat(40)}` },
          // Untracked at both commits: the runner would read it from disk.
          without('apps/web/sql'),
          without('pnpm-lock.yaml'),
        ]
        for (const leaves of sameEverywhere)
          expect(both(leaves)).toThrow('identical migrations; refusing to migrate')
        for (const evs of [
          [{ ...prEv, conclusion: 'failure' }],
          [{ ...prEv, conclusion: null }],
          [],
        ])
          expect(refused(landed(behindMain, evs))).toThrow('not green')
        // Without migration paths (or with none) the whole tree must match, as before.
        expect(refusal(landed(behindMain))).toThrow('identical tree; refusing to migrate')
        expect(() =>
          assertCiGateGreen(landed(behindMain), { ...gate, migrationPaths: [] }),
        ).toThrow('identical tree; refusing to migrate')
      })

      it('treats an unreadable or truncated subtree as a failed read, not a match', () => {
        const tables = landedTables(sha, behindMain)
        const head = tables[3] as Record<string, { tree: Array<{ path: string; sha: string }> }>
        const [rootPath] = Object.entries(head).find(([, body]) =>
          body.tree.some((entry) => entry.path === 'README.md'),
        )!
        expect(() =>
          assertCiGateGreen(github(...tables, { [rootPath]: null }), migrationsGate),
        ).toThrow('Could not read tree')
        for (const truncated of [true, undefined]) {
          expect(() =>
            assertCiGateGreen(
              github(...tables, { [rootPath]: { ...head[rootPath], truncated } }),
              migrationsGate,
            ),
          ).toThrow('Could not read tree')
        }
        const listing = `git/trees/${'2'.repeat(40)}?recursive=1`
        expect(() =>
          assertCiGateGreen(github(...tables, { [listing]: null }), migrationsGate),
        ).toThrow('Could not read tree')
        expect(() =>
          assertCiGateGreen(
            github(...tables, { [listing]: { tree: [], truncated: true } }),
            migrationsGate,
          ),
        ).toThrow('Could not read tree')
      })
    })

    it('treats an unreadable tree as a failed read, not a match', () => {
      const get = github(ci(sha, []), { [pullsPath]: [pull(sha)] }, ci(headSha, [prEv]), {
        [treePath(sha)]: { tree: { sha: tree } },
      })
      expect(refusal(get)).toThrow('Could not read the tree')
    })
  })

  describe('the write path enforces the gate; --check-context only reports it', () => {
    const reached = new Error('executor reached')
    const executor = (() => {
      throw reached
    }) as unknown as MigrationExecutor
    const withEnv = (env: Record<string, string>, run: () => void) => {
      const before = { ...process.env }
      Object.assign(process.env, env)
      try {
        run()
      } finally {
        for (const key of Object.keys(process.env)) if (!(key in before)) delete process.env[key]
        Object.assign(process.env, before)
      }
    }
    const args = (t: ReturnType<typeof setup>, extra: string[] = []) =>
      parseDeploymentMigrationArgs([
        '--target',
        'production',
        '--sha',
        t.f.sha,
        '--gate-verified',
        `${check}@${t.f.sha}`,
        '--gate-workflow',
        workflow,
        ...extra,
      ])

    it('a write in push context reaches the executor only when the gate is green', () => {
      const t = setup()
      const options = { ...args(t), cwd: t.f.root }
      const red = github(ci(t.f.sha, [{ suite: 1, number: 1, conclusion: 'failure' }]))
      withEnv({ ...t.env(), CLOUDFLARE_API_TOKEN: 'token' }, () => {
        expect(() => runDeploymentMigrations(options, executor, { get: red })).toThrow(
          'did not succeed',
        )
        expect(() => runDeploymentMigrations(options, executor, { get: github({}) })).toThrow(
          'Could not read',
        )
        expect(() => runDeploymentMigrations(options, executor, { get: t.green })).toThrow(reached)
      })
      withEnv(
        { ...t.env({ GITHUB_EVENT_NAME: 'pull_request' }), CLOUDFLARE_API_TOKEN: 'token' },
        () =>
          expect(() => runDeploymentMigrations(options, executor, { get: t.green })).toThrow(
            'workflow_run',
          ),
      )
    })

    it('--check-context reads without a Cloudflare credential, reports a red gate, and fails an unreadable GitHub or wrong context', () => {
      const t = setup()
      const options = { ...args(t, ['--check-context']), cwd: t.f.root }
      expect(options).toMatchObject({ checkContext: true, gateWorkflow: workflow })
      const red = github(ci(t.f.sha, [{ suite: 1, number: 1, conclusion: 'failure' }]))
      withEnv(t.env(), () => {
        delete process.env.CLOUDFLARE_API_TOKEN
        expect(checkDeploymentMigrationContext(options, { get: t.green })).toContain('succeeded')
        expect(checkDeploymentMigrationContext(options, { get: red })).toContain(
          'a write would be refused now',
        )
        expect(() => checkDeploymentMigrationContext(options, { get: github({}) })).toThrow(
          'Could not read',
        )
        process.env.GH_REPO = 'attacker/fork'
        expect(() => checkDeploymentMigrationContext(options, { get: t.green })).toThrow('GH_REPO')
      })
      withEnv(t.env({ GITHUB_EVENT_NAME: 'pull_request' }), () =>
        expect(() => checkDeploymentMigrationContext(options, { get: t.green })).toThrow(),
      )
    })

    it('parses and validates the flags', () => {
      const t = setup()
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
      expect(() =>
        parseDeploymentMigrationArgs([
          '--target',
          'production',
          '--sha',
          t.f.sha,
          '--gate-workflow',
          'ci.yml',
        ]),
      ).toThrow()
    })
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

describe('deploymentMigrationPaths', () => {
  /** Commits whatever is on disk, as a checkout of that commit would hold it. */
  const commit = (root: string) => {
    execFileSync('git', ['add', '-A'], { cwd: root })
    execFileSync(
      'git',
      [
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.com',
        'commit',
        '--allow-empty',
        '-qm',
        'paths',
      ],
      { cwd: root },
    )
  }
  const withSources = (sources: object[]) => {
    const f = fixture()
    writeFileSync(join(f.root, 'apps/web/migrations.sources.json'), JSON.stringify({ sources }))
    writeFileSync(join(f.root, '.gitignore'), 'node_modules\n')
    commit(f.root)
    const plan = () => planDeploymentMigrations(f.root, 'production')
    return {
      f,
      /** The paths of what is on disk once committed. */
      paths: () => {
        commit(f.root)
        return deploymentMigrationPaths(plan(), f.root)
      },
      /** The paths of the working tree as it is. */
      onDisk: () => deploymentMigrationPaths(plan(), f.root),
    }
  }
  /** A pnpm virtual-store entry named `entry`, linked at apps/web/node_modules/@x/<name>. */
  const pnpmPackage = (root: string, entry: string, name: string) => {
    const real = join(root, 'node_modules/.pnpm', entry, 'node_modules/@x', name)
    mkdirSync(join(real, 'drizzle'), { recursive: true })
    mkdirSync(join(root, 'apps/web/node_modules/@x'), { recursive: true })
    symlinkSync(real, join(root, 'apps/web/node_modules/@x', name))
  }
  const lock = (root: string) =>
    writeFileSync(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n')

  it('pins a registry package by the lockfile, and a workspace link by its repository path', () => {
    const t = withSources([
      { source: 'app', path: 'sql', sourceVersion: '1' },
      { source: '@x/pkg', path: 'node_modules/@x/pkg/drizzle', sourceVersion: '1' },
      { source: '@x/ws', path: 'node_modules/@x/ws/drizzle', sourceVersion: '1' },
    ])
    pnpmPackage(t.f.root, '@x+pkg@1.2.3_zod@4.0.0', 'pkg')
    mkdirSync(join(t.f.root, 'packages/ws/drizzle'), { recursive: true })
    symlinkSync(join(t.f.root, 'packages/ws'), join(t.f.root, 'apps/web/node_modules/@x/ws'))
    // An installed package with no lockfile to pin it cannot be proved identical.
    expect(t.paths()).toBeNull()
    lock(t.f.root)
    expect(t.paths()).toEqual([
      'Config/cloudflare-app.json',
      'apps/web/migrations.sources.json',
      'apps/web/sql',
      'apps/web/wrangler.json',
      'packages/ws/drizzle',
      'pnpm-lock.yaml',
    ])
  })

  it('cannot pin a package pnpm installed from a directory, or one outside the pnpm store', () => {
    const injected = withSources([
      { source: '@x/db', path: 'node_modules/@x/db/drizzle', sourceVersion: '1' },
    ])
    lock(injected.f.root)
    pnpmPackage(injected.f.root, '@x+db@file+packages+db', 'db')
    expect(injected.paths()).toBeNull()
    const copied = withSources([
      { source: '@x/db', path: 'node_modules/@x/db/drizzle', sourceVersion: '1' },
    ])
    lock(copied.f.root)
    mkdirSync(join(copied.f.root, 'apps/web/node_modules/@x/db/drizzle'), { recursive: true })
    expect(copied.paths()).toBeNull()
  })

  it('cannot pin a package that is not installed, or a source outside the checkout, missing or reached through a symlink', () => {
    const missing = withSources([
      { source: '@x/pkg', path: 'node_modules/@x/pkg/drizzle', sourceVersion: '1' },
    ])
    lock(missing.f.root)
    expect(missing.paths()).toBeNull()
    expect(
      withSources([{ source: 'app', path: '../../..', sourceVersion: '1' }]).paths(),
    ).toBeNull()
    expect(
      withSources([{ source: 'app', path: 'generated', sourceVersion: '1' }]).paths(),
    ).toBeNull()
    const linked = withSources([{ source: 'app', path: 'vendor/pkg/drizzle', sourceVersion: '1' }])
    pnpmPackage(linked.f.root, '@x+pkg@1.2.3', 'pkg')
    lock(linked.f.root)
    mkdirSync(join(linked.f.root, 'apps/web/vendor'))
    symlinkSync(
      join(linked.f.root, 'apps/web/node_modules/@x/pkg'),
      join(linked.f.root, 'apps/web/vendor/pkg'),
    )
    expect(linked.paths()).toBeNull()
  })

  it('needs a lockfile to pin which directory a workspace link resolves to', () => {
    const t = withSources([
      { source: '@x/ws', path: 'node_modules/@x/ws/drizzle', sourceVersion: '1' },
    ])
    mkdirSync(join(t.f.root, 'packages/ws/drizzle'), { recursive: true })
    mkdirSync(join(t.f.root, 'apps/web/node_modules/@x'), { recursive: true })
    symlinkSync(join(t.f.root, 'packages/ws'), join(t.f.root, 'apps/web/node_modules/@x/ws'))
    expect(t.paths()).toBeNull()
    lock(t.f.root)
    expect(t.paths()).toContain('pnpm-lock.yaml')
  })

  it('cannot vouch for a compared path whose files on disk differ from the commit', () => {
    const t = withSources([{ source: 'app', path: 'sql', sourceVersion: '1' }])
    expect(t.onDisk()).toContain('apps/web/sql')
    writeFileSync(join(t.f.root, 'apps/web/sql/0002_gen.sql'), 'DROP TABLE example;')
    expect(t.onDisk()).toBeNull()
    writeFileSync(join(t.f.root, '.gitignore'), 'node_modules\napps/web/sql/*_gen.sql\n')
    commit(t.f.root)
    expect(t.onDisk()).toBeNull()
    rmSync(join(t.f.root, 'apps/web/sql/0002_gen.sql'))
    expect(t.onDisk()).toContain('apps/web/sql')
    writeFileSync(join(t.f.root, 'apps/web/sql/0001.sql'), 'DROP TABLE example;')
    expect(t.onDisk()).toBeNull()
    // A top-level path that git could read as pathspec magic is matched literally.
    const magic = withSources([{ source: 'app', path: '../../:sql', sourceVersion: '1' }])
    mkdirSync(join(magic.f.root, ':sql'))
    writeFileSync(join(magic.f.root, ':sql/0001.sql'), 'CREATE TABLE example (id TEXT);')
    expect(magic.paths()).toContain(':sql')
    writeFileSync(join(magic.f.root, ':sql/0002.sql'), 'DROP TABLE example;')
    expect(magic.onDisk()).toBeNull()
  })
})
