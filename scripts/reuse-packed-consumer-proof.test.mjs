import assert from 'node:assert/strict'
import test from 'node:test'

import { findReusablePackedConsumerProof } from './reuse-packed-consumer-proof.mjs'

const repository = 'narduk-enterprises/narduk-libs'
const mergeSha = 'a'.repeat(40)
const headSha = 'b'.repeat(40)
const treeSha = 'c'.repeat(40)

function responseMap({
  sourceTree = treeSha,
  checkConclusion = 'success',
  headRepository = repository,
} = {}) {
  return new Map([
    [
      `/repos/${repository}/commits/${mergeSha}/pulls`,
      [
        {
          number: 79,
          merged_at: '2026-08-26T14:32:37Z',
          merge_commit_sha: mergeSha,
          base: { ref: 'main' },
          head: { sha: headSha, repo: { full_name: headRepository } },
        },
      ],
    ],
    [`/repos/${repository}/git/commits/${mergeSha}`, { tree: { sha: treeSha } }],
    [`/repos/${repository}/git/commits/${headSha}`, { tree: { sha: sourceTree } }],
    [
      `/repos/${repository}/commits/${headSha}/check-runs?check_name=package%20%2F%20packed-consumer-smoke&per_page=100`,
      {
        check_runs: [
          {
            name: 'package / packed-consumer-smoke',
            status: 'completed',
            conclusion: checkConclusion,
            app: { slug: 'github-actions' },
            details_url: `https://github.com/${repository}/actions/runs/123`,
          },
        ],
      },
    ],
  ])
}

function requester(responses) {
  return async (path) => {
    assert.ok(responses.has(path), `unexpected request: ${path}`)
    return responses.get(path)
  }
}

test('reuses a successful packed proof only for the identical merged tree', async () => {
  const result = await findReusablePackedConsumerProof({
    repository,
    sha: mergeSha,
    requestJson: requester(responseMap()),
  })

  assert.deepEqual(result, {
    reused: true,
    pullRequest: 79,
    sourceSha: headSha,
    treeSha,
    reason:
      'the merged pull-request head has the identical Git tree and a successful packed consumer check',
  })
})

test('falls back to an exact-SHA smoke when the merge tree differs', async () => {
  const result = await findReusablePackedConsumerProof({
    repository,
    sha: mergeSha,
    requestJson: requester(responseMap({ sourceTree: 'd'.repeat(40) })),
  })

  assert.equal(result.reused, false)
  assert.match(result.reason, /identical Git tree/u)
})

test('falls back when the prior packed consumer check failed', async () => {
  const result = await findReusablePackedConsumerProof({
    repository,
    sha: mergeSha,
    requestJson: requester(responseMap({ checkConclusion: 'failure' })),
  })

  assert.equal(result.reused, false)
})

test('never reuses proof from a fork or another repository', async () => {
  const responses = responseMap({ headRepository: 'other/repository' })
  const result = await findReusablePackedConsumerProof({
    repository,
    sha: mergeSha,
    requestJson: requester(responses),
  })

  assert.equal(result.reused, false)
  assert.match(result.reason, /same-repository/u)
})
