import assert from 'node:assert/strict'
import { test } from 'node:test'
import { verifyReleaseEvidence } from './verify-release-ci.mjs'

function evidence() {
  const sha = 'a'.repeat(40)
  return {
    sha,
    repository: 'example/libs',
    currentMain: sha,
    runs: [
      {
        id: 7,
        run_attempt: 2,
        head_sha: sha,
        head_branch: 'main',
        event: 'push',
        repository: { full_name: 'example/libs' },
        status: 'completed',
        conclusion: 'success',
      },
    ],
    jobs: [
      { name: 'verify', run_id: 7, run_attempt: 2, status: 'completed', conclusion: 'success' },
    ],
  }
}

test('release accepts successful full CI on exact current main and current attempt', () => {
  assert.equal(verifyReleaseEvidence(evidence()), 7)
})

test('a later merge does not invalidate full CI for a retained main ancestor', () => {
  const input = evidence()
  input.currentMain = 'b'.repeat(40)
  input.comparison = {
    status: 'ahead',
    base_commit: { sha: input.sha },
    merge_base_commit: { sha: input.sha },
  }
  assert.equal(verifyReleaseEvidence(input), 7)
  for (const comparison of [
    { ...input.comparison, status: 'diverged' },
    { ...input.comparison, base_commit: { sha: 'c'.repeat(40) } },
    { ...input.comparison, merge_base_commit: { sha: 'c'.repeat(40) } },
  ]) {
    assert.throws(() => verifyReleaseEvidence({ ...input, comparison }))
  }
})

test('release rejects absent, stale, failed, foreign and incomplete evidence', () => {
  const mutations = [
    (e) => {
      e.sha = 'bad'
    },
    (e) => {
      e.currentMain = 'b'.repeat(40)
    },
    (e) => {
      e.runs = []
    },
    (e) => {
      e.runs[0].conclusion = 'failure'
    },
    (e) => {
      e.runs[0].repository.full_name = 'other/libs'
    },
    (e) => {
      e.runs[0].event = 'pull_request'
    },
    (e) => {
      e.runs[0].head_branch = 'feature'
    },
    (e) => {
      e.runs[0].status = 'in_progress'
    },
    (e) => {
      e.jobs = []
    },
    (e) => {
      e.jobs[0].run_attempt = 1
    },
    (e) => {
      e.jobs[0].run_id = 6
    },
    (e) => {
      e.jobs.push({ ...e.jobs[0] })
    },
    (e) => {
      e.jobs[0].conclusion = 'skipped'
    },
    (e) => {
      e.jobs[0].conclusion = 'cancelled'
    },
    (e) => {
      e.runs.push({ ...e.runs[0], id: 8, conclusion: 'failure' })
    },
  ]
  for (const mutate of mutations) {
    const input = evidence()
    mutate(input)
    assert.throws(() => verifyReleaseEvidence(input))
  }
})
