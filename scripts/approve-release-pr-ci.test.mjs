import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

// The approve step is bash in YAML, and the job it lives in checks out no code,
// so the decision cannot be a function this file imports. Instead the step's own
// script is extracted and run against a stub `gh` that serves canned reads and
// records every call. A test that only matched the script's text passed with
// the `continue` after the warning deleted (verify of #1359); this one cannot.
function approveStepScript() {
  const step = job('approve-release-pr-ci')
    .split('      - name: Approve the held CI run for the release PR head\n')[1]
    .split('      - name: Report a failed approval')[0]
  assert.ok(step, 'approve step found')
  return step
    .split('        run: |\n')[1]
    .split('\n')
    .map((line) => line.replace(/^ {10}/u, ''))
    .join('\n')
}

const heldRun = (overrides = {}) => ({
  head_sha: head,
  head_branch: 'changeset-release/main',
  event: 'pull_request',
  conclusion: 'action_required',
  head_repository: { full_name: repository },
  ...overrides,
})
const openPull = (overrides = {}) => ({
  state: 'open',
  head: { sha: head, ref: 'changeset-release/main' },
  ...overrides,
})

// `reads` maps a stub file name to its JSON; a name left out makes that read fail.
function runApproveStep({ runIds = '31', reads }) {
  const dir = mkdtempSync(join(tmpdir(), 'narduk-approve-step-'))
  try {
    for (const [name, value] of Object.entries(reads))
      writeFileSync(join(dir, name), JSON.stringify(value))
    const log = join(dir, 'calls.log')
    writeFileSync(log, '')
    // Serves `gh api <path> [--jq <expr>]` from $STUB_DIR the way gh does (the
    // expression is applied with jq) and logs every call.
    writeFileSync(
      join(dir, 'gh'),
      `#!/usr/bin/env bash
set -euo pipefail
echo "$*" >> "$STUB_DIR/calls.log"
method=GET; path=; expr=.
args=("$@"); i=1
while [ $i -lt ${'$'}{#args[@]} ]; do
  case "${'$'}{args[$i]}" in
    --method) method="${'$'}{args[$((i+1))]}"; i=$((i+2)) ;;
    --jq) expr="${'$'}{args[$((i+1))]}"; i=$((i+2)) ;;
    *) path="${'$'}{args[$i]}"; i=$((i+1)) ;;
  esac
done
if [ "$method" = POST ]; then exit 0; fi
case "$path" in
  */pulls/*) file=pull.json ;;
  */actions/runs/*) file="run-${'$'}{path##*/}.json" ;;
  *) exit 1 ;;
esac
[ -f "$STUB_DIR/$file" ] || { echo "stub: no $file" >&2; exit 1; }
jq -r "$expr" "$STUB_DIR/$file"
`,
    )
    chmodSync(join(dir, 'gh'), 0o755)
    const result = spawnSync('bash', ['-c', approveStepScript()], {
      encoding: 'utf8',
      env: {
        PATH: `${dir}:${process.env.PATH}`,
        STUB_DIR: dir,
        GITHUB_REPOSITORY: repository,
        RUN_IDS: runIds,
        RELEASE_PR_HEAD: head,
        RELEASE_PR_NUMBER: '1352',
      },
    })
    const calls = readFileSync(log, 'utf8').split('\n').filter(Boolean)
    return { ...result, calls, posts: calls.filter((call) => call.includes('--method POST')) }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('the approve step approves a run that is still held for the planned open head', () => {
  const result = runApproveStep({
    reads: { 'run-31.json': heldRun(), 'pull.json': openPull() },
  })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(result.posts, [`api --method POST repos/${repository}/actions/runs/31/approve`])
  assert.match(result.stdout, /::notice title=Release PR CI started::approved held ci\.yml run 31/u)
})

test('the approve step skips, with a warning and no POST, every run that fails its re-read', () => {
  const stale = {
    'a run that is no longer held': { 'run-31.json': heldRun({ conclusion: 'success' }) },
    'a run for another head': { 'run-31.json': heldRun({ head_sha: 'b'.repeat(40) }) },
    'a run for another branch': { 'run-31.json': heldRun({ head_branch: 'feature' }) },
    'a run from another event': { 'run-31.json': heldRun({ event: 'push' }) },
    'a run from a fork': {
      'run-31.json': heldRun({ head_repository: { full_name: 'fork/narduk-libs' } }),
    },
  }
  for (const [label, run] of Object.entries(stale)) {
    const result = runApproveStep({ reads: { 'pull.json': openPull(), ...run } })
    assert.equal(result.status, 0, `${label}: ${result.stderr}`)
    assert.deepEqual(result.posts, [], label)
    assert.match(result.stdout, /::warning title=Release PR CI left to manual approval::/u, label)
  }
})

test('the approve step skips a run whose pull request head moved or closed since the plan', () => {
  const moved = {
    'a head that moved on': openPull({
      head: { sha: 'b'.repeat(40), ref: 'changeset-release/main' },
    }),
    'a pull request that closed': openPull({ state: 'closed' }),
    'a head branch that changed': openPull({ head: { sha: head, ref: 'feature' } }),
  }
  for (const [label, pull] of Object.entries(moved)) {
    const result = runApproveStep({ reads: { 'run-31.json': heldRun(), 'pull.json': pull } })
    assert.equal(result.status, 0, `${label}: ${result.stderr}`)
    assert.deepEqual(result.posts, [], label)
    assert.match(result.stdout, /is no longer open at/u, label)
  }
})

test('the approve step fails closed when a re-read fails, and skips one run without ending the loop', () => {
  const noPull = runApproveStep({ reads: { 'run-31.json': heldRun() } })
  assert.notEqual(noPull.status, 0)
  assert.deepEqual(noPull.posts, [])
  const noRun = runApproveStep({ reads: { 'pull.json': openPull() } })
  assert.notEqual(noRun.status, 0)
  assert.deepEqual(noRun.posts, [])
  // Run 31 is stale and run 32 is held: only 32 is approved, so a skipped run
  // must `continue` to the next one rather than fall through to the POST.
  const mixed = runApproveStep({
    runIds: '31 32',
    reads: {
      'run-31.json': heldRun({ conclusion: 'cancelled' }),
      'run-32.json': heldRun(),
      'pull.json': openPull(),
    },
  })
  assert.equal(mixed.status, 0, mixed.stderr)
  assert.deepEqual(mixed.posts, [`api --method POST repos/${repository}/actions/runs/32/approve`])
})

test('the plan job hands the approve job the pull request number it validated', () => {
  assert.match(job('plan-release-pr-approval'), /pr: \$\{\{ steps\.plan\.outputs\.pr \}\}/u)
  assert.match(
    job('approve-release-pr-ci'),
    /RELEASE_PR_NUMBER: \$\{\{ needs\.plan-release-pr-approval\.outputs\.pr \}\}/u,
  )
})
