import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { decideRelease, verifyReleaseEvidence, verifyTreeEvidence } from './verify-release-ci.mjs'

test('a detached release checkout gives Changesets its verified local base', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/release.yml', import.meta.url),
    'utf8',
  )
  const step = workflow
    .split('      - name: Require the exact verified SHA retained in main\n')[1]
    .split('      - name: Set up pnpm\n')[0]
  const script = step
    .split('        run: |\n')[1]
    .split('\n')
    .map((line) => line.replace(/^          /u, ''))
    .join('\n')
  const root = mkdtempSync(join(tmpdir(), 'narduk-release-base-'))
  const source = join(root, 'source')
  const checkout = join(root, 'checkout')
  const git = (cwd, ...args) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  try {
    mkdirSync(source)
    git(source, 'init', '--quiet', '--initial-branch=main')
    git(source, 'config', 'user.name', 'Release fixture')
    git(source, 'config', 'user.email', 'release@example.invalid')
    git(source, 'commit', '--quiet', '--allow-empty', '-m', 'Verified commit')
    const verified = git(source, 'rev-parse', 'HEAD')
    git(source, 'commit', '--quiet', '--allow-empty', '-m', 'Later main commit')
    const latest = git(source, 'rev-parse', 'HEAD')
    mkdirSync(checkout)
    git(checkout, 'init', '--quiet', '--initial-branch=fixture')
    git(checkout, 'remote', 'add', 'origin', source)
    git(checkout, 'fetch', '--quiet', 'origin', verified)
    git(checkout, 'checkout', '--quiet', '--detach', 'FETCH_HEAD')
    // actions/checkout fetch-depth: 0 provides all remote branches before
    // persist-credentials: false removes the token from later git commands.
    git(checkout, 'fetch', '--quiet', 'origin', '+refs/heads/main:refs/remotes/origin/main')
    assert.equal(
      spawnSync('git', ['show-ref', '--verify', '--quiet', 'refs/heads/main'], { cwd: checkout })
        .status,
      1,
    )
    execFileSync('bash', ['-c', script], {
      cwd: checkout,
      env: { ...process.env, VERIFIED_SHA: verified },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    assert.equal(git(checkout, 'rev-parse', 'HEAD'), verified)
    assert.equal(git(checkout, 'rev-parse', 'main'), verified)
    assert.equal(git(checkout, 'rev-parse', 'origin/main'), latest)
    assert.equal(git(checkout, 'merge-base', 'HEAD', 'main'), verified)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

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

// The tree rule (narduk-libs#1354): the release PR's own full CI run stands in
// for the push run when the merged tree is the PR head's tree.
const repository = 'example/libs'
const headSha = 'c'.repeat(40)
const parentSha = 'd'.repeat(40)
const treeSha = 'e'.repeat(40)
const fullJobs = [
  'affected packages',
  'contracts',
  'ci / Required',
  'ci / package / narduk-core',
  'package / packed-consumer-smoke',
  'package / browser tests',
  'verify',
].map((name) => ({
  name,
  run_id: 21,
  run_attempt: 1,
  status: 'completed',
  conclusion: 'success',
}))

function treeEvidence() {
  const sha = 'a'.repeat(40)
  return {
    sha,
    repository,
    currentMain: sha,
    pulls: [
      {
        number: 1350,
        merge_commit_sha: sha,
        merged_at: '2026-10-02T18:33:49Z',
        base: { ref: 'main', repo: { full_name: repository } },
        head: { ref: 'changeset-release/main', sha: headSha, repo: { full_name: repository } },
      },
    ],
    mainCommit: { sha, tree: { sha: treeSha }, parents: [{ sha: parentSha }] },
    headCommit: { sha: headSha, tree: { sha: treeSha }, parents: [{ sha: parentSha }] },
    runs: [
      {
        id: 21,
        run_attempt: 1,
        head_sha: headSha,
        head_branch: 'changeset-release/main',
        head_repository: { full_name: repository },
        repository: { full_name: repository },
        path: '.github/workflows/ci.yml',
        event: 'pull_request',
        status: 'completed',
        conclusion: 'success',
      },
    ],
    jobs: fullJobs.map((job) => ({ ...job })),
  }
}

test('the tree rule accepts a full pull request run on an identical tree and names it', () => {
  assert.deepEqual(verifyTreeEvidence(treeEvidence()), {
    runId: 21,
    pr: 1350,
    headSha,
    tree: treeSha,
  })
})

test('the tree rule still requires the release SHA to be retained in main', () => {
  const input = treeEvidence()
  input.currentMain = 'b'.repeat(40)
  assert.throws(() => verifyTreeEvidence(input), /retained in main/u)
  input.comparison = {
    status: 'ahead',
    base_commit: { sha: input.sha },
    merge_base_commit: { sha: input.sha },
  }
  assert.equal(verifyTreeEvidence(input).runId, 21)
})

test('the tree rule rejects every way the proof could be about something else', () => {
  const mutations = {
    'a tree that differs by one character': (e) => {
      e.headCommit.tree.sha = `${treeSha.slice(0, 39)}f`
    },
    'a head commit that is not the PR head': (e) => {
      e.headCommit.sha = 'f'.repeat(40)
    },
    'main moved between the head and the merge': (e) => {
      e.mainCommit.parents = [{ sha: 'f'.repeat(40) }]
    },
    'a merge commit with two parents': (e) => {
      e.mainCommit.parents.push({ sha: 'f'.repeat(40) })
    },
    'no associated pull request': (e) => {
      e.pulls = []
    },
    'a pull request merged into a different commit': (e) => {
      e.pulls[0].merge_commit_sha = 'f'.repeat(40)
    },
    'a pull request that never merged': (e) => {
      e.pulls[0].merged_at = null
    },
    'two merged release pull requests': (e) => {
      e.pulls.push({ ...e.pulls[0], number: 1351 })
    },
    'another head branch': (e) => {
      e.pulls[0].head.ref = 'feature'
    },
    'a fork head repository': (e) => {
      e.pulls[0].head.repo.full_name = 'fork/libs'
    },
    'a pull request into another base': (e) => {
      e.pulls[0].base.ref = 'next'
    },
    'a run for another head commit': (e) => {
      e.runs[0].head_sha = 'f'.repeat(40)
    },
    'a run on another branch': (e) => {
      e.runs[0].head_branch = 'feature'
    },
    'a run from a fork': (e) => {
      e.runs[0].head_repository.full_name = 'fork/libs'
    },
    'a run in another repository': (e) => {
      e.runs[0].repository.full_name = 'fork/libs'
    },
    'a run of another workflow': (e) => {
      e.runs[0].path = '.github/workflows/other.yml'
    },
    'a run on a push event': (e) => {
      e.runs[0].event = 'push'
    },
    'a cancelled run': (e) => {
      e.runs[0].conclusion = 'cancelled'
    },
    'a run still in progress': (e) => {
      e.runs[0].status = 'in_progress'
      e.runs[0].conclusion = null
    },
    'a held run': (e) => {
      e.runs[0].conclusion = 'action_required'
    },
    'no run': (e) => {
      e.runs = []
    },
    'jobs from another attempt': (e) => {
      for (const job of e.jobs) job.run_attempt = 2
    },
    'jobs from another run': (e) => {
      for (const job of e.jobs) job.run_id = 20
    },
  }
  for (const [label, mutate] of Object.entries(mutations)) {
    const input = treeEvidence()
    mutate(input)
    assert.throws(() => verifyTreeEvidence(input), undefined, label)
  }
})

test('the tree rule tells a full run from a path-filtered one by its jobs', () => {
  for (const name of [
    'affected packages',
    'contracts',
    'ci / Required',
    'package / packed-consumer-smoke',
    'package / browser tests',
    'verify',
  ]) {
    for (const conclusion of ['skipped', 'failure', 'cancelled']) {
      const input = treeEvidence()
      input.jobs.find((job) => job.name === name).conclusion = conclusion
      assert.throws(() => verifyTreeEvidence(input), /not a full run/u, `${name} ${conclusion}`)
    }
    const missing = treeEvidence()
    missing.jobs = missing.jobs.filter((job) => job.name !== name)
    assert.throws(() => verifyTreeEvidence(missing), /not a full run/u, `${name} absent`)
  }
  const noPackages = treeEvidence()
  noPackages.jobs = noPackages.jobs.filter((job) => !job.name.startsWith('ci / package / '))
  assert.throws(() => verifyTreeEvidence(noPackages), /no package job/u)
  const duplicated = treeEvidence()
  duplicated.jobs.push({ ...duplicated.jobs.find((job) => job.name === 'verify') })
  assert.throws(() => verifyTreeEvidence(duplicated), /not a full run/u)
  const failedExtra = treeEvidence()
  failedExtra.jobs.push({ ...failedExtra.jobs[0], name: 'ci / package / x', conclusion: 'failure' })
  assert.throws(() => verifyTreeEvidence(failedExtra), /neither succeeded nor was skipped/u)
  const skippedExtra = treeEvidence()
  skippedExtra.jobs.push({
    ...skippedExtra.jobs[0],
    name: 'stop CI after contracts failure',
    conclusion: 'skipped',
  })
  assert.equal(verifyTreeEvidence(skippedExtra).runId, 21)
})

// A mocked `gh api`, routed by path the way the real reads are made.
function routedApi(treeInput, { pushRuns = [], pushJobs = [], failing = [], calls = [] } = {}) {
  return (path) => {
    calls.push(path)
    if (failing.some((fragment) => path.includes(fragment)))
      throw new Error('Unable to read CI evidence (1)')
    if (path.endsWith('/git/ref/heads/main')) return { object: { sha: treeInput.currentMain } }
    if (path.includes('/compare/')) return treeInput.comparison
    if (path.includes('/actions/workflows/ci.yml/runs?event=push'))
      return { workflow_runs: pushRuns }
    if (path.includes('/actions/workflows/ci.yml/runs?event=pull_request'))
      return { workflow_runs: treeInput.runs }
    if (path.includes('/attempts/')) {
      return { jobs: path.includes('/runs/7/') ? pushJobs : treeInput.jobs }
    }
    if (path.includes(`/commits/${treeInput.sha}/pulls`)) return treeInput.pulls
    if (path.endsWith(`/git/commits/${treeInput.sha}`)) return treeInput.mainCommit
    if (path.endsWith(`/git/commits/${headSha}`)) return treeInput.headCommit
    throw new Error(`unexpected read ${path}`)
  }
}

test('an early run proves by the tree rule alone and never reads the push verdict', () => {
  const input = treeEvidence()
  const calls = []
  const result = decideRelease({
    early: true,
    api: routedApi(input, { calls }),
    repository,
    sha: input.sha,
  })
  assert.equal(result.verified, true)
  assert.equal(result.rule, 'tree')
  assert.equal(result.mainTree, treeSha)
  // It lists the push runs to see whether any has reported, but never reads one's jobs.
  assert.equal(
    calls.some((path) => path.includes('/attempts/') && path.includes('/runs/7/')),
    false,
  )
})

test('an early run defers when the push run has already reported, green or red', () => {
  const input = treeEvidence()
  for (const conclusion of ['success', 'failure']) {
    const push = pushRunFor(input, { run_attempt: 1, conclusion })
    const result = decideRelease({
      early: true,
      api: routedApi(input, { pushRuns: push.runs, pushJobs: push.jobs }),
      repository,
      sha: input.sha,
    })
    assert.equal(result.verified, false, conclusion)
    assert.match(result.reason, /already reported/u)
  }
})

test('an early run that cannot prove by tree is not a failure and does not publish', () => {
  const input = treeEvidence()
  input.headCommit.tree.sha = `${treeSha.slice(0, 39)}f`
  const result = decideRelease({
    early: true,
    api: routedApi(input),
    repository,
    sha: input.sha,
  })
  assert.equal(result.verified, false)
  assert.match(result.reason, /tree does not match/u)
})

test('an API read that fails during an early run falls back instead of throwing', () => {
  const input = treeEvidence()
  for (const failing of [
    '/commits/',
    '/git/commits/',
    'event=pull_request',
    'event=push',
    '/attempts/',
  ]) {
    const result = decideRelease({
      early: true,
      api: routedApi(input, { failing: [failing] }),
      repository,
      sha: input.sha,
    })
    assert.equal(result.verified, false, failing)
  }
})

test('a completed push run keeps the old rule and never reads the tree evidence', () => {
  const input = treeEvidence()
  const push = evidence()
  push.runs[0].head_sha = input.sha
  const calls = []
  const result = decideRelease({
    early: false,
    api: routedApi(input, { pushRuns: push.runs, pushJobs: push.jobs, calls }),
    repository,
    sha: input.sha,
  })
  assert.deepEqual(result, { verified: true, rule: 'push', runId: 7 })
  assert.equal(
    calls.some((path) => path.includes('/pulls')),
    false,
  )
})

// The push run for `input.sha`, as the push-runs read returns it, altered by `patch`.
function pushRunFor(input, patch) {
  const push = evidence()
  Object.assign(push.runs[0], { head_sha: input.sha, ...patch })
  return push
}

function decideStandard(input, push, extra = {}) {
  return decideRelease({
    early: false,
    api: routedApi(input, { pushRuns: push.runs, pushJobs: push.jobs, ...extra }),
    repository,
    sha: input.sha,
  })
}

test('a push run still in progress leaves the tree rule able to prove a dispatched release', () => {
  const input = treeEvidence()
  const push = pushRunFor(input, { status: 'in_progress', conclusion: null, run_attempt: 1 })
  push.jobs = []
  const result = decideStandard(input, push)
  assert.equal(result.verified, true)
  assert.equal(result.rule, 'tree')
  assert.equal(result.runId, 21)
})

test('no push run at all leaves the tree rule able to prove', () => {
  const input = treeEvidence()
  const result = decideStandard(input, { runs: [], jobs: [] })
  assert.equal(result.rule, 'tree')
})

test('a red push run refuses the release even when the tree rule would hold', () => {
  const input = treeEvidence()
  const calls = []
  for (const conclusion of ['failure', 'cancelled', 'timed_out', 'action_required']) {
    const push = pushRunFor(input, { run_attempt: 1, conclusion })
    assert.throws(
      () => decideStandard(input, push, { calls }),
      /latest main CI run for this exact SHA must have succeeded/u,
      conclusion,
    )
  }
  // The refusal does not depend on reading the tree evidence at all.
  assert.equal(
    calls.some((path) => path.includes('/pulls')),
    false,
  )
})

test('a completed push run without a successful verify aggregate refuses too', () => {
  const input = treeEvidence()
  const push = pushRunFor(input, { run_attempt: 1 })
  push.jobs = []
  assert.throws(() => decideStandard(input, push), /one successful full verify aggregate/u)
})

test('a push run re-run after an earlier attempt is not overruled by the tree rule', () => {
  const input = treeEvidence()
  const push = pushRunFor(input, { run_attempt: 2, status: 'in_progress', conclusion: null })
  push.jobs = []
  assert.throws(() => decideStandard(input, push), /must have succeeded/u)
})

test('a failed read of the push runs refuses instead of falling back to the tree rule', () => {
  const input = treeEvidence()
  assert.throws(
    () =>
      decideRelease({
        early: false,
        api: routedApi(input, { failing: ['event=push'] }),
        repository,
        sha: input.sha,
      }),
    /Unable to read CI evidence/u,
  )
})

test('with no push run to overrule it, a tree that does not match leaves the push error standing', () => {
  const input = treeEvidence()
  input.headCommit.tree.sha = `${treeSha.slice(0, 39)}f`
  assert.throws(
    () => decideStandard(input, { runs: [], jobs: [] }),
    /latest main CI run for this exact SHA must have succeeded/u,
  )
})
