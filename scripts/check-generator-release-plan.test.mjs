import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { resolveComparisonBase } from './check-generator-release-plan.mjs'

const script = join(dirname(fileURLToPath(import.meta.url)), 'check-generator-release-plan.mjs')
const refs =
  (...present) =>
  (ref) =>
    present.includes(ref)

test('defaults to the remote-tracking base, not the local branch (#619)', () => {
  const resolved = resolveComparisonBase({
    explicit: undefined,
    baseBranch: 'main',
    refExists: refs('refs/heads/main', 'refs/remotes/origin/main'),
  })
  assert.equal(resolved.base, 'origin/main')
  assert.doesNotMatch(resolved.note, /LOCAL/)
})

test('falls back to the local branch only when no remote ref exists, and says so', () => {
  const resolved = resolveComparisonBase({
    explicit: undefined,
    baseBranch: 'main',
    refExists: refs('refs/heads/main'),
  })
  assert.equal(resolved.base, 'main')
  assert.match(resolved.note, /LOCAL branch/)
})

test('an explicit --base wins, and a local one is named as local', () => {
  const remote = resolveComparisonBase({
    explicit: 'origin/main',
    baseBranch: 'main',
    refExists: refs('refs/heads/main', 'refs/remotes/origin/main'),
  })
  assert.equal(remote.base, 'origin/main')
  assert.doesNotMatch(remote.note, /LOCAL/)

  const local = resolveComparisonBase({
    explicit: 'main',
    baseBranch: 'main',
    refExists: refs('refs/heads/main', 'refs/remotes/origin/main'),
  })
  assert.equal(local.base, 'main')
  assert.match(local.note, /LOCAL branch/)
})

test('accepts the bare -- that `pnpm run release-plan:check -- --base <ref>` forwards (#650)', () => {
  const result = spawnSync(process.execPath, [script, '--', '--base', 'refs/does-not-exist'], {
    encoding: 'utf8',
  })
  assert.doesNotMatch(result.stderr, /Unknown argument/)
  assert.match(result.stderr, /Cannot compare HEAD against 'refs\/does-not-exist'/)
})
