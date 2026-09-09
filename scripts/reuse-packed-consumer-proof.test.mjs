import assert from 'node:assert/strict'
import test from 'node:test'
import {
  fingerprintInputs,
  findReusablePackedConsumerProof,
  lookupConsumerProof,
  matchesProof,
} from './reuse-packed-consumer-proof.mjs'

const repository = 'narduk-enterprises/narduk-libs'
const sha = 'a'.repeat(40)
const head = 'b'.repeat(40)
const tree = 'c'.repeat(40)
const fingerprint = 'd'.repeat(64)
const now = Date.parse('2026-09-09T18:00:00Z')
const proof = {
  schemaVersion: 1,
  kind: 'executed',
  repository,
  runId: 123,
  runAttempt: 2,
  tree,
  fingerprint,
  completedAt: '2026-09-09T17:00:00Z',
}
const run = {
  id: 123,
  run_attempt: 2,
  head_sha: head,
  event: 'pull_request',
  path: '.github/workflows/ci.yml',
  head_repository: { full_name: repository },
  status: 'completed',
  conclusion: 'success',
}

function fixture() {
  return {
    pulls: [
      {
        number: 80,
        merged_at: 'today',
        merge_commit_sha: sha,
        base: { ref: 'main', repo: { full_name: repository } },
        head: { sha: head, repo: { full_name: repository } },
      },
    ],
    runs: [{ ...run }],
    jobs: [
      {
        name: 'package / packed-consumer-smoke',
        status: 'completed',
        conclusion: 'success',
        run_attempt: 2,
      },
    ],
    artifacts: [
      {
        id: 17,
        name: 'packed-consumer-proof-2',
        expired: false,
        size_in_bytes: 500,
        workflow_run: { id: 123, head_sha: head },
      },
    ],
    proof: { ...proof },
  }
}

async function lookup(data) {
  return findReusablePackedConsumerProof({
    repository,
    sha,
    tree,
    fingerprint,
    now,
    requestJson: async (path) => {
      if (path === `/repos/${repository}/commits/${sha}/pulls`) return data.pulls
      if (
        path ===
        `/repos/${repository}/actions/workflows/ci.yml/runs?event=pull_request&head_sha=${head}&per_page=10`
      )
        return { workflow_runs: data.runs }
      if (path === `/repos/${repository}/actions/runs/123/attempts/2/jobs?per_page=100`)
        return { jobs: data.jobs }
      if (path === `/repos/${repository}/actions/runs/123/artifacts?per_page=100`)
        return { artifacts: data.artifacts }
      throw new Error(`Unexpected lookup ${path}`)
    },
    readArtifact: async (id) => {
      assert.equal(id, 17)
      return data.proof
    },
  })
}

test('only the successful merged PR run and exact installed inputs can satisfy the proof', async () => {
  assert.deepEqual(await lookup(fixture()), {
    runId: 123,
    runAttempt: 2,
    pullRequest: 80,
    fingerprint,
  })
  for (const mutate of [
    (data) => {
      data.pulls[0].head.repo.full_name = 'someone/fork'
    },
    (data) => {
      data.pulls[0].base.ref = 'other'
    },
    (data) => {
      data.pulls[0].merge_commit_sha = head
    },
    (data) => {
      data.pulls[0].merged_at = null
    },
    (data) => {
      data.runs[0].conclusion = 'failure'
    },
    (data) => {
      data.runs[0].status = 'in_progress'
    },
    (data) => {
      data.runs[0].event = 'workflow_dispatch'
    },
    (data) => {
      data.runs[0].head_repository = { full_name: 'someone/fork' }
    },
    (data) => {
      data.runs[0].path = '.github/workflows/unrelated.yml'
    },
    (data) => {
      data.runs.push({ ...run, id: 124, conclusion: 'cancelled' })
    },
    (data) => {
      data.jobs[0].conclusion = 'failure'
    },
    (data) => {
      data.jobs[0].run_attempt = 1
    },
    (data) => {
      data.jobs.push({ ...data.jobs[0] })
    },
    (data) => {
      data.jobs = []
    },
    (data) => {
      data.artifacts[0].expired = true
    },
    (data) => {
      data.artifacts[0].name = 'packed-consumer-proof-1'
    },
    (data) => {
      data.artifacts[0].workflow_run.head_sha = sha
    },
    (data) => {
      data.artifacts[0].workflow_run.id = 124
    },
    (data) => {
      data.artifacts[0].size_in_bytes = 100000
    },
    (data) => {
      data.artifacts.push({ ...data.artifacts[0] })
    },
    (data) => {
      data.proof.fingerprint = 'e'.repeat(64)
    },
    (data) => {
      data.proof.kind = 'reused'
    },
  ]) {
    const data = fixture()
    mutate(data)
    assert.equal(await lookup(data), undefined, String(mutate))
  }
})

test('receipts reject wrong origin, attempt, tree, age and malformed digests', () => {
  const options = { repository, run, tree, fingerprint, now }
  assert.equal(matchesProof(proof, options), true)
  for (const changes of [
    { schemaVersion: 2 },
    { repository: 'someone/fork' },
    { runId: 122 },
    { runAttempt: 1 },
    { tree: head },
    { fingerprint: 'different' },
    { completedAt: '2026-08-01T17:00:00Z' },
    { completedAt: 'tomorrow' },
    { completedAt: '2026-09-10T17:00:00Z' },
  ])
    assert.equal(matchesProof({ ...proof, ...changes }, options), false)
})

test('fingerprints are stable but change with package bytes, consumer resolution, gates and toolchain', () => {
  const inputs = {
    tree,
    tarballs: { one: 'bytes' },
    consumerLock: 'lock',
    generatedSources: { 'package.json': 'scripts' },
    node: { version: '22.22.3' },
    pnpm: '10.33.4',
    imageIdentity: { manifest: 'browser', systemPackages: 'libraries' },
  }
  assert.equal(
    fingerprintInputs(inputs),
    fingerprintInputs(Object.fromEntries(Object.entries(inputs).reverse())),
  )
  for (const key of Object.keys(inputs))
    assert.notEqual(
      fingerprintInputs(inputs),
      fingerprintInputs({ ...inputs, [key]: 'changed' }),
      key,
    )
})

test('local, PR, dispatch and non-main runs cannot reuse a proof', async () => {
  for (const environment of [
    {},
    { GITHUB_EVENT_NAME: 'pull_request' },
    { GITHUB_EVENT_NAME: 'workflow_dispatch' },
    { GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/feature' },
  ])
    assert.equal(await lookupConsumerProof({}, environment), undefined)
})
