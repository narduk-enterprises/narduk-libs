import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { botEmail, plan, selectRunsToApprove } from './approve-release-pr-ci.mjs'

const repository = 'narduk-enterprises/narduk-libs'
const head = 'a'.repeat(40)

function input() {
  return {
    repository,
    expectedHead: head,
    prNumber: '1352',
    pr: {
      number: 1352,
      state: 'open',
      base: { ref: 'main', repo: { full_name: repository } },
      head: { ref: 'changeset-release/main', sha: head, repo: { full_name: repository } },
    },
    commit: {
      sha: head,
      message: 'chore: release packages',
      author: { email: botEmail },
      committer: { email: botEmail },
    },
    runs: [
      {
        id: 31,
        status: 'completed',
        conclusion: 'action_required',
        event: 'pull_request',
        head_sha: head,
        head_branch: 'changeset-release/main',
        head_repository: { full_name: repository },
        repository: { full_name: repository },
        path: '.github/workflows/ci.yml',
      },
    ],
  }
}

test('the held ci.yml run for this run’s release PR head is the one named', () => {
  assert.deepEqual(selectRunsToApprove(input()), { approve: [31] })
})

test('every way the target could be something else names nothing', () => {
  const mutations = {
    'no recorded head': (i) => {
      i.expectedHead = ''
    },
    'a malformed head': (i) => {
      i.expectedHead = 'main'
    },
    'a closed pull request': (i) => {
      i.pr.state = 'closed'
    },
    'another pull request number': (i) => {
      i.prNumber = '1353'
    },
    'a pull request into another base': (i) => {
      i.pr.base.ref = 'next'
    },
    'another head branch': (i) => {
      i.pr.head.ref = 'feature'
    },
    'a fork head repository': (i) => {
      i.pr.head.repo.full_name = 'fork/narduk-libs'
    },
    'a base in another repository': (i) => {
      i.pr.base.repo.full_name = 'other/narduk-libs'
    },
    'a head the Release job did not push': (i) => {
      i.pr.head.sha = 'b'.repeat(40)
    },
    'a head commit that is not the expected one': (i) => {
      i.commit.sha = 'b'.repeat(40)
    },
    'a human-authored head commit': (i) => {
      i.commit.author.email = 'someone@example.com'
    },
    'a human-committed head commit': (i) => {
      i.commit.committer.email = 'someone@example.com'
    },
    'another commit title': (i) => {
      i.commit.message = 'feat: something'
    },
    'a run for a superseded head': (i) => {
      i.runs[0].head_sha = 'b'.repeat(40)
    },
    'a run on another branch': (i) => {
      i.runs[0].head_branch = 'feature'
    },
    'a run from a fork': (i) => {
      i.runs[0].head_repository.full_name = 'fork/narduk-libs'
    },
    'a run in another repository': (i) => {
      i.runs[0].repository.full_name = 'other/narduk-libs'
    },
    'a run of another workflow': (i) => {
      i.runs[0].path = '.github/workflows/release.yml'
    },
    'a dispatched run': (i) => {
      i.runs[0].event = 'workflow_dispatch'
    },
    'a run that is not held': (i) => {
      i.runs[0].conclusion = 'success'
    },
    'a run still queued': (i) => {
      i.runs[0].status = 'queued'
      i.runs[0].conclusion = null
    },
    'no run': (i) => {
      i.runs = []
    },
  }
  for (const [label, mutate] of Object.entries(mutations)) {
    const value = input()
    mutate(value)
    const result = selectRunsToApprove(value)
    assert.deepEqual(result.approve, [], label)
    assert.ok(result.reason, `${label} says why`)
  }
  assert.equal(selectRunsToApprove({ ...input(), pr: undefined }).approve.length, 0)
  assert.equal(selectRunsToApprove({ ...input(), commit: undefined }).approve.length, 0)
})

test('only the run for the current head is named when superseded heads are still held', () => {
  const value = input()
  const stale = { ...value.runs[0], id: 29, head_sha: 'c'.repeat(40) }
  value.runs.unshift(stale)
  assert.deepEqual(selectRunsToApprove(value), { approve: [31] })
})

test('a held run that has not appeared yet is waited for, within a deadline', async () => {
  const value = input()
  const waits = []
  let reads = 0
  const result = await plan({
    read: async () => {
      reads += 1
      return reads < 3 ? { ...value, runs: [] } : value
    },
    wait: async (ms) => waits.push(ms),
    attempts: 12,
    intervalMs: 5000,
  })
  assert.deepEqual(result, { approve: [31] })
  assert.deepEqual(waits, [5000, 5000])

  reads = 0
  const never = await plan({
    read: async () => {
      reads += 1
      return { ...value, runs: [] }
    },
    wait: async () => {},
    attempts: 4,
  })
  assert.equal(reads, 4)
  assert.deepEqual(never.approve, [])
})

test('a final refusal is not retried', async () => {
  let reads = 0
  const result = await plan({
    read: async () => {
      reads += 1
      return { ...input(), pr: { ...input().pr, state: 'closed' } }
    },
    wait: async () => assert.fail('must not wait'),
  })
  assert.equal(reads, 1)
  assert.match(result.reason, /not open/u)
})

test('an API read that fails surfaces to the caller, which turns it into a warning', async () => {
  await assert.rejects(
    plan({
      read: async () => {
        throw new Error('GitHub API pulls/1352 answered 500')
      },
    }),
    /answered 500/u,
  )
})

// The workflow side of the contract: the key sits in an install-free job that
// checks out nothing, the planning job holds no secret, and neither can fail a
// release.
const workflow = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8')
const job = (name) => {
  const start = workflow.indexOf(`\n  ${name}:\n`)
  assert.notEqual(start, -1, `${name} job exists`)
  const next = workflow.slice(start + 1).search(/\n  (?:#.*\n  )*[a-z][\w-]*:\n/u)
  return next === -1 ? workflow.slice(start) : workflow.slice(start, start + 1 + next)
}

test('the approving job holds the App key, checks out nothing and cannot fail the release', () => {
  const approve = job('approve-release-pr-ci')
  assert.match(approve, /^ {4}environment: npm-release$/mu)
  assert.match(approve, /permissions: \{\}/u)
  assert.match(approve, /continue-on-error: true/u)
  assert.doesNotMatch(approve, /actions\/checkout|actions\/setup-node|pnpm|npm |node /u)
  assert.deepEqual(
    [...new Set([...approve.matchAll(/secrets\.([A-Z_]+)/gu)].map((match) => match[1]))],
    ['LANE_AUTOMATION_APP_KEY'],
  )
  assert.match(
    approve,
    /repositories: narduk-libs\n\s+permission-actions: write\n(?!\s+permission-)/u,
  )
  assert.equal([...approve.matchAll(/^\s+permission-[a-z-]+:/gmu)].length, 1)
  assert.match(approve, /"narduk-enterprises\/narduk-libs "/u)
  assert.match(approve, /::notice title=Release PR CI left to manual approval::/u)
  assert.match(approve, /if: failure\(\)\n\s+run: echo "::warning/u)
  assert.match(approve, /if: needs\.plan-release-pr-approval\.outputs\.runs != ''/u)
  // The only write it makes is the approve call, for a run it re-read.
  assert.equal([...approve.matchAll(/--method POST/gu)].length, 1)
  assert.match(approve, /actions\/runs\/\$\{id\}\/approve/u)
  assert.match(
    approve,
    /changeset-release\/main pull_request action_required \$\{GITHUB_REPOSITORY\}/u,
  )
})

test('the planning job holds no secret, reads only, and cannot fail the release', () => {
  const planning = job('plan-release-pr-approval')
  assert.doesNotMatch(planning, /secrets\.|environment:|create-github-app-token|vars\./u)
  assert.match(planning, /continue-on-error: true/u)
  assert.match(
    planning,
    /permissions:\n\s+actions: read\n\s+contents: read\n\s+pull-requests: read\n/u,
  )
  assert.match(planning, /ref: main/u)
  assert.match(planning, /GH_TOKEN: \$\{\{ github\.token \}\}/u)
  assert.match(planning, /EXPECTED_HEAD: \$\{\{ needs\.release\.outputs\.release-pr-head \}\}/u)
  assert.match(planning, /if: needs\.release\.outputs\.release-pr-head != ''/u)
})

test('the release job records the head it pushed from its own checkout, and never holds the key', () => {
  const release = job('release')
  assert.doesNotMatch(release, /secrets\.LANE_AUTOMATION|environment:|create-github-app-token/u)
  assert.match(release, /git rev-parse HEAD/u)
  assert.match(release, /steps\.changesets\.outputs\.pullRequestNumber != ''/u)
  assert.match(release, /"\$\{branch\}" == 'changeset-release\/main'/u)
})

test('the workflow still never dispatches ci.yml for the release PR', () => {
  assert.doesNotMatch(workflow, /gh workflow run ci\.yml|^  release-pr-ci:$/mu)
  assert.doesNotMatch(workflow, /workflows\/ci\.yml\/dispatches/u)
})
