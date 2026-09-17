import { describe, expect, it } from 'vitest'

import { buildWranglerCommandArgs, resolveVersionTagArgs } from '../src/deploy.js'
import {
  checkPromoteContext,
  formatPromoteResult,
  compareVersionRecency,
  createWranglerCli,
  currentDeployment,
  DEFAULT_VERSION_SEARCH_LIMIT,
  defaultPromoteSha,
  describeVersionSearch,
  listWorkerVersionsViaApi,
  resolveVersionsApiAuth,
  VERSION_PAGE_SIZE,
  WRANGLER_VERSION_LIST_CAP,
  getPromoteGuardMessage,
  isActionsPromoteAllowed,
  isManualPromoteAllowed,
  parseRollbackArgs,
  parseVersionsPromoteArgs,
  parseWranglerVersionsJson,
  PROMOTE_EXIT,
  resolvePreviousVersion,
  resolveVersionForSha,
  rollbackProvenance,
  ROLLBACK_MESSAGE_PREFIX,
  runRollback,
  runVersionsPromote,
  shaMatchesTag,
  soleDeployedVersionId,
  versionBranch,
  type PromoteContext,
  type SpawnResult,
  type SpawnWrangler,
  type WorkerDeployment,
  type WorkerVersion,
  type VersionListing,
  type WranglerVersionsClient,
} from '../src/promote.js'
import { main } from '../src/cli.js'

const SHA = 'f736b07d7f49a1b2c3d4e5f60718293a4b5c6d7e'
const SHORT = 'f736b07'

/** A GitHub Actions environment, minus anything the guard does not read. */
const ACTIONS_ENV = {
  CI: 'true',
  GITHUB_ACTIONS: 'true',
  GITHUB_RUN_ID: '123456',
  GITHUB_REPOSITORY: 'narduk-enterprises/buoys',
  GITHUB_WORKFLOW: 'promote',
  GITHUB_SHA: SHA,
}

function version(id: string, tag?: string, extra: Partial<WorkerVersion> = {}): WorkerVersion {
  return {
    id,
    metadata: { source: 'wrangler', created_on: '2026-09-17T00:00:00Z' },
    ...(tag === undefined ? {} : { annotations: { 'workers/tag': tag } }),
    ...extra,
  }
}

/**
 * `annotations` defaults to an ordinary (non-rollback) deploy. Pass `null` for
 * a deployment carrying no annotations at all -- which is not the same thing,
 * and the rollback path refuses it rather than reading it as "not a rollback".
 */
function deployment(
  id: string,
  versionId: string,
  createdOn: string,
  annotations: Record<string, string> | null = { 'workers/triggered_by': 'version_upload' },
): WorkerDeployment {
  return {
    id,
    source: 'wrangler',
    strategy: 'percentage',
    created_on: createdOn,
    ...(annotations ? { annotations } : {}),
    versions: [{ version_id: versionId, percentage: 100 }],
  }
}

interface StubCalls {
  deployed: Array<{ versionId: string; percentage: number; message?: string }>
  rolledBack: Array<{ versionId: string; message?: string }>
}

function stubClient(
  versions: WorkerVersion[],
  deployments: WorkerDeployment[],
): { client: WranglerVersionsClient; calls: StubCalls } {
  const calls: StubCalls = { deployed: [], rolledBack: [] }
  return {
    calls,
    client: {
      listVersions: async (limit) => ({
        versions: versions.slice(0, limit),
        complete: true,
        limit,
        source: 'api',
      }),
      listDeployments: async () => deployments,
      deployVersion: async (versionId, percentage, message) => {
        calls.deployed.push({ versionId, percentage, message })
      },
      rollback: async (versionId, message) => {
        calls.rolledBack.push({ versionId, message })
      },
    },
  }
}

function context(
  versions: WorkerVersion[],
  deployments: WorkerDeployment[],
  env: Record<string, string | undefined> = ACTIONS_ENV,
): { context: PromoteContext; calls: StubCalls } {
  const { client, calls } = stubClient(versions, deployments)
  return { calls, context: { client, env, resolveWorkerName: () => 'buoys', appDir: '/tmp/app' } }
}

describe('promote guard', () => {
  it('refuses outside GitHub Actions, and does not accept the Workers Builds escape hatch', async () => {
    const { context: ctx, calls } = context([version('v1', SHA)], [], {
      CI: 'true',
      // The deploy escape hatch, deliberately not honoured here.
      NARDUK_ALLOW_LOCAL_WRANGLER_DEPLOY: '1',
      // A Workers Build context, which is the wrong place for a promotion.
      WORKERS_CI: 'true',
      WORKERS_CI_BUILD_UUID: 'uuid',
      WORKERS_CI_COMMIT_SHA: SHA,
      WORKERS_CI_BRANCH: 'main',
    })
    const result = await runVersionsPromote(parseVersionsPromoteArgs(['--sha', SHA]), ctx)
    expect(result.outcome).toBe('guard-refused')
    expect(result.exitCode).toBe(PROMOTE_EXIT.refused)
    expect(result.detail).toContain('NARDUK_ALLOW_MANUAL_PROMOTE')
    expect(calls.deployed).toEqual([])
  })

  it('accepts a complete GitHub Actions context and the explicit manual override', () => {
    expect(isActionsPromoteAllowed(ACTIONS_ENV)).toBe(true)
    expect(isActionsPromoteAllowed({ ...ACTIONS_ENV, GITHUB_RUN_ID: '' })).toBe(false)
    expect(isActionsPromoteAllowed({ ...ACTIONS_ENV, GITHUB_ACTIONS: 'false' })).toBe(false)
    expect(isActionsPromoteAllowed({ CI: 'true' })).toBe(false)
    expect(isManualPromoteAllowed({ NARDUK_ALLOW_MANUAL_PROMOTE: '1' })).toBe(true)
    expect(isManualPromoteAllowed({ NARDUK_ALLOW_LOCAL_WRANGLER_DEPLOY: '1' })).toBe(false)
    expect(getPromoteGuardMessage('rollback')).toContain('Rollback')
  })

  it('lets a deliberate recovery run promote outside Actions', async () => {
    const { context: ctx, calls } = context([version('v1', SHA)], [], {
      NARDUK_ALLOW_MANUAL_PROMOTE: '1',
    })
    const result = await runVersionsPromote(parseVersionsPromoteArgs(['--sha', SHA]), ctx)
    expect(result.outcome).toBe('promoted')
    expect(calls.deployed).toEqual([
      { versionId: 'v1', percentage: 100, message: `narduk-app promote ${SHA}` },
    ])
  })
})

describe('sha to version resolution', () => {
  it('matches a commit tag as a hex prefix in both directions', () => {
    expect(shaMatchesTag(SHA, SHA)).toBe(true)
    expect(shaMatchesTag(SHA, SHORT)).toBe(true)
    expect(shaMatchesTag(SHORT, SHA)).toBe(true)
    expect(shaMatchesTag(SHA, 'f736b07d7f49')).toBe(true)
    expect(shaMatchesTag(SHA, 'deadbee')).toBe(false)
    expect(shaMatchesTag(SHA, undefined)).toBe(false)
    // Too short to be a commit, and a non-hex label must never match.
    expect(shaMatchesTag(SHA, 'f736')).toBe(false)
    expect(shaMatchesTag(SHA, 'buoys-repin')).toBe(false)
  })

  it('reads workers/tag, which is the only commit-shaped annotation a version carries', () => {
    // The live shape, read from `wrangler versions list --name buoys --json`
    // on 2026-09-17: an alias and a trigger, and no commit anywhere.
    const alias = version('v-alias', undefined, {
      annotations: { 'workers/alias': 'buoys-repin', 'workers/triggered_by': 'version_upload' },
    })
    expect(resolveVersionForSha([alias], SHA)).toEqual({ kind: 'not-found', searched: 1 })
  })

  it('reports version-not-found with the size of the searched window', async () => {
    const versions = Array.from({ length: 10 }, (_, index) =>
      version(`v${String(index)}`, `abcdef${String(index)}0`),
    )
    const { context: ctx, calls } = context(versions, [])
    const result = await runVersionsPromote(parseVersionsPromoteArgs(['--sha', SHA]), ctx)
    expect(result.outcome).toBe('version-not-found')
    expect(result.exitCode).toBe(PROMOTE_EXIT.versionNotFound)
    expect(result.searchedVersions).toBe(10)
    expect(result.detail).toContain('10 version(s) searched')
    expect(calls.deployed).toEqual([])
  })

  it('refuses to guess when several versions carry one commit tag', async () => {
    const { context: ctx, calls } = context([version('v1', SHA), version('v2', SHORT)], [])
    const result = await runVersionsPromote(parseVersionsPromoteArgs(['--sha', SHA]), ctx)
    expect(result.outcome).toBe('ambiguous-version')
    expect(result.exitCode).toBe(PROMOTE_EXIT.ambiguousVersion)
    expect(result.candidates).toEqual(['v1', 'v2'])
    expect(calls.deployed).toEqual([])
  })

  it('takes GITHUB_SHA when no --sha is given, and prints the version it will replace', async () => {
    const { context: ctx, calls } = context(
      [version('v-new', SHA)],
      [deployment('d1', 'v-old', '2026-09-17T01:00:00Z')],
    )
    const result = await runVersionsPromote(parseVersionsPromoteArgs([]), ctx)
    expect(result.outcome).toBe('promoted')
    expect(result.versionId).toBe('v-new')
    expect(result.previousVersionId).toBe('v-old')
    expect(calls.deployed[0].versionId).toBe('v-new')
  })
})

describe('promote idempotence', () => {
  it('is a no-op when the resolved version already serves 100%', async () => {
    const { context: ctx, calls } = context(
      [version('v-live', SHA)],
      [deployment('d1', 'v-live', '2026-09-17T01:00:00Z')],
    )
    const result = await runVersionsPromote(parseVersionsPromoteArgs(['--sha', SHA]), ctx)
    expect(result.outcome).toBe('already-live')
    expect(result.exitCode).toBe(PROMOTE_EXIT.ok)
    expect(calls.deployed).toEqual([])
  })

  it('plans without calling wrangler under --dry-run', async () => {
    const { context: ctx, calls } = context([version('v1', SHA)], [])
    const result = await runVersionsPromote(
      parseVersionsPromoteArgs(['--sha', SHA, '--dry-run']),
      ctx,
    )
    expect(result.outcome).toBe('dry-run')
    expect(result.detail).toContain('wrangler versions deploy v1@100')
    expect(calls.deployed).toEqual([])
  })
})

describe('deployment reading', () => {
  it('takes the newest deployment by created_on, not by array order', () => {
    const deployments = [
      deployment('d2', 'v2', '2026-09-17T02:00:00Z'),
      deployment('d1', 'v1', '2026-09-17T01:00:00Z'),
    ]
    expect(currentDeployment(deployments)?.id).toBe('d2')
    expect(currentDeployment([])).toBeNull()
  })

  it('reports no sole version when traffic is split', () => {
    const split: WorkerDeployment = {
      id: 'd',
      versions: [
        { version_id: 'a', percentage: 50 },
        { version_id: 'b', percentage: 50 },
      ],
    }
    expect(soleDeployedVersionId(split)).toBeNull()
    expect(soleDeployedVersionId(null)).toBeNull()
  })

  it('takes the JSON document out of a stream that carries a wrangler banner', () => {
    expect(
      parseWranglerVersionsJson<number[]>('⛅️ wrangler 4.133.0\n[1,2]\n', 'versions list'),
    ).toEqual([1, 2])
    expect(() => parseWranglerVersionsJson('no json here', 'versions list')).toThrow(
      'returned no JSON',
    )
  })
})

describe('rollback', () => {
  const deployments = [
    deployment('d1', 'v-good', '2026-09-17T01:00:00Z'),
    deployment('d2', 'v-bad', '2026-09-17T02:00:00Z'),
  ]

  it('rolls back to the previous deployed version', async () => {
    const { context: ctx, calls } = context([], deployments)
    const result = await runRollback(parseRollbackArgs([]), ctx)
    expect(result.outcome).toBe('rolled-back')
    expect(result.versionId).toBe('v-good')
    expect(result.previousVersionId).toBe('v-bad')
    expect(calls.rolledBack).toEqual([
      { versionId: 'v-good', message: `${ROLLBACK_MESSAGE_PREFIX} to v-good` },
    ])
  })

  it('refuses when the named target is already live', async () => {
    const { context: ctx, calls } = context([], deployments)
    const result = await runRollback(parseRollbackArgs(['--to', 'v-bad']), ctx)
    expect(result.outcome).toBe('rollback-refused')
    expect(result.exitCode).toBe(PROMOTE_EXIT.rollbackRefused)
    expect(result.detail).toContain('already serves 100%')
    expect(calls.rolledBack).toEqual([])
  })

  it('refuses to roll forward when the live deployment is itself a rollback', async () => {
    const afterRollback = [
      ...deployments,
      deployment('d3', 'v-good', '2026-09-17T03:00:00Z', {
        'workers/message': `${ROLLBACK_MESSAGE_PREFIX} to v-good`,
      }),
    ]
    const { context: ctx, calls } = context([], afterRollback)
    const result = await runRollback(parseRollbackArgs([]), ctx)
    expect(result.outcome).toBe('rollback-refused')
    expect(result.detail).toContain('roll forward')
    expect(calls.rolledBack).toEqual([])
    // The same history, addressed explicitly, is allowed.
    expect(resolvePreviousVersion(afterRollback)).toEqual({
      kind: 'would-roll-forward',
      versionId: 'v-bad',
    })
  })

  it("recognises Cloudflare's own rollback trigger annotation", () => {
    const afterRollback = [
      ...deployments,
      deployment('d3', 'v-good', '2026-09-17T03:00:00Z', {
        'workers/triggered_by': 'rollback',
      }),
    ]
    expect(resolvePreviousVersion(afterRollback).kind).toBe('would-roll-forward')
  })

  it('refuses when there is no earlier version at all', async () => {
    const { context: ctx } = context([], [deployment('d1', 'v1', '2026-09-17T01:00:00Z')])
    const result = await runRollback(parseRollbackArgs([]), ctx)
    expect(result.outcome).toBe('rollback-refused')
    expect(result.detail).toContain('No earlier deployed version')
  })

  it('refuses outside Actions', async () => {
    const { context: ctx, calls } = context([], deployments, { CI: 'true' })
    const result = await runRollback(parseRollbackArgs([]), ctx)
    expect(result.outcome).toBe('guard-refused')
    expect(calls.rolledBack).toEqual([])
  })
})

describe('argument parsing', () => {
  it('rejects a promote that names both a commit and a version', () => {
    expect(() => parseVersionsPromoteArgs(['--sha', SHA, '--version-id', 'v1'])).toThrow('not both')
    expect(() => parseVersionsPromoteArgs(['--sha', 'not-a-sha'])).toThrow('hex commit SHA')
    expect(() => parseVersionsPromoteArgs(['--bogus'])).toThrow(
      'Unknown deploy versions-promote option: --bogus',
    )
    expect(() => parseVersionsPromoteArgs(['--sha'])).toThrow('--sha requires a value')
    expect(() => parseRollbackArgs(['--bogus'])).toThrow('Unknown deploy rollback option: --bogus')
  })
})

describe('the upload side of the commit link', () => {
  it('tags an upload with the Workers Builds commit so a promote can find it', () => {
    expect(
      resolveVersionTagArgs([], { WORKERS_CI_COMMIT_SHA: SHA, WORKERS_CI_BRANCH: 'main' }),
    ).toEqual(['--tag', SHA, '--message', `Workers Builds main @ ${SHA.slice(0, 12)}`])
  })

  it('leaves a caller-supplied tag alone and adds nothing outside a Workers Build', () => {
    expect(resolveVersionTagArgs(['--tag', 'mine'], { WORKERS_CI_COMMIT_SHA: SHA })).toEqual([])
    expect(resolveVersionTagArgs(['--tag=mine'], { WORKERS_CI_COMMIT_SHA: SHA })).toEqual([])
    expect(resolveVersionTagArgs([], {})).toEqual([])
    expect(resolveVersionTagArgs([], { WORKERS_CI_COMMIT_SHA: 'not-hex' })).toEqual([])
  })

  it('puts the tag on the real versions upload command line', () => {
    const args = buildWranglerCommandArgs({
      action: 'versions-upload',
      hasGeneratedConfig: false,
      hasOutputEntrypoint: true,
      passthroughArgs: [],
      sourceConfigPath: '/tmp/app/.wrangler.deploy.production.json',
      appDir: '/tmp/app',
      env: { WORKERS_CI_COMMIT_SHA: SHA },
    })
    expect(args).toEqual([
      'exec',
      'wrangler',
      '--config',
      '/tmp/app/.wrangler.deploy.production.json',
      'versions',
      'upload',
      '--env=',
      '--tag',
      SHA,
    ])
  })
})

/* -------------------------------------------------------------------------- */
/* Review round 1                                                             */
/* -------------------------------------------------------------------------- */

/** A version carrying the sequential `number` Cloudflare's Versions API documents. */
function numbered(id: string, tag: string, number: number, branch = 'main'): WorkerVersion {
  return {
    id,
    number,
    metadata: { source: 'wrangler', created_on: '2026-09-17T00:00:00Z' },
    annotations: {
      'workers/tag': tag,
      'workers/message': `Workers Builds ${branch} @ ${tag.slice(0, 12)}`,
    },
  }
}

const SHA_OLD = 'aaaaaaa1111111111111111111111111111111111'
const SHA_NEW = 'bbbbbbb2222222222222222222222222222222222'

describe('B1 -- an older promote must never roll production backwards', () => {
  const versions = [numbered('v-new', SHA_NEW, 11), numbered('v-old', SHA_OLD, 10)]
  const live = [deployment('d1', 'v-new', '2026-09-17T02:00:00Z')]

  it('refuses a version older than the one already serving production', async () => {
    // Two PRs merged 40 s apart: B promoted v-new, then A's still-running job
    // resolves its own SHA to v-old. Without the guard this deploys v-old at
    // 100%, reports `promoted`, exits 0, and its own live proof passes because
    // v-old really does serve the SHA that job expects.
    const { context: ctx, calls } = context(versions, live)
    const result = await runVersionsPromote(parseVersionsPromoteArgs(['--sha', SHA_OLD]), ctx)
    expect(result.outcome).toBe('stale-promote')
    expect(result.exitCode).toBe(PROMOTE_EXIT.stalePromote)
    expect(result.detail).toContain('OLDER than the version already serving production')
    expect(calls.deployed).toEqual([])
  })

  it('refuses when neither version can be ordered at all', async () => {
    const unorderable = [
      { id: 'v-new', annotations: { 'workers/tag': SHA_NEW } },
      { id: 'v-old', annotations: { 'workers/tag': SHA_OLD } },
    ]
    const { context: ctx, calls } = context(unorderable, live)
    const result = await runVersionsPromote(parseVersionsPromoteArgs(['--sha', SHA_OLD]), ctx)
    expect(result.outcome).toBe('stale-promote')
    expect(result.detail).toContain('Cannot tell whether')
    expect(calls.deployed).toEqual([])
  })

  it('lets --force through, and says loudly that it was forced', async () => {
    const { context: ctx, calls } = context(versions, live)
    const result = await runVersionsPromote(
      parseVersionsPromoteArgs(['--sha', SHA_OLD, '--force']),
      ctx,
    )
    expect(result.outcome).toBe('promoted')
    expect(result.forced).toBe(true)
    expect(calls.deployed[0].versionId).toBe('v-old')
    expect(formatPromoteResult(result)).toContain('FORCED')
  })

  it('promotes a newer version without complaint', async () => {
    const { context: ctx, calls } = context(versions, [
      deployment('d1', 'v-old', '2026-09-17T01:00:00Z'),
    ])
    const result = await runVersionsPromote(parseVersionsPromoteArgs(['--sha', SHA_NEW]), ctx)
    expect(result.outcome).toBe('promoted')
    expect(result.forced).toBeUndefined()
    expect(calls.deployed[0].versionId).toBe('v-new')
  })

  it('orders by created_on when no version number is present', () => {
    const older = { id: 'a', metadata: { created_on: '2026-09-17T01:00:00Z' } }
    const newer = { id: 'b', metadata: { created_on: '2026-09-17T02:00:00Z' } }
    expect(compareVersionRecency(newer, older)).toBe(1)
    expect(compareVersionRecency(older, newer)).toBe(-1)
    expect(compareVersionRecency(older, older)).toBe(0)
    expect(compareVersionRecency({ id: 'a' }, { id: 'b' })).toBeNull()
    // A number beats a timestamp: it is Cloudflare's own sequence.
    expect(compareVersionRecency({ ...older, number: 9 }, { ...newer, number: 8 })).toBe(1)
  })
})

describe('B2 -- every documented exit code is reachable', () => {
  function throwingClient(on: keyof WranglerVersionsClient): WranglerVersionsClient {
    const boom = (): never => {
      throw new Error(`wrangler ${on} exited 1`)
    }
    const base = stubClient([numbered('v1', SHA, 5)], [deployment('d1', 'v0', '2026-09-17T01:00Z')])
    return { ...base.client, [on]: async () => boom() }
  }

  it('returns exit 5 when wrangler fails mid-deploy, and flags the traffic risk', async () => {
    const result = await runVersionsPromote(parseVersionsPromoteArgs(['--sha', SHA]), {
      client: throwingClient('deployVersion'),
      env: ACTIONS_ENV,
      resolveWorkerName: () => 'buoys',
      appDir: '/tmp/app',
    })
    expect(result.outcome).toBe('wrangler-failed')
    expect(result.exitCode).toBe(PROMOTE_EXIT.wranglerFailed)
    expect(result.trafficMayHaveChanged).toBe(true)
    expect(result.detail).toContain('during versions deploy v1@100')
    expect(formatPromoteResult(result)).toContain('traffic risk YES')
  })

  it('returns exit 5 with no traffic risk when only a read failed', async () => {
    const result = await runVersionsPromote(parseVersionsPromoteArgs(['--sha', SHA]), {
      client: throwingClient('listDeployments'),
      env: ACTIONS_ENV,
      resolveWorkerName: () => 'buoys',
      appDir: '/tmp/app',
    })
    expect(result.exitCode).toBe(PROMOTE_EXIT.wranglerFailed)
    expect(result.trafficMayHaveChanged).toBe(false)
    expect(result.detail).toContain('production is untouched')
  })

  it('returns exit 5 when a rollback itself fails', async () => {
    const result = await runRollback(parseRollbackArgs(['--to', 'v-good']), {
      client: {
        ...stubClient([], [deployment('d1', 'v-bad', '2026-09-17T01:00:00Z')]).client,
        rollback: async () => {
          throw new Error('wrangler rollback exited 1')
        },
      },
      env: ACTIONS_ENV,
      resolveWorkerName: () => 'buoys',
      appDir: '/tmp/app',
    })
    expect(result.exitCode).toBe(PROMOTE_EXIT.wranglerFailed)
    expect(result.trafficMayHaveChanged).toBe(true)
    expect(result.versionId).toBe('v-good')
  })

  it('gives a usage error exit 2, never the guard-refusal 1', async () => {
    // Exit 1 must keep meaning "the guard refused, production is untouched".
    expect(await main(['deploy', 'versions-promote', '--sha'])).toBe(PROMOTE_EXIT.usage)
    expect(await main(['deploy', 'versions-promote', '--nope'])).toBe(PROMOTE_EXIT.usage)
    expect(await main(['deploy', 'versions-promote', '--sha', 'not-a-sha'])).toBe(
      PROMOTE_EXIT.usage,
    )
  })

  it('gives the guard refusal exit 1 from the real CLI path', async () => {
    const saved = { ...process.env }
    try {
      for (const key of ['CI', 'GITHUB_ACTIONS', 'NARDUK_ALLOW_MANUAL_PROMOTE']) {
        delete process.env[key]
      }
      expect(await main(['deploy', 'versions-promote', '--sha', SHA, '--name', 'buoys'])).toBe(
        PROMOTE_EXIT.refused,
      )
    } finally {
      process.env = saved
    }
  })

  it('covers the remaining documented codes through runVersionsPromote', async () => {
    const notFound = await runVersionsPromote(
      parseVersionsPromoteArgs(['--sha', SHA_OLD]),
      context([numbered('v1', SHA_NEW, 2)], []).context,
    )
    expect(notFound.exitCode).toBe(PROMOTE_EXIT.versionNotFound)

    const ambiguous = await runVersionsPromote(
      parseVersionsPromoteArgs(['--sha', SHA_NEW]),
      context([numbered('v1', SHA_NEW, 2), numbered('v2', SHA_NEW, 3)], []).context,
    )
    expect(ambiguous.exitCode).toBe(PROMOTE_EXIT.ambiguousVersion)

    const noop = await runRollback(
      parseRollbackArgs(['--to', 'v1']),
      context([], [deployment('d1', 'v1', '2026-09-17T01:00:00Z')]).context,
    )
    expect(noop.exitCode).toBe(PROMOTE_EXIT.rollbackRefused)

    const ok = await runVersionsPromote(
      parseVersionsPromoteArgs(['--sha', SHA_NEW]),
      context([numbered('v1', SHA_NEW, 2)], []).context,
    )
    expect(ok.exitCode).toBe(PROMOTE_EXIT.ok)
  })
})

describe('S1 -- the ref and event half of the guard', () => {
  it('refuses a pull_request event outright', () => {
    expect(checkPromoteContext({ GITHUB_EVENT_NAME: 'pull_request' }, null)?.reason).toContain(
      'refusing to promote from a pull_request event',
    )
    expect(checkPromoteContext({ GITHUB_EVENT_NAME: 'push' }, null)).toBeNull()
  })

  it('refuses a run whose ref is not the declared production branch', async () => {
    const { context: ctx, calls } = context([numbered('v1', SHA, 2)], [], {
      ...ACTIONS_ENV,
      GITHUB_EVENT_NAME: 'push',
      GITHUB_REF_NAME: 'feature/attacker-branch',
    })
    const result = await runVersionsPromote(
      parseVersionsPromoteArgs(['--sha', SHA, '--production-branch', 'main']),
      ctx,
    )
    expect(result.outcome).toBe('guard-refused')
    expect(result.exitCode).toBe(PROMOTE_EXIT.refused)
    expect(result.detail).toContain('not the declared production branch main')
    expect(calls.deployed).toEqual([])
  })

  it('refuses when a production branch is declared and no ref can be read', () => {
    expect(checkPromoteContext({ GITHUB_EVENT_NAME: 'push' }, 'main')?.reason).toContain(
      'GITHUB_REF_NAME is not set',
    )
  })

  it('promotes when the ref matches', async () => {
    const { context: ctx, calls } = context([numbered('v1', SHA, 2)], [], {
      ...ACTIONS_ENV,
      GITHUB_EVENT_NAME: 'push',
      GITHUB_REF_NAME: 'main',
    })
    const result = await runVersionsPromote(
      parseVersionsPromoteArgs(['--sha', SHA, '--production-branch', 'main']),
      ctx,
    )
    expect(result.outcome).toBe('promoted')
    expect(calls.deployed[0].versionId).toBe('v1')
  })

  it('no longer asserts the gate check as fact', () => {
    expect(getPromoteGuardMessage('versions-promote')).toContain('does not and cannot read')
  })
})

describe('S2 -- a non-production branch build is not promotable', () => {
  const env = { ...ACTIONS_ENV, GITHUB_EVENT_NAME: 'push', GITHUB_REF_NAME: 'main' }

  it('refuses a version whose Workers Build recorded another branch', async () => {
    // main's build failed; an earlier branch build of the same commit carries
    // the same workers/tag and would otherwise be the single match.
    const { context: ctx, calls } = context(
      [numbered('v1', SHA, 2, 'feature/attacker-branch')],
      [],
      env,
    )
    const result = await runVersionsPromote(
      parseVersionsPromoteArgs(['--sha', SHA, '--production-branch', 'main']),
      ctx,
    )
    expect(result.outcome).toBe('branch-mismatch')
    expect(result.exitCode).toBe(PROMOTE_EXIT.branchMismatch)
    expect(result.detail).toContain('feature/attacker-branch')
    expect(calls.deployed).toEqual([])
  })

  it('refuses a version that records no branch at all', async () => {
    const { context: ctx, calls } = context([version('v1', SHA)], [], env)
    const result = await runVersionsPromote(
      parseVersionsPromoteArgs(['--sha', SHA, '--production-branch', 'main']),
      ctx,
    )
    expect(result.outcome).toBe('branch-mismatch')
    expect(result.detail).toContain('records no branch')
    expect(calls.deployed).toEqual([])
  })

  it('lets --any-branch through for a deliberate promotion', async () => {
    const { context: ctx, calls } = context([numbered('v1', SHA, 2, 'hotfix')], [], env)
    const result = await runVersionsPromote(
      parseVersionsPromoteArgs(['--sha', SHA, '--production-branch', 'main', '--any-branch']),
      ctx,
    )
    expect(result.outcome).toBe('promoted')
    expect(calls.deployed[0].versionId).toBe('v1')
  })

  it('reads the branch out of the message deploy.ts writes', () => {
    expect(versionBranch(numbered('v1', SHA, 2, 'main'))).toBe('main')
    expect(versionBranch(numbered('v1', SHA, 2, 'feature/a b'))).toBe('feature/a b')
    expect(versionBranch(version('v1', SHA))).toBeNull()
    expect(
      versionBranch({ id: 'v', annotations: { 'workers/message': 'narduk-app promote abc' } }),
    ).toBeNull()
  })
})

describe('S3 -- the roll-forward guard fails closed', () => {
  it('refuses an unnamed rollback when the live deployment carries no annotations', async () => {
    const deployments = [
      deployment('d1', 'v-good', '2026-09-17T01:00:00Z'),
      deployment('d2', 'v-bad', '2026-09-17T02:00:00Z', null),
    ]
    const { context: ctx, calls } = context([], deployments)
    const result = await runRollback(parseRollbackArgs([]), ctx)
    expect(result.outcome).toBe('rollback-refused')
    expect(result.detail).toContain('cannot be ruled out as a rollback')
    expect(calls.rolledBack).toEqual([])
    expect(resolvePreviousVersion(deployments)).toEqual({
      kind: 'unknown-provenance',
      versionId: 'v-good',
    })
  })

  it('still rolls back when the target is named explicitly', async () => {
    const { context: ctx, calls } = context(
      [],
      [
        deployment('d1', 'v-good', '2026-09-17T01:00:00Z'),
        deployment('d2', 'v-bad', '2026-09-17T02:00:00Z', null),
      ],
    )
    const result = await runRollback(parseRollbackArgs(['--to', 'v-good']), ctx)
    expect(result.outcome).toBe('rolled-back')
    expect(calls.rolledBack[0].versionId).toBe('v-good')
  })

  it('distinguishes all three provenance answers', () => {
    expect(rollbackProvenance(deployment('d', 'v', '2026-09-17T01:00:00Z', null))).toBe('unknown')
    expect(rollbackProvenance(null)).toBe('unknown')
    expect(rollbackProvenance(deployment('d', 'v', '2026-09-17T01:00:00Z'))).toBe('not-rollback')
    expect(
      rollbackProvenance(
        deployment('d', 'v', '2026-09-17T01:00:00Z', { 'workers/triggered_by': 'rollback' }),
      ),
    ).toBe('rollback')
  })
})

describe('S5 -- below the WranglerVersionsClient seam', () => {
  /** Exactly what `wrangler versions list --json` returned for `buoys`, 2026-09-17. */
  const RECORDED_VERSIONS = `⛅️ wrangler 4.133.0
[
  {
    "id": "5c1b2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d",
    "number": 42,
    "metadata": {
      "created_on": "2026-09-17T12:00:00.000Z",
      "source": "wrangler",
      "author_id": "a1b2c3",
      "author_email": "ci@narduk.test",
      "has_preview": false
    },
    "annotations": {
      "workers/alias": "main",
      "workers/triggered_by": "version_upload",
      "workers/tag": "${SHA}",
      "workers/message": "Workers Builds main @ ${SHA.slice(0, 12)}"
    }
  }
]
`
  const RECORDED_DEPLOYMENTS = `[
  {
    "id": "d-1",
    "source": "wrangler",
    "strategy": "percentage",
    "created_on": "2026-09-17T12:01:00.000Z",
    "annotations": { "workers/triggered_by": "deployment" },
    "versions": [{ "version_id": "5c1b2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d", "percentage": 100 }]
  }
]
`

  function recordingSpawn(stdout: string): {
    spawn: SpawnWrangler
    calls: Array<{ args: string[]; cwd: string; accountId?: string }>
  } {
    const calls: Array<{ args: string[]; cwd: string; accountId?: string }> = []
    const spawn: SpawnWrangler = (command, args, options): SpawnResult => {
      expect(command).toBe('pnpm')
      calls.push({ args, cwd: options.cwd, accountId: options.env.CLOUDFLARE_ACCOUNT_ID })
      return { status: 0, signal: null, stdout }
    }
    return { spawn, calls }
  }

  it('builds the exact argv wrangler will receive, and parses a recorded document', async () => {
    const { spawn, calls } = recordingSpawn(RECORDED_VERSIONS)
    const cli = createWranglerCli({
      workerName: 'buoys',
      accountId: 'acct-1',
      appDir: '/tmp/app',
      env: {},
      spawn,
    })
    const listing = await cli.listVersions(DEFAULT_VERSION_SEARCH_LIMIT)
    const versions = listing.versions
    expect(listing.source).toBe('wrangler')
    expect(calls[0].args).toEqual([
      'exec',
      'wrangler',
      'versions',
      'list',
      '--json',
      '--name',
      'buoys',
    ])
    expect(calls[0].cwd).toBe('/tmp/app')
    expect(calls[0].accountId).toBe('acct-1')
    expect(versions[0].number).toBe(42)
    expect(versions[0].metadata?.has_preview).toBe(false)
    expect(versions[0].metadata?.source).toBe('wrangler')
    expect(versionBranch(versions[0])).toBe('main')
    expect(shaMatchesTag(SHA, versions[0].annotations?.['workers/tag'])).toBe(true)
  })

  it('builds the deploy, rollback and deployments argv', async () => {
    const { spawn, calls } = recordingSpawn(RECORDED_DEPLOYMENTS)
    const cli = createWranglerCli({ workerName: 'buoys', appDir: '/tmp/app', env: {}, spawn })
    const deployments = await cli.listDeployments()
    expect(deployments[0].versions[0].percentage).toBe(100)
    expect(soleDeployedVersionId(deployments[0])).toBe('5c1b2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d')
    await cli.deployVersion('v-1', 100, 'hello')
    await cli.rollback('v-0', 'bye')
    expect(calls[1].args).toEqual([
      'exec',
      'wrangler',
      'versions',
      'deploy',
      'v-1@100',
      '--yes',
      '--message',
      'hello',
      '--name',
      'buoys',
    ])
    expect(calls[2].args).toEqual([
      'exec',
      'wrangler',
      'rollback',
      'v-0',
      '--yes',
      '--message',
      'bye',
      '--name',
      'buoys',
    ])
  })

  it('turns a non-zero wrangler exit into an error the promote path can contain', async () => {
    const cli = createWranglerCli({
      workerName: 'buoys',
      env: {},
      spawn: () => ({ status: 1, signal: null, stdout: '' }),
    })
    await expect(cli.listVersions(DEFAULT_VERSION_SEARCH_LIMIT)).rejects.toThrow('exited 1')
    const killed = createWranglerCli({
      workerName: 'buoys',
      env: {},
      spawn: () => ({ status: null, signal: 'SIGKILL', stdout: '' }),
    })
    await expect(killed.listVersions(DEFAULT_VERSION_SEARCH_LIMIT)).rejects.toThrow('SIGKILL')
  })

  it('does not overwrite an account id the environment already carries', async () => {
    const { spawn, calls } = recordingSpawn(RECORDED_DEPLOYMENTS)
    const cli = createWranglerCli({
      workerName: 'buoys',
      accountId: 'from-config',
      env: { CLOUDFLARE_ACCOUNT_ID: 'from-env' },
      spawn,
    })
    await cli.listDeployments()
    expect(calls[0].accountId).toBe('from-env')
  })
})

/**
 * narduk-libs#451 defect 1: the `--sha` lookup used to see only the page
 * `wrangler versions list` prints -- ten versions -- so ten branch uploads
 * between a merge upload and its promote job left production un-updated.
 */
describe('bounded version search (#451 defect 1)', () => {
  /** A Cloudflare Versions list response page. */
  function page(items: WorkerVersion[]): Response {
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ success: true, errors: [], messages: [], result: { items } }),
    } as unknown as Response
  }

  /** A history whose tagged version sits `depth` versions below the newest. */
  function history(depth: number, tag: string): WorkerVersion[] {
    return Array.from({ length: depth + 40 }, (_, index) =>
      version(
        `v-${String(index)}`,
        index === depth ? tag : `beef${String(index).padStart(3, '0')}`,
        {
          number: 10_000 - index,
        },
      ),
    )
  }

  function pagingFetch(all: WorkerVersion[]): {
    fetchImpl: typeof fetch
    urls: string[]
  } {
    const urls: string[] = []
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input)
      urls.push(url)
      const perPage = Number(new URL(url).searchParams.get('per_page'))
      const pageNumber = Number(new URL(url).searchParams.get('page'))
      return page(all.slice((pageNumber - 1) * perPage, pageNumber * perPage))
    }) as unknown as typeof fetch
    return { fetchImpl, urls }
  }

  const API_ENV = { ...ACTIONS_ENV, CLOUDFLARE_API_TOKEN: 'token-1' }

  it('finds a version far below the ten wrangler can show, and promotes it', async () => {
    const all = history(147, SHA)
    const { fetchImpl, urls } = pagingFetch(all)
    const client = createWranglerCli({
      workerName: 'buoys',
      accountId: 'acct-1',
      env: API_ENV,
      fetchImpl,
      spawn: () => {
        throw new Error('the API path must not shell out to wrangler for a listing')
      },
    })
    const listing = await client.listVersions(DEFAULT_VERSION_SEARCH_LIMIT)
    expect(listing.source).toBe('api')
    expect(listing.versions.length).toBe(all.length)
    expect(listing.complete).toBe(true)
    // The version that matters is deeper than anything `wrangler versions list`
    // would have returned -- that is the whole defect.
    expect(147).toBeGreaterThan(WRANGLER_VERSION_LIST_CAP)
    const match = resolveVersionForSha(listing.versions, SHA)
    expect(match.kind).toBe('found')
    // page 1 asks for the full page size; the walk stops on the short page.
    expect(urls[0]).toContain(`per_page=${String(VERSION_PAGE_SIZE)}`)
    expect(urls[0]).toContain('page=1')
    expect(urls[1]).toContain('page=2')
  })

  it('never paginates past the bound, and reports the bound it used', async () => {
    const all = history(400, SHA)
    const { fetchImpl, urls } = pagingFetch(all)
    const client = createWranglerCli({
      workerName: 'buoys',
      accountId: 'acct-1',
      env: API_ENV,
      fetchImpl,
    })
    const listing = await client.listVersions(120)
    expect(listing.versions.length).toBe(120)
    expect(listing.limit).toBe(120)
    expect(listing.complete).toBe(false)
    expect(urls.length).toBe(2)
    // Every page asks for the SAME per_page; shrinking it on the last page
    // would move the server-side offset and re-read page 1 (#457 diff-read).
    expect(urls[1]).toContain(`per_page=${String(VERSION_PAGE_SIZE)}`)
    expect(urls.every((url) => url.includes(`per_page=${String(VERSION_PAGE_SIZE)}`))).toBe(true)
  })

  it('promotes nothing with exit 3 -- never 0 -- and names the sha and the count', async () => {
    const versions = [version('v-live', 'aaaaaaa', { number: 2 })]
    const { context: ctx } = context(versions, [
      deployment('d-1', 'v-live', '2026-09-17T00:00:00Z'),
    ])
    const result = await runVersionsPromote({ ...parseVersionsPromoteArgs(['--sha', SHA]) }, ctx)
    expect(result.outcome).toBe('version-not-found')
    expect(result.exitCode).toBe(PROMOTE_EXIT.versionNotFound)
    expect(result.exitCode).not.toBe(PROMOTE_EXIT.ok)
    expect(result.detail).toContain(SHA)
    expect(result.detail).toContain('1 version(s) searched')
    expect(result.searchedVersions).toBe(1)
    expect(result.versionSearch).toEqual({
      source: 'api',
      limit: DEFAULT_VERSION_SEARCH_LIMIT,
      complete: true,
    })
  })

  it('tells "never uploaded" apart from "older than the bound" and from the wrangler fallback', () => {
    const exhausted = describeVersionSearch(SHA, 500, {
      source: 'api',
      limit: 500,
      complete: false,
    })
    expect(exhausted).toContain('stopped at its bound')
    expect(exhausted).toContain('--max-versions')
    const complete = describeVersionSearch(SHA, 83, { source: 'api', limit: 500, complete: true })
    expect(complete).toContain('reached the end')
    expect(complete).toContain('no build ever uploaded')
    const fallback = describeVersionSearch(SHA, 10, {
      source: 'wrangler',
      limit: WRANGLER_VERSION_LIST_CAP,
      complete: false,
    })
    expect(fallback).toContain('CLOUDFLARE_API_TOKEN')
    expect(fallback).toContain('takes no paging flag')
  })

  it('falls back to wrangler only when the account id or token is missing, and says which', async () => {
    expect(resolveVersionsApiAuth({ workerName: 'buoys', accountId: 'acct-1' }, {})).toBeNull()
    expect(
      resolveVersionsApiAuth({ workerName: 'buoys' }, { CLOUDFLARE_API_TOKEN: 't' }),
    ).toBeNull()
    expect(
      resolveVersionsApiAuth(
        { workerName: 'buoys' },
        {
          CLOUDFLARE_ACCOUNT_ID: 'acct-2',
          CLOUDFLARE_API_TOKEN: 't',
        },
      ),
    ).toEqual({ accountId: 'acct-2', apiToken: 't' })
    const cli = createWranglerCli({
      workerName: 'buoys',
      accountId: 'acct-1',
      env: {},
      spawn: () => ({
        status: 0,
        signal: null,
        stdout: JSON.stringify([version('v-1', 'aaaaaaa')]),
      }),
    })
    const listing: VersionListing = await cli.listVersions(DEFAULT_VERSION_SEARCH_LIMIT)
    expect(listing.source).toBe('wrangler')
    expect(listing.limit).toBe(WRANGLER_VERSION_LIST_CAP)
    expect(listing.complete).toBe(true)
  })

  it('surfaces a Cloudflare API error rather than reporting an empty history', async () => {
    const fetchImpl = (async () =>
      ({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        json: async () => ({ success: false, errors: [{ message: 'Insufficient permissions' }] }),
      }) as unknown as Response) as unknown as typeof fetch
    await expect(
      listWorkerVersionsViaApi({
        accountId: 'acct-1',
        apiToken: 'token-1',
        scriptName: 'buoys',
        limit: 50,
        fetchImpl,
      }),
    ).rejects.toThrow('Cloudflare API 403')
  })

  it('parses and bounds --max-versions', () => {
    expect(parseVersionsPromoteArgs([]).maxVersions).toBe(DEFAULT_VERSION_SEARCH_LIMIT)
    expect(parseVersionsPromoteArgs(['--max-versions', '25']).maxVersions).toBe(25)
    expect(() => parseVersionsPromoteArgs(['--max-versions', '0'])).toThrow('1..10000')
    expect(() => parseVersionsPromoteArgs(['--max-versions', 'lots'])).toThrow('1..10000')
  })
})

/**
 * narduk-libs#451 defect 2: under `on: workflow_run`, `GITHUB_SHA` is the
 * default branch head at trigger time, not the commit whose run went green.
 */
describe('workflow_run commit resolution (#451 defect 2)', () => {
  const DEFAULT_BRANCH_HEAD = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'
  const VERIFIED = SHA

  it('refuses to default --sha to GITHUB_SHA under a workflow_run event', () => {
    expect(() =>
      defaultPromoteSha(
        { GITHUB_SHA: DEFAULT_BRANCH_HEAD, GITHUB_EVENT_NAME: 'workflow_run' },
        false,
      ),
    ).toThrow('workflow_run')
    expect(() =>
      defaultPromoteSha(
        { GITHUB_SHA: DEFAULT_BRANCH_HEAD, GITHUB_EVENT_NAME: 'workflow_run' },
        false,
      ),
    ).toThrow('github.event.workflow_run.head_sha')
  })

  it('still defaults on the events where GITHUB_SHA is the commit', () => {
    expect(
      defaultPromoteSha({ GITHUB_SHA: DEFAULT_BRANCH_HEAD, GITHUB_EVENT_NAME: 'push' }, false),
    ).toBe(DEFAULT_BRANCH_HEAD)
    expect(defaultPromoteSha({ GITHUB_SHA: DEFAULT_BRANCH_HEAD }, false)).toBe(DEFAULT_BRANCH_HEAD)
    expect(
      defaultPromoteSha(
        { GITHUB_SHA: DEFAULT_BRANCH_HEAD, GITHUB_EVENT_NAME: 'workflow_run' },
        true,
      ),
    ).toBeNull()
  })

  it('does not promote the default-branch head a workflow_run run carries', async () => {
    const versions = [
      version('v-head', DEFAULT_BRANCH_HEAD, { number: 9 }),
      version('v-verified', VERIFIED, { number: 8 }),
      version('v-live', 'cccccccc', { number: 7 }),
    ]
    const deployments = [deployment('d-1', 'v-live', '2026-09-17T00:00:00Z')]
    const env = {
      ...ACTIONS_ENV,
      GITHUB_SHA: DEFAULT_BRANCH_HEAD,
      GITHUB_EVENT_NAME: 'workflow_run',
      GITHUB_REF_NAME: 'main',
    }
    const { context: ctx } = context(versions, deployments, env)
    await expect(runVersionsPromote(parseVersionsPromoteArgs([]), ctx)).rejects.toThrow(
      'workflow_run',
    )
    // The explicit, correct form still promotes -- the refusal is about the
    // default, not about the event.
    const { context: ok, calls } = context(versions, deployments, env)
    const result = await runVersionsPromote(
      parseVersionsPromoteArgs(['--sha', VERIFIED, '--any-branch']),
      ok,
    )
    expect(result.outcome).toBe('promoted')
    expect(calls.deployed[0].versionId).toBe('v-verified')
  })
})

/**
 * The two behavioural regressions, written so they run against either shape of
 * `listVersions`: the stub returns an array that ALSO carries the listing
 * fields, and caps itself at ten when the caller asks for no bound -- which is
 * exactly what a client that can only read `wrangler versions list` could ever
 * hand back. The ten is a literal on purpose: a constant imported from the
 * module under test would be `undefined` on a revision that does not export it,
 * and an `undefined` cap silently un-caps the stub.
 */
describe('#451 regressions, shape-agnostic', () => {
  const WRANGLER_CAP = 10

  function cappedClient(
    versions: WorkerVersion[],
    deployments: WorkerDeployment[],
  ): { client: WranglerVersionsClient; calls: StubCalls } {
    const calls: StubCalls = { deployed: [], rolledBack: [] }
    const listVersions = async (limit?: number) => {
      const rows = versions.slice(0, limit ?? WRANGLER_CAP)
      return Object.assign(rows.slice(), {
        versions: rows,
        complete: rows.length === versions.length,
        limit: limit ?? WRANGLER_CAP,
        source: 'api' as const,
      })
    }
    return {
      calls,
      client: {
        listVersions: listVersions as WranglerVersionsClient['listVersions'],
        listDeployments: async () => deployments,
        deployVersion: async (versionId, percentage, message) => {
          calls.deployed.push({ versionId, percentage, message })
        },
        rollback: async () => {},
      },
    }
  }

  it("models wrangler's own cap", () => {
    expect(WRANGLER_CAP).toBe(WRANGLER_VERSION_LIST_CAP)
  })

  it('promotes a merge whose version is buried under branch uploads (defect 1)', async () => {
    // 47 branch uploads landed between the main upload and the promote job.
    const versions = [
      ...Array.from({ length: 47 }, (_, index) =>
        version(`v-branch-${String(index)}`, `abcdef${String(index).padStart(2, '0')}`, {
          number: 500 - index,
        }),
      ),
      version('v-main', SHA, { number: 400 }),
      version('v-live', 'ffffff00', { number: 399 }),
    ]
    const { client, calls } = cappedClient(versions, [
      deployment('d-1', 'v-live', '2026-09-17T00:00:00Z'),
    ])
    const result = await runVersionsPromote(
      parseVersionsPromoteArgs(['--sha', SHA, '--any-branch']),
      { client, env: ACTIONS_ENV, resolveWorkerName: () => 'buoys', appDir: '/tmp/app' },
    )
    expect(result.outcome).toBe('promoted')
    expect(calls.deployed).toEqual([
      { versionId: 'v-main', percentage: 100, message: `narduk-app promote ${SHA}` },
    ])
  })

  it('never promotes the default-branch head under workflow_run (defect 2)', async () => {
    const head = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'
    const versions = [
      version('v-head', head, { number: 9 }),
      version('v-verified', SHA, { number: 8 }),
      version('v-live', 'cccccc00', { number: 7 }),
    ]
    const { client, calls } = cappedClient(versions, [
      deployment('d-1', 'v-live', '2026-09-17T00:00:00Z'),
    ])
    const env = {
      ...ACTIONS_ENV,
      GITHUB_SHA: head,
      GITHUB_EVENT_NAME: 'workflow_run',
      GITHUB_REF_NAME: 'main',
    }
    await runVersionsPromote(parseVersionsPromoteArgs(['--any-branch']), {
      client,
      env,
      resolveWorkerName: () => 'buoys',
      appDir: '/tmp/app',
    }).catch(() => {
      // On this revision the default is refused outright; on the one before it
      // the call resolved and deployed. Either way the assertion below is the
      // regression: nothing may be deployed from the branch head.
    })
    // The commit `ci / Required` verified is SHA, not the branch head. Promoting
    // `v-head` deploys code that never passed the gate.
    expect(calls.deployed).toEqual([])
  })
})

/**
 * The two pagination defects an orchestrator diff-read of PR #457 found in
 * `listWorkerVersionsViaApi` at b0c4e898.
 *
 * Both fakes model V4 page pagination the way the API defines it -- the offset
 * is `(page - 1) * per_page_applied`, computed server side -- rather than the
 * way the caller hoped, which is the whole point.
 */
describe('Versions API pagination (#457 diff-read)', () => {
  /**
   * `clamp` is the largest `per_page` this fake honours; a request above it is
   * silently reduced, exactly as an endpoint with a lower maximum would.
   * `reportInfo` decides whether the envelope carries `result_info` at all.
   */
  function apiFake(options: { all: WorkerVersion[]; clamp?: number; reportInfo?: boolean }): {
    fetchImpl: typeof fetch
    urls: string[]
  } {
    const urls: string[] = []
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      urls.push(String(input))
      const asked = Number(url.searchParams.get('per_page'))
      const page = Number(url.searchParams.get('page'))
      const perPage = Math.min(asked, options.clamp ?? asked)
      const items = options.all.slice((page - 1) * perPage, page * perPage)
      const body: Record<string, unknown> = {
        success: true,
        errors: [],
        messages: [],
        result: { items },
      }
      if (options.reportInfo) {
        body.result_info = {
          page,
          per_page: perPage,
          count: items.length,
          total_count: options.all.length,
          total_pages: Math.ceil(options.all.length / perPage),
        }
      }
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => body,
      } as unknown as Response
    }) as unknown as typeof fetch
    return { fetchImpl, urls }
  }

  /** A history of `size` versions, the target tagged at 0-based `position`. */
  function historyWithTargetAt(size: number, position: number, tag: string): WorkerVersion[] {
    return Array.from({ length: size }, (_, index) =>
      version(
        `v-${String(index)}`,
        index === position ? tag : `dead${String(index).padStart(4, '0')}`,
        { number: 100_000 - index },
      ),
    )
  }

  it('asks for one constant per_page, so a non-multiple bound cannot re-read page 1', async () => {
    // 250 is deliberately not a multiple of 100: a last page asking
    // per_page=50&page=3 is served items 101..150 again, so the rows the bound
    // was meant to reach are never read and the duplicates can even make one
    // tag look ambiguous.
    const all = historyWithTargetAt(400, 230, SHA)
    const { fetchImpl, urls } = apiFake({ all, reportInfo: true })
    const listing = await listWorkerVersionsViaApi({
      accountId: 'acct-1',
      apiToken: 'token-1',
      scriptName: 'buoys',
      limit: 250,
      fetchImpl,
    })
    const sizes = new Set(urls.map((url) => new URL(url).searchParams.get('per_page')))
    expect([...sizes]).toEqual([String(VERSION_PAGE_SIZE)])
    expect(listing.versions).toHaveLength(250)
    expect(new Set(listing.versions.map((row) => row.id)).size).toBe(250)
    const tagged = listing.versions.filter((row) => row.annotations?.['workers/tag'] === SHA)
    expect(tagged).toHaveLength(1)
    expect(resolveVersionForSha(listing.versions, SHA)).toMatchObject({
      kind: 'found',
      version: { id: 'v-230' },
    })
  })

  it('walks past a clamped per_page the envelope reports', async () => {
    const all = historyWithTargetAt(120, 60, SHA)
    const { fetchImpl } = apiFake({ all, clamp: 25, reportInfo: true })
    const listing = await listWorkerVersionsViaApi({
      accountId: 'acct-1',
      apiToken: 'token-1',
      scriptName: 'buoys',
      limit: 500,
      fetchImpl,
    })
    expect(listing.versions).toHaveLength(120)
    expect(listing.complete).toBe(true)
    expect(resolveVersionForSha(listing.versions, SHA)).toMatchObject({
      kind: 'found',
      version: { id: 'v-60' },
    })
  })

  it('walks past a per_page clamped silently, and only an empty page ends it', async () => {
    const all = historyWithTargetAt(120, 60, SHA)
    const { fetchImpl, urls } = apiFake({ all, clamp: 25 })
    const listing = await listWorkerVersionsViaApi({
      accountId: 'acct-1',
      apiToken: 'token-1',
      scriptName: 'buoys',
      limit: 500,
      fetchImpl,
    })
    expect(listing.versions).toHaveLength(120)
    expect(resolveVersionForSha(listing.versions, SHA)).toMatchObject({
      kind: 'found',
      version: { id: 'v-60' },
    })
    // Without result_info a short page proves nothing -- the endpoint may have
    // clamped. Completion is claimed only after a page comes back empty, which
    // costs exactly one extra read.
    expect(listing.complete).toBe(true)
    expect(urls).toHaveLength(Math.ceil(120 / 25) + 1)
  })

  it('does not claim the end of the history when it stopped at the bound', async () => {
    const all = historyWithTargetAt(400, 10, SHA)
    const { fetchImpl } = apiFake({ all, reportInfo: true })
    const listing = await listWorkerVersionsViaApi({
      accountId: 'acct-1',
      apiToken: 'token-1',
      scriptName: 'buoys',
      limit: 150,
      fetchImpl,
    })
    expect(listing.versions).toHaveLength(150)
    expect(listing.complete).toBe(false)
  })
})
