import { describe, expect, it } from 'vitest'

import { buildWranglerCommandArgs, resolveVersionTagArgs } from '../src/deploy.js'
import {
  currentDeployment,
  getPromoteGuardMessage,
  isActionsPromoteAllowed,
  isManualPromoteAllowed,
  parseRollbackArgs,
  parseVersionsPromoteArgs,
  parseWranglerVersionsJson,
  PROMOTE_EXIT,
  resolvePreviousVersion,
  resolveVersionForSha,
  ROLLBACK_MESSAGE_PREFIX,
  runRollback,
  runVersionsPromote,
  shaMatchesTag,
  soleDeployedVersionId,
  type PromoteContext,
  type WorkerDeployment,
  type WorkerVersion,
  type WranglerVersionsClient,
} from '../src/promote.js'

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

function deployment(
  id: string,
  versionId: string,
  createdOn: string,
  annotations?: Record<string, string>,
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
      listVersions: async () => versions,
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
    expect(result.detail).toContain('at most 10 versions')
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
