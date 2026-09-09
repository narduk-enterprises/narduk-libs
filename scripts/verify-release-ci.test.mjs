import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { verifyReleaseEvidence } from './verify-release-ci.mjs'

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
