import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { ignoredWorktreeWarning } from './release-plan-worktree.mjs'

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'release-plan-worktree-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' })
  git('init', '-q', '-b', 'main')
  writeFileSync(join(root, 'tracked.txt'), 'committed\n')
  git('add', 'tracked.txt')
  git(
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.invalid',
    '-c',
    'commit.gpgSign=false',
    'commit',
    '-qm',
    'fixture',
  )
  return { root, git }
}

test('a clean committed working tree needs no warning', (t) => {
  const { root } = fixture(t)
  assert.equal(ignoredWorktreeWarning(root), undefined)
})

for (const state of ['staged', 'unstaged', 'untracked']) {
  test(`${state} work is explicitly excluded, without printing paths or changing files`, (t) => {
    const { root, git } = fixture(t)
    const file = state === 'untracked' ? 'private-name-marker.txt' : 'tracked.txt'
    writeFileSync(join(root, file), 'local change\n')
    if (state === 'staged') git('add', file)
    const before = git('status', '--porcelain=v1', '-z')
    const warning = ignoredWorktreeWarning(root)
    assert.match(warning, /compares committed "HEAD"/)
    assert.match(warning, /uncommitted or untracked.*excluded/)
    assert.match(warning, /Commit your changes and rerun/)
    assert.doesNotMatch(warning, /private-name-marker|tracked\.txt/)
    assert.equal(git('status', '--porcelain=v1', '-z'), before)
  })
}

test('the warning names an explicitly selected head', (t) => {
  const { root } = fixture(t)
  writeFileSync(join(root, 'untracked.txt'), 'local\n')
  assert.match(ignoredWorktreeWarning(root, 'main'), /compares committed "main"/)
})

test('an unreadable status reports unknown coverage, never a clean working tree', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'release-plan-no-git-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  assert.match(
    ignoredWorktreeWarning(root),
    /could not inspect.*coverage of local changes is unknown/,
  )
})
