import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { refreshComparisonBase } from './git-base-refresh.mjs'
import { plannedComparisonBase } from './preflight.mjs'

test('refreshes the exact stale tracking branch from a disposable bare origin', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'release-base-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const origin = join(root, 'origin.git')
  const seed = join(root, 'seed')
  const checkout = join(root, 'checkout')
  const git = (cwd, ...args) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  git(root, 'init', '--bare', '--initial-branch=main', origin)
  git(root, 'clone', origin, seed)
  git(seed, 'config', 'user.name', 'Fixture')
  git(seed, 'config', 'user.email', 'fixture@example.invalid')
  writeFileSync(join(seed, 'file.txt'), 'initial\n')
  git(seed, 'add', '.')
  git(seed, 'commit', '-m', 'initial')
  git(seed, 'push', 'origin', 'main')
  git(root, 'clone', origin, checkout)
  const old = git(checkout, 'rev-parse', 'origin/main')
  const planned = plannedComparisonBase(checkout, 'origin/main')
  assert.equal(planned, old)
  writeFileSync(join(seed, 'file.txt'), 'advanced remote\n')
  git(seed, 'commit', '-am', 'advance')
  git(seed, 'push', 'origin', 'main')
  const current = git(seed, 'rev-parse', 'HEAD')
  assert.notEqual(old, current)
  assert.equal(git(checkout, 'rev-parse', 'origin/main'), old)
  assert.match(refreshComparisonBase(checkout, 'origin/main'), /Refreshed/)
  assert.equal(git(checkout, 'rev-parse', 'origin/main'), current)
  assert.equal(git(checkout, 'rev-parse', 'HEAD'), old, 'the checkout must not move')
  assert.equal(git(checkout, 'status', '--porcelain'), '')
  assert.match(refreshComparisonBase(checkout, 'origin/main'), /Refreshed/)
  assert.match(refreshComparisonBase(checkout, 'origin/HEAD'), /Refreshed/)
  assert.equal(git(checkout, 'rev-parse', 'origin/HEAD'), current)
  const historical = (command, args, options) => {
    assert.notEqual(args[0], 'fetch', 'historical revisions must not be fetched as branch names')
    return spawnSync(command, args, options)
  }
  for (const ref of ['origin/main~1', 'origin/main^', 'origin/main@{1}', 'origin/main^{commit}']) {
    assert.equal(refreshComparisonBase(checkout, ref, { run: historical }), undefined)
  }
  assert.equal(refreshComparisonBase(checkout, planned, { run: historical }), undefined)
  assert.throws(() => plannedComparisonBase(checkout, 'not-a-ref'), /Cannot resolve planned/)
})

test('local branches and historical revisions do not fetch a guessed remote', () => {
  for (const base of ['main', 'HEAD~3', 'a'.repeat(40), 'release/local']) {
    const calls = []
    const run = (_command, args) => {
      calls.push(args)
      return { status: 0, stdout: '' }
    }
    assert.equal(refreshComparisonBase('/fixture', base, { run }), undefined)
    assert.equal(calls.length, 1)
    assert.equal(calls[0][0], 'rev-parse')
  }
})

test('refreshes a non-default remote branch with a bounded explicit non-forcing refspec', () => {
  const calls = []
  const run = (command, args, options) => {
    calls.push({ command, args, options })
    return {
      status: 0,
      stdout:
        args[0] === 'rev-parse' ? 'refs/remotes/upstream/release/4.x\n' : 'origin\nupstream\n',
    }
  }
  refreshComparisonBase('/fixture', 'upstream/release/4.x', { run })
  assert.deepEqual(calls[2].args, [
    'fetch',
    '--no-tags',
    '--no-recurse-submodules',
    'upstream',
    'refs/heads/release/4.x:refs/remotes/upstream/release/4.x',
  ])
  assert.equal(calls[2].options.timeout, 30_000)
  assert.equal(calls[2].options.stdio, 'ignore')
  assert.equal(calls[2].options.detached, true)
})

test('unavailable remotes and failed or timed-out fetches cannot produce a fresh verdict', () => {
  assert.throws(
    () =>
      refreshComparisonBase('/fixture', 'origin/main', {
        run: () => ({ status: null, error: { code: 'ENOENT' } }),
      }),
    /freshness is unknown/,
  )
  for (const failure of [{ status: 128 }, { status: null, error: { code: 'ETIMEDOUT' } }]) {
    assert.throws(
      () =>
        refreshComparisonBase('/fixture', 'origin/main', {
          run: (_command, args) =>
            args[0] === 'rev-parse'
              ? { status: 0, stdout: 'refs/remotes/origin/main\n' }
              : args[0] === 'remote'
                ? { status: 0, stdout: 'origin\n' }
                : failure,
        }),
      /freshness is unknown/,
    )
  }
})

test('a timed-out fetch reaps its own process group, including a helper child', (t) => {
  if (process.platform === 'win32') return t.skip('POSIX process groups required')
  const root = mkdtempSync(join(tmpdir(), 'release-base-timeout-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const marker = join(root, 'child.json')
  const code = `const {spawn}=require('node:child_process'); const fs=require('node:fs');
    const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
    fs.writeFileSync(${JSON.stringify(marker)},JSON.stringify({pid:child.pid}));setInterval(()=>{},1000);`
  const run = (command, args, options) =>
    args[0] === 'rev-parse'
      ? { status: 0, stdout: 'refs/remotes/origin/main\n' }
      : args[0] === 'remote'
        ? { status: 0, stdout: 'origin\n' }
        : spawnSync(process.execPath, ['-e', code], options)
  assert.throws(
    () => refreshComparisonBase(root, 'origin/main', { run, timeout: 2500 }),
    /timed out/,
  )
  assert.ok(existsSync(marker), 'the helper child must have started before the deadline')
  const { pid } = JSON.parse(readFileSync(marker, 'utf8'))
  const state = spawnSync('ps', ['-p', String(pid), '-o', 'stat='], { encoding: 'utf8' })
  assert.ok(
    state.status !== 0 || !state.stdout.trim() || state.stdout.trim().startsWith('Z'),
    `fetch helper ${pid} is still running`,
  )
})
