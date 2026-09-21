import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { main } from '../src/cli.js'
import { parseHotfixArgs, runHotfix, type HotfixContext } from '../src/deploy-hotfix.js'
import { defaultDeploymentBlock } from '../src/deployment-config.js'
import {
  hotfixBuildEnv,
  hotfixProductionEnv,
  planHotfix,
  type HotfixFlags,
} from '../src/hotfix-plan.js'
import type { WorkerDeployment, WorkerVersion, WranglerVersionsClient } from '../src/promote.js'
import type { VerifyReport } from '../src/verify-live.js'

const roots: string[] = []
const ACCOUNT = 'a'.repeat(32)
const TOKEN = 'synthetic-cloudflare-secret-token'
const OLD = '11111111-1111-4111-8111-111111111111'
const NEW = '22222222-2222-4222-8222-222222222222'
const env = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  CLOUDFLARE_ACCOUNT_ID: ACCOUNT,
  CLOUDFLARE_API_TOKEN: TOKEN,
}

afterEach(() => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture(nested = true) {
  const root = mkdtempSync(join(tmpdir(), 'hotfix-test-'))
  roots.push(root)
  const app = nested ? join(root, 'apps/web') : root
  mkdirSync(app, { recursive: true })
  mkdirSync(join(root, 'Config'))
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ scripts: { 'hotfix:check': 'test', 'hotfix:build': 'build' } }),
  )
  writeFileSync(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
  writeFileSync(join(root, '.gitignore'), '.output/\n.env\nnode_modules/\n')
  writeFileSync(
    join(app, 'wrangler.jsonc'),
    JSON.stringify({ name: 'example', account_id: ACCOUNT }),
  )
  writeFileSync(
    join(root, 'Config/cloudflare-app.json'),
    JSON.stringify({
      worker: { name: 'example' },
      deployment: { ...defaultDeploymentBlock({ appSlug: 'example' }), accountId: ACCOUNT },
    }),
  )
  const git = (...args: string[]) =>
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  git('init', '-q')
  git('add', '.')
  git(
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.test',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-qm',
    'fixture',
  )
  const sha = git('rev-parse', 'HEAD')
  const flags = parseHotfixArgs([
    '--incident',
    'INC-123',
    '--reason',
    'Normal delivery unavailable',
    '--operator',
    'Incident operator',
    '--sha',
    sha,
    '--confirm-worker',
    'example',
    '--base-url',
    'https://example.com',
    '--yes',
    '--automation-paused',
  ])
  return { root, app, flags, git }
}

function harness(nested = true) {
  const f = fixture(nested)
  let active: WorkerDeployment = {
    id: 'previous-deployment',
    created_on: '2026-09-21T01:00:00Z',
    versions: [{ version_id: OLD, percentage: 100 }],
  }
  let versions: WorkerVersion[] = []
  const calls: string[] = []
  const snapshots: string[] = []
  const client: WranglerVersionsClient = {
    listDeployments: vi.fn(async () => [active]),
    listVersions: vi.fn<WranglerVersionsClient['listVersions']>(async () => ({
      versions,
      complete: true,
      limit: 100,
      source: 'api',
    })),
    deployVersion: vi.fn(async (id) => {
      calls.push('promote')
      active = {
        id: 'hotfix-deployment',
        created_on: '2026-09-21T02:00:00Z',
        versions: [{ version_id: id, percentage: 100 }],
      }
    }),
    rollback: vi.fn(async () => {
      throw new Error('No automatic rollback')
    }),
  }
  const proof: VerifyReport = {
    schemaVersion: 1,
    tool: '@narduk-enterprises/narduk-app-tools/verify-live',
    generated: '2026-09-21T02:01:00Z',
    baseUrl: 'https://example.com',
    expectedSha: f.flags.sha,
    attemptsUsed: 1,
    attemptsAllowed: 6,
    assertions: [],
    result: 'PASS',
    exitCode: 0,
  }
  const run = vi.fn<NonNullable<HotfixContext['run']>>((args, cwd, childEnv) => {
    calls.push(args.join(' '))
    snapshots.push(cwd)
    expect(childEnv.CLOUDFLARE_API_TOKEN).toBeUndefined()
    expect(childEnv.WORKERS_CI).toBeUndefined()
    expect(childEnv.BUILD_VERSION).toBe(f.flags.sha)
    expect(existsSync(join(cwd, '.env'))).toBe(false)
    if (args[1] === 'hotfix:build') {
      const app = nested ? join(cwd, 'apps/web') : cwd
      mkdirSync(join(app, '.output/server'), { recursive: true })
      mkdirSync(join(app, '.output/public'), { recursive: true })
      writeFileSync(join(app, '.output/server/index.mjs'), 'export default {}')
    }
  })
  const upload = vi.fn<NonNullable<HotfixContext['upload']>>((args, _cwd, childEnv) => {
    calls.push('upload')
    expect(childEnv?.CLOUDFLARE_API_TOKEN).toBe(TOKEN)
    expect(childEnv?.WORKERS_CI_BRANCH).toBeUndefined()
    expect(args).toContain('--keep-vars')
    versions = [
      {
        id: NEW,
        annotations: {
          'workers/tag': args[args.indexOf('--tag') + 1],
          'workers/message': args[args.indexOf('--message') + 1],
        },
      },
    ]
    return 0
  })
  const verify = vi.fn<NonNullable<HotfixContext['verify']>>(async (flags) => {
    calls.push('verify')
    expect(flags.expectSha).toBe(f.flags.sha)
    expect(flags.allowDegraded).toBe(false)
    expect(flags.healthPath).toBe('/api/health')
    return proof
  })
  const context: HotfixContext = {
    cwd: f.root,
    env,
    log: vi.fn(),
    run,
    client: () => client,
    upload,
    verify,
  }
  const receipts = () => {
    const dir = join(f.root, '.git/narduk/hotfix')
    const paths = readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => join(dir, name))
    return paths.map((path) => ({
      path,
      data: JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>,
    }))
  }
  return {
    ...f,
    context,
    client,
    run,
    upload,
    verify,
    calls,
    snapshots,
    receipts,
    proof,
    setActive: (deployment: WorkerDeployment) => {
      active = deployment
    },
    setVersions: (value: WorkerVersion[]) => {
      versions = value
    },
  }
}

describe('local incident hotfix', () => {
  it.each([true, false])(
    'deploys a clean snapshot and records verified provenance (nested=%s)',
    async (nested) => {
      const h = harness(nested)
      writeFileSync(join(h.root, '.env'), 'IGNORED_SECRET=must-not-be-copied')
      await expect(runHotfix(h.flags, h.context)).resolves.toBe(0)
      expect(h.calls).toEqual([
        'install --offline --frozen-lockfile --prod=false',
        'run hotfix:check',
        'run hotfix:build',
        'upload',
        'promote',
        'verify',
      ])
      const [{ data, path }] = h.receipts()
      expect(data).toMatchObject({
        phase: 'passed',
        sha: h.flags.sha,
        previousVersionId: OLD,
        versionId: NEW,
        deploymentId: 'hotfix-deployment',
        operator: h.flags.operator,
        incident: 'INC-123',
      })
      expect(statSync(path).mode & 0o777).toBe(0o600)
      expect(readFileSync(path, 'utf8')).not.toContain(TOKEN)
      expect(h.snapshots.every((path) => !existsSync(path))).toBe(true)
      expect(h.git('status', '--porcelain')).toBe('')
      expect(h.client.rollback).not.toHaveBeenCalled()
    },
  )

  it('dry-run is offline, credential-free and does not create a receipt or run a child', async () => {
    const h = harness()
    await expect(
      runHotfix(
        { ...h.flags, dryRun: true, yes: false, automationPaused: false },
        { ...h.context, env: { PATH: env.PATH, HOME: env.HOME } },
      ),
    ).resolves.toBe(0)
    expect(h.run).not.toHaveBeenCalled()
    expect(h.client.listDeployments).not.toHaveBeenCalled()
    expect(existsSync(join(h.root, '.git/narduk'))).toBe(false)
  })

  it.each(['yes', 'automationPaused'] as const)(
    'requires explicit %s even with credentials',
    async (flag) => {
      const h = harness()
      await expect(runHotfix({ ...h.flags, [flag]: false }, h.context)).rejects.toThrow(
        '--yes and --automation-paused',
      )
      expect(h.run).not.toHaveBeenCalled()
    },
  )

  it.each(['--force', '--no-probe', '--skip-checks', '--skip-migrate', '--env', '--config'])(
    'refuses bypass/target override %s',
    (flag) => {
      expect(() => parseHotfixArgs([flag])).toThrow('Unknown deploy-hotfix option')
    },
  )

  it('rejects duplicates, missing values and invalid identifiers/URLs', () => {
    expect(() => parseHotfixArgs(['--yes', '--yes'])).toThrow('Duplicate')
    expect(() => parseHotfixArgs(['--reason', '--yes'])).toThrow('requires a value')
    const h = fixture()
    for (const baseUrl of [
      'http://example.com',
      'https://localhost',
      'https://user:pass@example.com',
      'https://example.com/path',
      'https://example.com/?token=secret',
    ]) {
      expect(() => planHotfix({ ...h.flags, baseUrl }, h.root, env)).toThrow()
    }
    expect(() => planHotfix({ ...h.flags, sha: h.flags.sha.slice(0, 7) }, h.root, env)).toThrow()
  })

  it.each(['CI', 'GITHUB_ACTIONS', 'WORKERS_CI'])('rejects ambient %s', (key) => {
    const h = fixture()
    expect(() => planHotfix(h.flags, h.root, { ...env, [key]: 'true' })).toThrow(
      'operator workstation',
    )
  })

  it('rejects source, target, account and adoption mismatches before provider access', () => {
    const h = fixture()
    expect(() => planHotfix({ ...h.flags, sha: 'b'.repeat(40) }, h.root, env)).toThrow('HEAD')
    expect(() => planHotfix({ ...h.flags, confirmWorker: 'another' }, h.root, env)).toThrow(
      'Wrangler name',
    )
    expect(() =>
      planHotfix(h.flags, h.root, { ...env, CLOUDFLARE_ACCOUNT_ID: 'b'.repeat(32) }),
    ).toThrow('account IDs disagree')
    writeFileSync(join(h.root, 'untracked.ts'), 'uncommitted')
    expect(() => planHotfix(h.flags, h.root, env)).toThrow('clean working tree')
  })

  it.each(['install', 'hotfix:check', 'hotfix:build'])(
    'never uploads after %s fails, and retains a private failure receipt',
    async (step) => {
      const h = harness()
      const original = h.run.getMockImplementation()!
      h.run.mockImplementation((args, cwd, childEnv) => {
        if (args.includes(step)) throw new Error('synthetic failure')
        original(args, cwd, childEnv)
      })
      await expect(runHotfix(h.flags, h.context)).rejects.toThrow('synthetic failure')
      expect(h.upload).not.toHaveBeenCalled()
      expect(h.client.deployVersion).not.toHaveBeenCalled()
      expect(h.receipts()[0].data).toMatchObject({
        phase: 'failed',
        productionMayHaveChanged: false,
      })
      expect(
        readdirSync(join(h.root, '.git/narduk/hotfix')).some((name) => name.endsWith('.lock')),
      ).toBe(false)
    },
  )

  it('rejects a build that changed committed source', async () => {
    const h = harness()
    const original = h.run.getMockImplementation()!
    h.run.mockImplementation((args, cwd, childEnv) => {
      original(args, cwd, childEnv)
      if (args[1] === 'hotfix:build') writeFileSync(join(cwd, 'package.json'), '{}')
    })
    await expect(runHotfix(h.flags, h.context)).rejects.toThrow('changed committed source')
    expect(h.upload).not.toHaveBeenCalled()
  })

  it('refuses a public asset containing an injected credential', async () => {
    const h = harness()
    const original = h.run.getMockImplementation()!
    h.run.mockImplementation((args, cwd, childEnv) => {
      original(args, cwd, childEnv)
      if (args[1] === 'hotfix:build')
        writeFileSync(join(cwd, 'apps/web/.output/public/leak.js'), TOKEN)
    })
    await expect(runHotfix(h.flags, h.context)).rejects.toThrow('Credential value found')
    expect(h.upload).not.toHaveBeenCalled()
  })

  it('does not upload when production moved during the build', async () => {
    const h = harness()
    const original = h.run.getMockImplementation()!
    h.run.mockImplementation((args, cwd, childEnv) => {
      original(args, cwd, childEnv)
      if (args[1] === 'hotfix:build')
        h.setActive({
          id: 'other-deploy',
          created_on: '2026-09-21T03:00:00Z',
          versions: [{ version_id: OLD, percentage: 100 }],
        })
    })
    await expect(runHotfix(h.flags, h.context)).rejects.toThrow('Production changed')
    expect(h.upload).not.toHaveBeenCalled()
  })

  it('does not promote when production moved during upload', async () => {
    const h = harness()
    const original = h.upload.getMockImplementation()!
    h.upload.mockImplementation((...args) => {
      const result = original(...args)
      h.setActive({
        id: 'other-deploy',
        created_on: '2026-09-21T03:00:00Z',
        versions: [{ version_id: OLD, percentage: 100 }],
      })
      return result
    })
    await expect(runHotfix(h.flags, h.context)).rejects.toThrow('Production changed')
    expect(h.client.deployVersion).not.toHaveBeenCalled()
    expect(h.receipts()[0].data).toMatchObject({ versionId: NEW, productionMayHaveChanged: false })
  })

  it.each(['none', 'ambiguous'])(
    'refuses %s upload identification instead of guessing by SHA',
    async (kind) => {
      const h = harness()
      const original = h.upload.getMockImplementation()!
      h.upload.mockImplementation((...args) => {
        const result = original(...args)
        const argv = args[0]
        const version = {
          id: NEW,
          annotations: {
            'workers/tag': h.flags.sha,
            'workers/message': argv[argv.indexOf('--message') + 1],
          },
        }
        h.setVersions(kind === 'none' ? [] : [version, version])
        return result
      })
      await expect(runHotfix(h.flags, h.context)).rejects.toThrow('uniquely identify')
      expect(h.client.deployVersion).not.toHaveBeenCalled()
    },
  )

  it('records an uncertain promotion without retry or automatic rollback', async () => {
    const h = harness()
    vi.mocked(h.client.deployVersion).mockRejectedValue(new Error('provider timeout'))
    await expect(runHotfix(h.flags, h.context)).rejects.toThrow('provider timeout')
    expect(h.receipts()[0].data).toMatchObject({
      failedPhase: 'promoting',
      productionMayHaveChanged: true,
      previousVersionId: OLD,
      versionId: NEW,
    })
    expect(h.client.deployVersion).toHaveBeenCalledTimes(1)
    expect(h.client.rollback).not.toHaveBeenCalled()
  })

  it('keeps failed live proof actionable and never calls it success', async () => {
    const h = harness()
    h.proof.result = 'FAIL'
    h.proof.exitCode = 3
    await expect(runHotfix(h.flags, h.context)).rejects.toThrow('live proof failed')
    expect(h.receipts()[0].data).toMatchObject({
      failedPhase: 'proving',
      productionMayHaveChanged: true,
      proof: { result: 'FAIL', exitCode: 3 },
    })
  })

  it('rejects split traffic or malformed provider history', async () => {
    const h = harness()
    h.setActive({
      id: 'split',
      created_on: '2026-09-21T01:00:00Z',
      versions: [
        { version_id: OLD, percentage: 50 },
        { version_id: NEW, percentage: 50 },
      ],
    })
    await expect(runHotfix(h.flags, h.context)).rejects.toThrow('single-version')
    expect(h.upload).not.toHaveBeenCalled()
  })

  it('refuses Wrangler build hooks before a credentialed upload', () => {
    const h = fixture()
    writeFileSync(
      join(h.app, 'wrangler.jsonc'),
      JSON.stringify({
        name: 'example',
        account_id: ACCOUNT,
        build: { command: 'pnpm run build' },
      }),
    )
    h.git('add', '.')
    h.git(
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.test',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-qm',
      'build hook',
    )
    expect(() => planHotfix({ ...h.flags, sha: h.git('rev-parse', 'HEAD') }, h.root, env)).toThrow(
      'upload must not rebuild',
    )
  })

  it('rechecks the committed target when local index flags hide a configuration edit', async () => {
    const h = harness()
    h.git(
      'update-index',
      '--assume-unchanged',
      'apps/web/wrangler.jsonc',
      'Config/cloudflare-app.json',
    )
    writeFileSync(
      join(h.app, 'wrangler.jsonc'),
      JSON.stringify({ name: 'wrong-target', account_id: ACCOUNT }),
    )
    writeFileSync(
      join(h.root, 'Config/cloudflare-app.json'),
      JSON.stringify({
        worker: { name: 'wrong-target' },
        deployment: { ...defaultDeploymentBlock({ appSlug: 'example' }), accountId: ACCOUNT },
      }),
    )
    expect(h.git('status', '--porcelain')).toBe('')
    await expect(
      runHotfix({ ...h.flags, confirmWorker: 'wrong-target' }, h.context),
    ).rejects.toThrow('Wrangler name')
    expect(h.run).not.toHaveBeenCalled()
    expect(h.upload).not.toHaveBeenCalled()
  })

  it('preserves an existing lock belonging to another hotfix', async () => {
    const h = harness()
    const plan = planHotfix(h.flags, h.root, env)
    mkdirSync(plan.evidenceDir, { recursive: true })
    const path = join(plan.evidenceDir, `${ACCOUNT}-example.lock`)
    writeFileSync(path, 'existing-owner')
    await expect(runHotfix(h.flags, h.context)).rejects.toThrow('EEXIST')
    expect(readFileSync(path, 'utf8')).toBe('existing-owner')
    expect(h.run).not.toHaveBeenCalled()
  })

  it('only forwards public build configuration and forces the exact build identity', () => {
    const flags = { sha: 'a'.repeat(40), baseUrl: 'https://example.com' } as HotfixFlags
    const result = hotfixBuildEnv(
      {
        ...env,
        GH_PACKAGES_READ: 'secret',
        NUXT_SESSION_PASSWORD: 'secret',
        GITHUB_SHA: 'wrong',
        NUXT_PUBLIC_BUILD_VERSION: 'wrong',
        NUXT_PUBLIC_TITLE: 'Title',
        WORKERS_CI_BRANCH: 'preview',
      },
      flags,
    )
    expect(result).toMatchObject({
      BUILD_VERSION: flags.sha,
      NUXT_PUBLIC_BUILD_VERSION: flags.sha,
      NUXT_PUBLIC_TITLE: 'Title',
    })
    expect(result).not.toHaveProperty('GH_PACKAGES_READ')
    expect(result).not.toHaveProperty('NUXT_SESSION_PASSWORD')
    expect(result).not.toHaveProperty('CLOUDFLARE_API_TOKEN')
    expect(result).not.toHaveProperty('WORKERS_CI_BRANCH')
  })

  it('passes stable app secrets only to the production build and rejects CI placeholders', async () => {
    const h = harness()
    const stable = 'synthetic-app-build-secret-1234567890'
    const original = h.run.getMockImplementation()!
    h.run.mockImplementation((args, cwd, childEnv) => {
      original(args, cwd, childEnv)
      expect(childEnv.NUXT_OG_IMAGE_SECRET).toBe(args[1] === 'hotfix:build' ? stable : undefined)
      if (args[1] === 'hotfix:build') expect(childEnv.NARDUK_ALLOW_LOCAL_WRANGLER_DEPLOY).toBe('1')
    })
    await expect(
      runHotfix(h.flags, { ...h.context, env: { ...env, NUXT_OG_IMAGE_SECRET: stable } }),
    ).resolves.toBe(0)
    expect(() =>
      hotfixProductionEnv(
        { ...env, NUXT_OG_IMAGE_SECRET: 'narduk-test-only-og-image-secret-000000' },
        h.flags,
      ),
    ).toThrow('test placeholder')
    expect(() => hotfixProductionEnv({ ...env, NUXT_SESSION_PASSWORD: 'short' }, h.flags)).toThrow(
      'production build secret',
    )
  })

  it('rejects a concurrent deployment during live proof', async () => {
    const h = harness()
    h.verify.mockImplementation(async () => {
      h.setActive({
        id: 'later',
        created_on: '2026-09-21T03:00:00Z',
        versions: [{ version_id: OLD, percentage: 100 }],
      })
      return h.proof
    })
    await expect(runHotfix(h.flags, h.context)).rejects.toThrow(
      'Production changed during live proof',
    )
    expect(h.receipts()[0].data).toMatchObject({ phase: 'failed', failedPhase: 'proving' })
  })

  it('routes CLI errors to a nonzero result', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(main(['deploy-hotfix', '--force'])).resolves.toBe(1)
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Unknown deploy-hotfix'))
  })
})
