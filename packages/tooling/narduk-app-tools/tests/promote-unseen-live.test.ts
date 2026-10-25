import { describe, expect, it } from 'vitest'

import {
  parseVersionsPromoteArgs,
  runVersionsPromote,
  type WorkerDeployment,
  type WorkerVersion,
  type WranglerVersionsClient,
} from '../src/promote.js'

// ponytail-5 apptools-src #1: promote must not skip the rollback guards when it
// cannot see one live version.

const SHA_OLD = 'aaaaaaa1111111111111111111111111111111111'
const SHA_GOOD = 'bbbbbbb2222222222222222222222222222222222'
const SHA_CANARY = 'ccccccc3333333333333333333333333333333333'

const ACTIONS_ENV = {
  CI: 'true',
  GITHUB_ACTIONS: 'true',
  GITHUB_RUN_ID: '123456',
  GITHUB_REPOSITORY: 'narduk-enterprises/buoys',
  GITHUB_WORKFLOW: 'promote',
}

function numbered(id: string, tag: string, number: number): WorkerVersion {
  return {
    id,
    number,
    metadata: { source: 'wrangler', created_on: '2026-09-17T00:00:00Z' },
    annotations: {
      'workers/tag': tag,
      'workers/message': `Workers Builds main @ ${tag.slice(0, 12)}`,
    },
  }
}

function run(versions: WorkerVersion[], deployments: WorkerDeployment[], complete: boolean) {
  const deployed: string[] = []
  const client: WranglerVersionsClient = {
    listVersions: async (limit) => ({ versions, complete, limit, source: 'api' }),
    listDeployments: async () => deployments,
    deployVersion: async (versionId) => {
      deployed.push(versionId)
    },
    rollback: async () => {},
  }
  return {
    deployed,
    result: runVersionsPromote(parseVersionsPromoteArgs(['--sha', SHA_OLD]), {
      client,
      env: ACTIONS_ENV,
      resolveWorkerName: () => 'buoys',
      appDir: '/tmp/app',
      ancestry: () => 'unknown',
      dispatchInputs: () => ({ verifiedSha: true, versionId: true }),
      log: () => {},
    }),
  }
}

describe('promote with no single visible live version', () => {
  it('refuses an older version while traffic is split', async () => {
    const split: WorkerDeployment = {
      id: 'd-split',
      created_on: '2026-09-17T03:00:00Z',
      versions: [
        { version_id: 'v-canary', percentage: 10 },
        { version_id: 'v-good', percentage: 90 },
      ],
    }
    const { result, deployed } = run(
      [
        numbered('v-canary', SHA_CANARY, 12),
        numbered('v-good', SHA_GOOD, 11),
        numbered('v-old', SHA_OLD, 10),
      ],
      [split],
      true,
    )
    const outcome = await result
    expect(outcome.outcome).toBe('stale-promote')
    expect(deployed).toEqual([])
  })

  it('refuses when the live version is outside the listed window', async () => {
    const live: WorkerDeployment = {
      id: 'd-live',
      created_on: '2026-09-17T03:00:00Z',
      versions: [{ version_id: 'v-live', percentage: 100 }],
    }
    // v-live (number 5) fell out of a bounded listing; v-old is inside it.
    const { result, deployed } = run([numbered('v-old', SHA_OLD, 10)], [live], false)
    const outcome = await result
    expect(outcome.outcome).toBe('stale-promote')
    expect(deployed).toEqual([])
  })
})
