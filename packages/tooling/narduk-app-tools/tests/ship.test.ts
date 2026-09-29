import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { commitContains, landedContains, resolveContainment } from '../src/commit-containment.js'
import { defaultDeploymentBlock } from '../src/deployment-config.js'
import type { WorkerDeployment, WorkerVersion, WranglerVersionsClient } from '../src/promote.js'
import {
  parseShipArgs,
  productionOrigin,
  promoteWorkflowGap,
  runShip,
  SHIP_EXIT,
  type ShipContext,
} from '../src/ship.js'
import type { VerifyReport } from '../src/verify-live.js'

const roots: string[] = []
const ACCOUNT = 'a'.repeat(32)
const TOKEN = 'synthetic-cloudflare-secret-token'
const OLD = '11111111-1111-4111-8111-111111111111'
const NEW = '22222222-2222-4222-8222-222222222222'

/** A fake GitHub: compare answers by base, merged PRs by served commit. */
function fakeGh(options: { ahead?: string[]; pulls?: Record<string, string[]>; down?: boolean }) {
  return (path: string): unknown => {
    if (options.down) return null
    const compare = /^compare\/([a-f\d]+)\.\.\./u.exec(path)
    if (compare) return { status: options.ahead?.includes(compare[1]) ? 'ahead' : 'diverged' }
    const pulls = /^commits\/([a-f\d]+)\/pulls$/u.exec(path)
    if (pulls)
      return (options.pulls?.[pulls[1]] ?? []).map((sha) => ({
        merged_at: '2026-09-29T00:00:00Z',
        merge_commit_sha: sha,
      }))
    return null
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function temp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

function gitIn(cwd: string) {
  return (...args: string[]) =>
    execFileSync(
      'git',
      [
        '-c',
        'user.name=Fixture',
        '-c',
        'user.email=fixture@example.test',
        '-c',
        'commit.gpgsign=false',
        '-c',
        'init.defaultBranch=main',
        ...args,
      ],
      { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    ).trim()
}

/** An app repo with a bare origin: main pushed, a feature branch checked out one commit ahead. */
function fixture(options: { migrations?: boolean } = {}) {
  const origin = temp('ship-origin-')
  gitIn(origin)('init', '-q', '--bare')
  const root = temp('ship-app-')
  const git = gitIn(root)
  git('init', '-q')
  const app = join(root, 'apps/web')
  mkdirSync(app, { recursive: true })
  mkdirSync(join(root, 'Config'))
  mkdirSync(join(app, 'migrations'))
  writeFileSync(join(app, 'migrations/0001.sql'), 'create table a (id int);\n')
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ scripts: { 'ship:check': 'check', 'ship:build': 'build' } }),
  )
  writeFileSync(join(root, '.gitignore'), '.output/\nnode_modules/\n')
  writeFileSync(
    join(app, 'wrangler.jsonc'),
    JSON.stringify({ name: 'example', account_id: ACCOUNT }),
  )
  const deployment = { ...defaultDeploymentBlock({ appSlug: 'example' }), accountId: ACCOUNT }
  writeFileSync(
    join(root, 'Config/cloudflare-app.json'),
    JSON.stringify({
      worker: { name: 'example' },
      environments: [{ name: 'production', hostname: 'example.com', workerEnv: null }],
      deployment: options.migrations
        ? {
            ...deployment,
            migrations: {
              compatibility: 'expand-contract',
              credential: 'cloudflare/prd/example-migrate',
              databases: [{ binding: 'DB', sources: 'apps/web/migrations' }],
            },
          }
        : deployment,
    }),
  )
  git('add', '.')
  git('commit', '-qm', 'base')
  git('remote', 'add', 'origin', origin)
  git('push', '-q', 'origin', 'main')
  const mainSha = git('rev-parse', 'HEAD')
  git('checkout', '-q', '-b', 'feat-x')
  writeFileSync(join(app, 'feature.txt'), 'new\n')
  git('add', '.')
  git('commit', '-qm', 'feature')
  return { root, app, git, origin, mainSha, sha: git('rev-parse', 'HEAD') }
}

function harness(options: { migrations?: boolean; servedTag?: string | null } = {}) {
  const f = fixture(options)
  const servedTag = options.servedTag === undefined ? f.mainSha : options.servedTag
  let active: WorkerDeployment = {
    id: 'previous-deployment',
    created_on: '2026-09-29T01:00:00Z',
    versions: [{ version_id: OLD, percentage: 100 }],
  }
  const oldVersion: WorkerVersion = {
    id: OLD,
    ...(servedTag ? { annotations: { 'workers/tag': servedTag } } : {}),
  }
  let versions: WorkerVersion[] = [oldVersion]
  const calls: string[] = []
  const client: WranglerVersionsClient = {
    listDeployments: vi.fn(async () => [active]),
    listVersions: vi.fn<WranglerVersionsClient['listVersions']>(async () => ({
      versions,
      complete: true,
      limit: 100,
      source: 'api',
    })),
    deployVersion: vi.fn(async (id: string) => {
      calls.push(`promote ${id === NEW ? 'new' : 'old'}`)
      active = {
        id: `deployment-${String(calls.length)}`,
        created_on: `2026-09-29T02:0${String(calls.length)}:00Z`,
        versions: [{ version_id: id, percentage: 100 }],
      }
    }),
    rollback: vi.fn(async () => {
      throw new Error('ship rolls back with deployVersion')
    }),
  }
  const proof: VerifyReport = {
    schemaVersion: 1,
    tool: '@narduk-enterprises/narduk-app-tools/verify-live',
    generated: '2026-09-29T02:01:00Z',
    baseUrl: 'https://example.com',
    expectedSha: f.sha,
    attemptsUsed: 1,
    attemptsAllowed: 6,
    assertions: [],
    result: 'PASS',
    exitCode: 0,
  }
  const run = vi.fn<NonNullable<ShipContext['run']>>(async (args, _cwd, childEnv) => {
    calls.push(args[1])
    expect(childEnv.CLOUDFLARE_API_TOKEN).toBeUndefined()
    expect(childEnv.BUILD_VERSION).toBe(f.git('rev-parse', 'HEAD'))
    if (args[1] === 'ship:build') {
      mkdirSync(join(f.app, '.output/server'), { recursive: true })
      mkdirSync(join(f.app, '.output/public'), { recursive: true })
      writeFileSync(join(f.app, '.output/server/index.mjs'), 'export default {}')
    }
  })
  let pushedBeforeUpload: boolean | undefined
  const upload = vi.fn<NonNullable<ShipContext['upload']>>((args, _cwd, childEnv) => {
    calls.push('upload')
    expect(childEnv?.CLOUDFLARE_API_TOKEN).toBe(TOKEN)
    pushedBeforeUpload =
      gitIn(f.origin)('rev-parse', 'refs/heads/feat-x') === f.git('rev-parse', 'HEAD')
    versions = [
      {
        id: NEW,
        annotations: {
          'workers/tag': args[args.indexOf('--tag') + 1],
          'workers/message': args[args.indexOf('--message') + 1],
        },
      },
      oldVersion,
    ]
    return 0
  })
  const verify = vi.fn<NonNullable<ShipContext['verify']>>(async (flags) => {
    calls.push('verify')
    expect(flags.expectSha).toBe(f.git('rev-parse', 'HEAD'))
    expect(flags.baseUrl).toBe('https://example.com')
    return proof
  })
  const gh = vi.fn<NonNullable<ShipContext['gh']>>((args) => {
    calls.push(`gh ${args[0]} ${args[1]}`)
    if (args[1] === 'view') throw new Error('no pull requests found')
    return 'https://github.com/example/app/pull/7'
  })
  const logs: string[] = []
  const context: ShipContext = {
    cwd: f.root,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, CLOUDFLARE_API_TOKEN: TOKEN },
    log: (line) => logs.push(line),
    run,
    client: () => client,
    upload,
    verify,
    gh,
    // Real git; GitHub is offline unless a case says otherwise.
    containment: (root, candidate, served) =>
      resolveContainment(root, candidate, served, { github: fakeGh({ down: true }) }),
  }
  return {
    ...f,
    context,
    client,
    calls,
    proof,
    logs,
    upload,
    pushedBeforeUpload: () => pushedBeforeUpload,
  }
}

// Each case runs real git against a bare origin; under the full parallel suite
// that outgrows vitest's 5 s default.
const GIT_TIMEOUT = 30_000

describe('commit containment', { timeout: GIT_TIMEOUT }, () => {
  it('answers for ancestry, squash merges and divergence', () => {
    const f = fixture()
    // Squash-merge the feature onto main: a new commit, same change.
    f.git('checkout', '-q', 'main')
    f.git('merge', '-q', '--squash', 'feat-x')
    f.git('commit', '-qm', 'squash')
    const squash = f.git('rev-parse', 'HEAD')
    expect(commitContains(f.root, squash, f.mainSha)).toBe('contained')
    expect(commitContains(f.root, squash, f.sha)).toBe('contained')
    expect(commitContains(f.root, f.mainSha, f.sha)).toBe('not-contained')
    expect(commitContains(f.root, squash, 'f'.repeat(40))).toBe('unknown')
  })

  it('asks GitHub when the checkout lacks the objects or a review fix rewrote the lines', () => {
    const served = 'a'.repeat(40)
    const candidate = 'b'.repeat(40)
    const merge = 'c'.repeat(40)
    expect(landedContains(candidate, served, fakeGh({ ahead: [served] }))).toBe('contained')
    // The ship PR squash-merged with a follow-up fix: served is not an ancestor
    // and conflicts textually, but its PR landed in the candidate's history.
    expect(
      landedContains(candidate, served, fakeGh({ ahead: [merge], pulls: { [served]: [merge] } })),
    ).toBe('contained')
    expect(landedContains(candidate, served, fakeGh({ pulls: { [served]: [merge] } }))).toBe(
      'not-contained',
    )
    expect(landedContains(candidate, served, fakeGh({}))).toBe('not-contained')
    expect(landedContains(candidate, served, fakeGh({ down: true }))).toBe('unknown')
  })

  it("takes GitHub's yes over a local no, and never fetches", () => {
    const f = fixture()
    const before = f.git('config', '--list')
    expect(resolveContainment(f.root, f.mainSha, f.sha, { github: fakeGh({ down: true }) })).toBe(
      'not-contained',
    )
    expect(
      resolveContainment(f.root, f.mainSha, f.sha, { github: fakeGh({ ahead: [f.sha] }) }),
    ).toBe('contained')
    expect(
      resolveContainment(f.root, f.mainSha, 'f'.repeat(40), { github: fakeGh({ down: true }) }),
    ).toBe('unknown')
    expect(f.git('config', '--list')).toBe(before)
  })
})

describe('narduk-app ship', { timeout: GIT_TIMEOUT }, () => {
  it('checks, builds, publishes, proves and opens an auto-merge PR', async () => {
    const h = harness()
    await expect(runShip(parseShipArgs([]), h.context)).resolves.toBe(SHIP_EXIT.ok)
    expect(h.calls).toEqual([
      'ship:check',
      'ship:build',
      'upload',
      'promote new',
      'verify',
      'gh pr view',
      'gh pr create',
      'gh pr merge',
    ])
    expect(h.upload.mock.calls[0][0]).toEqual(
      expect.arrayContaining([
        '--tag',
        h.sha,
        '--message',
        expect.stringMatching(/^narduk-app ship feat-x /u),
      ]),
    )
    expect(gitIn(h.origin)('rev-parse', 'refs/heads/feat-x')).toBe(h.sha)
    expect(h.pushedBeforeUpload()).toBe(true)
  })

  it('rolls back to the previous version when the live proof fails', async () => {
    const h = harness()
    h.proof.result = 'FAIL'
    h.proof.exitCode = 1
    await expect(runShip(parseShipArgs(['--no-pr']), h.context)).resolves.toBe(SHIP_EXIT.rolledBack)
    expect(h.calls.slice(-3)).toEqual(['promote new', 'verify', 'promote old'])
    // A later `deploy rollback` must read this as a rollback, not "previous".
    expect(vi.mocked(h.client.deployVersion).mock.calls.at(-1)?.[2]).toMatch(
      /^narduk-app rollback /u,
    )
    expect(h.pushedBeforeUpload()).toBe(true)
  })

  it('rolls back when the promote itself fails after traffic moved', async () => {
    const h = harness()
    const deploy = vi.mocked(h.client.deployVersion)
    const real = deploy.getMockImplementation()!
    deploy.mockImplementationOnce(async (...args) => {
      await real(...args)
      throw new Error('wrangler versions deploy exited 1')
    })
    await expect(runShip(parseShipArgs([]), h.context)).resolves.toBe(SHIP_EXIT.rolledBack)
    expect(h.calls.slice(-2)).toEqual(['promote new', 'promote old'])
    expect(h.calls).not.toContain('gh pr create')
  })

  it('refuses a dirty tree unless -m commits it', async () => {
    const h = harness()
    writeFileSync(join(h.app, 'dirty.txt'), 'x\n')
    await expect(runShip(parseShipArgs(['--dry-run']), h.context)).resolves.toBe(SHIP_EXIT.refused)
    await expect(runShip(parseShipArgs(['--dry-run', '-m', 'wip']), h.context)).resolves.toBe(
      SHIP_EXIT.ok,
    )
    expect(h.git('log', '-1', '--format=%s')).toBe('feature')
    await expect(runShip(parseShipArgs(['--no-pr', '-m', 'wip']), h.context)).resolves.toBe(
      SHIP_EXIT.ok,
    )
    expect(h.git('log', '-1', '--format=%s')).toBe('wip')
  })

  it('refuses to ship from the production branch', async () => {
    const h = harness()
    h.git('checkout', '-q', 'main')
    await expect(runShip(parseShipArgs(['--dry-run']), h.context)).resolves.toBe(SHIP_EXIT.refused)
    expect(h.logs.join('\n')).toContain('feature branch')
  })

  it('refuses when production serves a commit HEAD does not contain', async () => {
    const f = fixture()
    f.git('checkout', '-q', '-b', 'other', 'main')
    writeFileSync(join(f.app, 'other.txt'), 'other\n')
    f.git('add', '.')
    f.git('commit', '-qm', 'other')
    const other = f.git('rev-parse', 'HEAD')
    rmSync(f.root, { recursive: true, force: true })
    const h = harness({ servedTag: other })
    // `other` lives only in the discarded clone, so HEAD cannot contain it.
    await expect(runShip(parseShipArgs([]), h.context)).resolves.toBe(SHIP_EXIT.refused)
    expect(h.calls).toEqual([])
    expect(h.logs.join('\n')).toContain('cannot be shown to contain')
    // --adopt takes over an untagged version only; it never overrides this.
    await expect(runShip(parseShipArgs(['--adopt']), h.context)).resolves.toBe(SHIP_EXIT.refused)
    expect(h.calls).toEqual([])
  })

  it('refuses an untagged production version unless --adopt', async () => {
    const h = harness({ servedTag: null })
    await expect(runShip(parseShipArgs(['--no-pr']), h.context)).resolves.toBe(SHIP_EXIT.refused)
    expect(h.calls).toEqual([])
    await expect(runShip(parseShipArgs(['--no-pr', '--adopt']), h.context)).resolves.toBe(
      SHIP_EXIT.ok,
    )
  })

  it('refuses migration changes (ship v1 does not migrate)', async () => {
    const h = harness({ migrations: true })
    writeFileSync(join(h.app, 'migrations/0002.sql'), 'alter table a add b int;\n')
    await expect(runShip(parseShipArgs(['--no-pr', '-m', 'migrate']), h.context)).resolves.toBe(
      SHIP_EXIT.refused,
    )
    expect(h.logs.join('\n')).toContain('Migration files changed')
    expect(h.calls).toEqual([])
  })

  it('refuses before upload when the build fails', async () => {
    const h = harness()
    h.context.run = async (args) => {
      h.calls.push(args[1])
      if (args[1] === 'ship:build') throw new Error('build broke')
    }
    await expect(runShip(parseShipArgs([]), h.context)).resolves.toBe(SHIP_EXIT.refused)
    expect(h.calls).not.toContain('upload')
  })

  it("refuses until the app's promote job can see the ship PR land", async () => {
    const h = harness()
    const dir = join(h.root, '.github/workflows')
    mkdirSync(dir, { recursive: true })
    const promote = (extra: string, stepEnv: string) =>
      writeFileSync(
        join(dir, 'promote.yml'),
        `jobs:\n  promote:\n    permissions:\n      contents: read\n${extra}    steps:\n      - env:\n          CLOUDFLARE_API_TOKEN: x\n${stepEnv}        run: pnpm exec narduk-app deploy versions-promote\n`,
      )
    promote('', '')
    h.git('add', '.')
    h.git('commit', '-qm', 'promote')
    await expect(runShip(parseShipArgs(['--dry-run']), h.context)).resolves.toBe(SHIP_EXIT.refused)
    expect(h.logs.join('\n')).toContain('pull-requests: read and GITHUB_TOKEN')
    promote('      pull-requests: read\n', '          GITHUB_TOKEN: ${{ github.token }}\n')
    expect(promoteWorkflowGap(h.root)).toBeUndefined()
  })

  it('reads the production origin from the manifest', () => {
    expect(
      productionOrigin({ environments: [{ name: 'production', hostname: 'buoystat.us' }] }),
    ).toBe('https://buoystat.us')
    expect(productionOrigin({ domains: { customDomains: ['acreoracle.com'] } })).toBe(
      'https://acreoracle.com',
    )
    expect(productionOrigin({}, 'https://x.example/')).toBe('https://x.example')
    expect(() => productionOrigin({})).toThrow('--base-url')
  })
})
