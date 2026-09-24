import assert from 'node:assert/strict'
import { test } from 'node:test'

import { readFileSync } from 'node:fs'
import {
  approveableRunIds,
  commitFetchArgs,
  mirrorMissing,
  missingPublishTags,
  parseVerifiedShaFromLog,
  readParentSha,
  requireMergeSha,
  resolveVerifiedSha,
  selectPushCiRun,
  selectReleaseRun,
  targetsFromManifests,
  waitForRelease,
} from './release-wait.mjs'

const mergeSha = 'a'.repeat(40)
const laterMain = 'b'.repeat(40)
const currentHead = 'c'.repeat(40)
const staleHead = 'd'.repeat(40)
const core = { name: '@narduk-enterprises/narduk-core', version: '2.2.2' }

test('the merge SHA must be a full hex commit', () => {
  assert.equal(requireMergeSha(mergeSha), mergeSha)
  assert.throws(() => requireMergeSha('a'.repeat(7)), /full commit SHA/u)
  assert.throws(() => requireMergeSha(''), /full commit SHA/u)
})

// The 12-libs retro watcher exited on a completed/skipped Release run whose
// `headSha` equalled the merge SHA. For `workflow_run`, that field is main's
// head at trigger time, not verify-ci's VERIFIED_SHA. The skipped run is not
// the release for this merge; keep waiting for the run that actually verified it.
test('a completed/skipped Release run keyed by workflow_run headSha is not the merge SHA release', () => {
  const skipped = {
    id: 1,
    headSha: mergeSha,
    status: 'completed',
    conclusion: 'skipped',
    verifiedSha: null,
  }
  const verified = {
    id: 2,
    headSha: laterMain,
    status: 'completed',
    conclusion: 'success',
    verifiedSha: mergeSha,
  }
  assert.equal(selectReleaseRun({ mergeSha, runs: [skipped] }), null)
  assert.equal(selectReleaseRun({ mergeSha, runs: [skipped, verified] })?.id, 2)
  assert.equal(
    selectReleaseRun({
      mergeSha,
      runs: [{ ...verified, conclusion: 'cancelled', id: 3 }, skipped],
    }),
    null,
  )
})

test('push CI for the merge SHA must be a successful main push, not a PR run', () => {
  const push = {
    id: 11,
    event: 'push',
    headSha: mergeSha,
    headBranch: 'main',
    status: 'completed',
    conclusion: 'success',
  }
  const pr = { ...push, id: 12, event: 'pull_request', headBranch: 'feat' }
  assert.equal(selectPushCiRun({ mergeSha, runs: [pr] }), null)
  assert.equal(selectPushCiRun({ mergeSha, runs: [pr, push] })?.id, 11)
  assert.equal(selectPushCiRun({ mergeSha, runs: [{ ...push, conclusion: 'failure' }] }), null)
})

// Unfiltered `gh run list --branch changeset-release/main --status action_required`
// approved days-old SHAs. Three started and cancelled the current head.
test('held-run approval keeps only action_required runs for the current PR head', () => {
  const stale = Array.from({ length: 10 }, (_, index) => ({
    id: index + 1,
    headSha: staleHead,
    status: 'action_required',
  }))
  const runs = [
    ...stale,
    { id: 99, headSha: currentHead, status: 'action_required' },
    { id: 100, headSha: currentHead, status: 'completed' },
  ]
  assert.deepEqual(approveableRunIds({ currentHeadSha: currentHead, runs }), [99])
  assert.deepEqual(
    approveableRunIds({ currentHeadSha: staleHead, runs }),
    stale.map((run) => run.id),
  )
})

test('mirror wait requires versions|has(v) for every bumped version', () => {
  assert.deepEqual(
    mirrorMissing(
      [core, { name: '@narduk-enterprises/narduk-app-tools', version: '0.9.0' }],
      new Map([
        [core.name, { versions: { '2.2.2': {} } }],
        ['@narduk-enterprises/narduk-app-tools', { versions: { '0.8.0': {} } }],
      ]),
    ),
    [{ name: '@narduk-enterprises/narduk-app-tools', version: '0.9.0' }],
  )
  assert.deepEqual(mirrorMissing([core], new Map([[core.name, { versions: { '2.2.2': {} } }]])), [])
  assert.deepEqual(missingPublishTags([`${core.name}@${core.version}`], []), [
    `${core.name}@${core.version}`,
  ])
  assert.deepEqual(
    missingPublishTags([`${core.name}@${core.version}`], [`${core.name}@${core.version}`]),
    [],
  )
})

function clock() {
  let now = 0
  return {
    now: () => now,
    sleep: async (ms) => {
      now += ms
    },
  }
}

test('waitForRelease does not exit on the skipped headSha run and reaches the mirror', async () => {
  const time = clock()
  const approved = []
  const result = await waitForRelease({
    mergeSha,
    intervalMs: 1_000,
    deadlineMs: 20_000,
    ...time,
    readPushCi: async () => [
      {
        id: 11,
        event: 'push',
        headSha: mergeSha,
        headBranch: 'main',
        status: 'completed',
        conclusion: 'success',
      },
    ],
    readReleaseRuns: async () =>
      time.now() < 3_000
        ? [
            {
              id: 1,
              headSha: mergeSha,
              status: 'completed',
              conclusion: 'skipped',
              verifiedSha: null,
            },
          ]
        : [
            {
              id: 2,
              headSha: laterMain,
              status: 'completed',
              conclusion: 'success',
              verifiedSha: mergeSha,
            },
          ],
    readReleasePrHead: async () => currentHead,
    readHeldRuns: async () => [
      { id: 50, headSha: staleHead, status: 'action_required' },
      { id: 51, headSha: currentHead, status: 'action_required' },
    ],
    approveRuns: async (ids) => {
      approved.push(...ids)
    },
    readTargets: async () => [core],
    readTags: async () => (time.now() < 6_000 ? [] : [`${core.name}@${core.version}`]),
    readMirror: async () =>
      new Map([[core.name, { versions: time.now() < 9_000 ? {} : { '2.2.2': {} } }]]),
    log: () => {},
  })
  assert.equal(result.releaseRunId, 2)
  assert.deepEqual(approved, [51])
  assert.deepEqual(result.versions, [`${core.name}@${core.version}`])
})

test('parseVerifiedShaFromLog reads verify-ci output and ignores a job-name 404', () => {
  assert.equal(parseVerifiedShaFromLog(`Verified full CI for ${mergeSha}`), mergeSha)
  assert.equal(parseVerifiedShaFromLog(''), null)
  assert.equal(parseVerifiedShaFromLog('HTTP 404: Not Found'), null)
})

test('verify-ci logs are read by numeric job id and in-progress misses are not cached', () => {
  const cache = new Map()
  const logs = []
  const job = { name: 'verify-ci', id: 107490122766, status: 'in_progress', conclusion: null }
  const readJobLog = (id) => {
    logs.push(id)
    return `Verified full CI for ${mergeSha}`
  }
  assert.equal(resolveVerifiedSha({ runId: 1, jobs: [job], readJobLog, cache }), null)
  assert.equal(cache.size, 0)
  assert.equal(
    resolveVerifiedSha({
      runId: 1,
      jobs: [{ ...job, status: 'completed', conclusion: 'success' }],
      readJobLog,
      cache,
    }),
    mergeSha,
  )
  assert.deepEqual(logs, [107490122766])
  assert.equal(
    resolveVerifiedSha({
      runId: 1,
      jobs: [{ ...job, status: 'completed', conclusion: 'failure' }],
      readJobLog,
      cache,
    }),
    mergeSha,
  )
  assert.equal(
    resolveVerifiedSha({
      runId: 2,
      jobs: [{ ...job, status: 'completed', conclusion: 'failure' }],
      readJobLog,
      cache,
    }),
    null,
  )
  assert.equal(cache.get(2), null)
})

test('a PR head without readable manifests is unread, not a no-op', () => {
  const registry = 'https://npm.pkg.github.com'
  const manifest = (version) =>
    new Map([
      [core.name, { name: core.name, version, publishConfig: { registry }, private: false }],
    ])
  const merge = manifest('2.2.1')
  assert.equal(
    targetsFromManifests({
      parentManifests: merge,
      mergeManifests: merge,
      headSha: currentHead,
      headManifests: null,
    }),
    null,
  )
  assert.deepEqual(
    targetsFromManifests({
      parentManifests: merge,
      mergeManifests: merge,
      headSha: currentHead,
      headManifests: merge,
    }),
    [],
  )
  assert.deepEqual(
    targetsFromManifests({
      parentManifests: manifest('2.2.1'),
      mergeManifests: manifest('2.2.2'),
      headSha: currentHead,
      headManifests: null,
    }),
    [{ name: core.name, version: '2.2.2', previous: '2.2.1' }],
  )
})

test('merge SHA fetch keeps the parent so targets can plan bumps', () => {
  assert.deepEqual(commitFetchArgs(mergeSha), [
    'fetch',
    '--no-tags',
    '--depth=2',
    'origin',
    mergeSha,
  ])
  assert.doesNotMatch(
    readFileSync(new URL('./release-wait.mjs', import.meta.url), 'utf8'),
    /--depth=1/u,
  )
  assert.equal(
    readParentSha(mergeSha, () => ({
      status: 128,
      stdout: '',
      stderr: 'fatal: Needed a single revision',
    })),
    null,
  )
})

function successfulPush() {
  return [
    {
      id: 11,
      event: 'push',
      headSha: mergeSha,
      headBranch: 'main',
      status: 'completed',
      conclusion: 'success',
    },
  ]
}

function verifiedRelease() {
  return [
    {
      id: 2,
      headSha: laterMain,
      status: 'completed',
      conclusion: 'success',
      verifiedSha: mergeSha,
    },
  ]
}

test('held-run approval retries when action_required appears after the first poll', async () => {
  const time = clock()
  const approved = []
  const result = await waitForRelease({
    mergeSha,
    intervalMs: 1_000,
    deadlineMs: 20_000,
    ...time,
    readPushCi: async () => successfulPush(),
    readReleaseRuns: async () => verifiedRelease(),
    readReleasePrHead: async () => currentHead,
    readHeldRuns: async () =>
      time.now() < 2_000 ? [] : [{ id: 51, headSha: currentHead, status: 'action_required' }],
    approveRuns: async (ids) => {
      approved.push(...ids)
    },
    readTargets: async () => [core],
    readTags: async () => (time.now() < 4_000 ? [] : [`${core.name}@${core.version}`]),
    readMirror: async () => new Map([[core.name, { versions: { '2.2.2': {} } }]]),
    log: () => {},
  })
  assert.equal(result.releaseRunId, 2)
  assert.deepEqual(approved, [51])
})

test('a regenerated Version Packages head is approved without re-approving the old one', async () => {
  const laterHead = 'e'.repeat(40)
  const time = clock()
  const approved = []
  const result = await waitForRelease({
    mergeSha,
    intervalMs: 1_000,
    deadlineMs: 20_000,
    ...time,
    readPushCi: async () => successfulPush(),
    readReleaseRuns: async () => verifiedRelease(),
    readReleasePrHead: async () => (time.now() < 2_000 ? currentHead : laterHead),
    readHeldRuns: async () =>
      time.now() < 2_000
        ? [{ id: 51, headSha: currentHead, status: 'action_required' }]
        : [
            { id: 51, headSha: currentHead, status: 'action_required' },
            { id: 52, headSha: laterHead, status: 'action_required' },
          ],
    approveRuns: async (ids) => {
      approved.push(...ids)
    },
    readTargets: async () => [core],
    readTags: async () => (time.now() < 3_000 ? [] : [`${core.name}@${core.version}`]),
    readMirror: async () => new Map([[core.name, { versions: { '2.2.2': {} } }]]),
    log: () => {},
  })
  assert.deepEqual(approved, [51, 52])
  assert.equal(result.releaseRunId, 2)
})

test('unread targets with a PR head keep waiting instead of reporting no publishable bump', async () => {
  const time = clock()
  const result = await waitForRelease({
    mergeSha,
    intervalMs: 1_000,
    deadlineMs: 20_000,
    ...time,
    readPushCi: async () => successfulPush(),
    readReleaseRuns: async () => verifiedRelease(),
    readReleasePrHead: async () => currentHead,
    readHeldRuns: async () => [],
    approveRuns: async () => {},
    readTargets: async () => (time.now() < 2_000 ? null : [core]),
    readTags: async () => [`${core.name}@${core.version}`],
    readMirror: async () => new Map([[core.name, { versions: { '2.2.2': {} } }]]),
    log: () => {},
  })
  assert.deepEqual(result.versions, [`${core.name}@${core.version}`])
  assert.ok(time.now() >= 2_000)
})

test('confirmed empty targets after a readable comparison are a no-op', async () => {
  const result = await waitForRelease({
    mergeSha,
    intervalMs: 1_000,
    deadlineMs: 20_000,
    ...clock(),
    readPushCi: async () => successfulPush(),
    readReleaseRuns: async () => verifiedRelease(),
    readReleasePrHead: async () => currentHead,
    readHeldRuns: async () => [],
    approveRuns: async () => {},
    readTargets: async () => [],
    readTags: async () => [],
    readMirror: async () => new Map(),
    log: () => {},
  })
  assert.deepEqual(result.versions, [])
  assert.equal(result.releaseRunId, 2)
})
