import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  fetchTargetForBase,
  newlyDirtyPaths,
  nonWritingExecute,
  parsePreflightArgs,
  preflightChangedFiles,
  trackedTreeSnapshot,
} from './preflight.mjs'

// A real repository rather than a stub: the whole point of the guard is that
// it agrees with git about what "dirty" means, including the untracked case,
// so a fake `git status` would test the wrong thing.
function repository() {
  const directory = mkdtempSync(join(tmpdir(), 'preflight-'))
  const git = (...args) => execFileSync('git', args, { cwd: directory, encoding: 'utf8' })
  git('init', '--quiet', '--initial-branch=main')
  git('config', 'user.email', 'preflight@example.com')
  git('config', 'user.name', 'Preflight')
  writeFileSync(join(directory, 'tracked.json'), '{"rules":{}}\n')
  writeFileSync(join(directory, 'other.txt'), 'unchanged\n')
  git('add', '-A')
  git('commit', '--quiet', '-m', 'base')
  return { directory, git, cleanup: () => rmSync(directory, { recursive: true, force: true }) }
}

test('a phase that rewrites a tracked file is caught', () => {
  const { directory, cleanup } = repository()
  try {
    const before = trackedTreeSnapshot(directory)
    assert.deepEqual(newlyDirtyPaths(before, trackedTreeSnapshot(directory)), [])
    // Precisely the narduk-libs#623 shape: a budget file rewritten by a
    // command whose stated job is to check.
    writeFileSync(join(directory, 'tracked.json'), '{"rules":{"sonarjs/no-duplicate-string":1}}\n')
    assert.deepEqual(newlyDirtyPaths(before, trackedTreeSnapshot(directory)), ['tracked.json'])
  } finally {
    cleanup()
  }
})

test('a staged rename reports both the source and the destination (#915)', () => {
  const { directory, git, cleanup } = repository()
  try {
    const before = trackedTreeSnapshot(directory)
    git('mv', 'tracked.json', 'moved.json')
    assert.deepEqual(newlyDirtyPaths(before, trackedTreeSnapshot(directory)), [
      'moved.json',
      'tracked.json',
    ])
  } finally {
    cleanup()
  }
})

test('a file the phase created is caught, not only one it modified', () => {
  // The #623 report's own instance was a budget file that did not exist
  // before the gate ran, so an implementation that only diffed tracked
  // content would have missed the reported failure entirely.
  const { directory, cleanup } = repository()
  try {
    const before = trackedTreeSnapshot(directory)
    mkdirSync(join(directory, 'packages', 'modules', 'narduk-timeseries'), { recursive: true })
    writeFileSync(
      join(directory, 'packages', 'modules', 'narduk-timeseries', 'lint-budget.json'),
      '{"rules":{"@typescript-eslint/array-type":1}}\n',
    )
    assert.deepEqual(newlyDirtyPaths(before, trackedTreeSnapshot(directory)), [
      'packages/modules/narduk-timeseries/lint-budget.json',
    ])
  } finally {
    cleanup()
  }
})

test('work the author already had in the tree is not blamed on a phase', () => {
  const { directory, cleanup } = repository()
  try {
    writeFileSync(join(directory, 'other.txt'), 'the author was mid-edit\n')
    writeFileSync(join(directory, 'scratch.md'), 'and had an untracked note\n')
    const before = trackedTreeSnapshot(directory)
    assert.deepEqual(newlyDirtyPaths(before, trackedTreeSnapshot(directory)), [])
    writeFileSync(join(directory, 'tracked.json'), '{"rules":{"no-console":1}}\n')
    assert.deepEqual(newlyDirtyPaths(before, trackedTreeSnapshot(directory)), ['tracked.json'])
  } finally {
    cleanup()
  }
})

test('a rename is one entry, not an entry plus a phantom', () => {
  const { directory, git, cleanup } = repository()
  try {
    const before = trackedTreeSnapshot(directory)
    git('mv', 'other.txt', 'renamed.txt')
    const dirtied = newlyDirtyPaths(before, trackedTreeSnapshot(directory))
    assert.ok(dirtied.includes('renamed.txt'), `got ${JSON.stringify(dirtied)}`)
    assert.ok(
      dirtied.every((path) => path.length > 0),
      'a rename must not contribute an empty path',
    )
  } finally {
    cleanup()
  }
})

test('the changed-file set is the union of committed and working-tree work', () => {
  const { directory, git, cleanup } = repository()
  try {
    git('checkout', '--quiet', '-b', 'feature')
    writeFileSync(join(directory, 'committed.txt'), 'in a commit\n')
    git('add', '-A')
    git('commit', '--quiet', '-m', 'work')
    writeFileSync(join(directory, 'uncommitted.txt'), 'not yet\n')
    // CI can only see `committed.txt`. The author is usually asking about
    // both, and answering about only the committed half is how a preflight
    // silently under-reports the packages a push is about to affect.
    assert.deepEqual(preflightChangedFiles(directory, 'main'), ['committed.txt', 'uncommitted.txt'])
  } finally {
    cleanup()
  }
})

test('package gates run with CI=true so narduk-lint cannot write the budget', () => {
  // Prevention, checked separately from detection: `narduk-lint` only writes
  // lint-budget.json outside CI mode, and CI=true is what selects that mode.
  const calls = []
  const execute = nonWritingExecute((file, args, options) => {
    calls.push({ file, args, env: options.env })
    return { status: 0 }
  })
  execute('pnpm', ['--filter', '@narduk-enterprises/narduk-core', 'run', 'lint'], { cwd: '/repo' })
  assert.equal(calls[0].env.CI, 'true')
  assert.equal(calls[0].env.PATH, process.env.PATH, 'the rest of the environment must survive')
})

test('preflight arguments parse, and an unknown one is refused', () => {
  assert.deepEqual(parsePreflightArgs([]), { base: 'origin/main', fetch: true, consumer: true })
  assert.deepEqual(parsePreflightArgs(['--base', 'origin/release', '--no-fetch']), {
    base: 'origin/release',
    fetch: false,
    consumer: true,
  })
  assert.equal(parsePreflightArgs(['--base=upstream/main']).base, 'upstream/main')
  assert.equal(parsePreflightArgs(['--no-consumer']).consumer, false)
  assert.throws(() => parsePreflightArgs(['--write']), /Unknown preflight argument/u)
})

test('--base decides which ref is fetched, and a base naming no remote is left alone', () => {
  const remotes = ['origin', 'upstream']
  assert.deepEqual(fetchTargetForBase('origin/main', remotes), { remote: 'origin', ref: 'main' })
  // A ref with its own slashes belongs to the ref, not to the remote name.
  assert.deepEqual(fetchTargetForBase('upstream/release/4.x', remotes), {
    remote: 'upstream',
    ref: 'release/4.x',
  })
  // Fetching the wrong thing silently is worse than not fetching: a bare
  // branch, a SHA and a revision expression all name no remote.
  for (const base of ['main', 'HEAD~3', '7fa6c0ad', 'fork/main', 'origin/', '/main']) {
    assert.equal(fetchTargetForBase(base, remotes), undefined, base)
  }
})

test('the packed proof builds its scope before it packs it, with the same scope', () => {
  // release-packages.mjs asserts a compiled dist/ is present, and a scoped run
  // packs the dependency closure -- packages whose own `build` gate never ran.
  // Skipping the build only looks fine on a full-set run.
  const source = readFileSync(new URL('./preflight.mjs', import.meta.url), 'utf8')
  const build = source.indexOf('prepare-packed-consumer.mjs')
  const pack = source.indexOf("'scripts/release-packages.mjs'")
  assert.ok(build > 0, 'preflight must build the packed scope')
  assert.ok(pack > build, 'the build must come before the pack')
  // One scope value, spread into both, so the two cannot drift apart.
  assert.equal(source.match(/\.\.\.scopeArgs/gu)?.length, 2)
})

test('the contracts phases run the whole contracts job, audit included', () => {
  const source = readFileSync(new URL('./preflight.mjs', import.meta.url), 'utf8')
  const order = [
    'versions:check',
    'scripts:test',
    'release-plan:check',
    'format:check',
    'surface:check',
    'audit',
  ]
  let cursor = 0
  for (const name of order) {
    const at = source.indexOf(`phase('${name}'`, cursor)
    assert.ok(at > 0, `preflight must run ${name}`)
    cursor = at
  }
})

test('a plan that selects the generated-app proof says that proof did not run here', () => {
  // CI runs `release:consumer-smoke --install-browser` when the planner selects
  // the generated-app proof; this command always takes the artifacts-only path.
  // `Generated-app proof: true` in the plan would otherwise read as something
  // that already passed.
  const source = readFileSync(new URL('./preflight.mjs', import.meta.url), 'utf8')
  assert.match(source, /plan\.generatedConsumer\}? \(CI\)|\(CI\)/u)
  assert.ok(source.includes('was NOT run here'), 'the notice must name what did not run')
  assert.ok(
    source.includes('--install-browser'),
    'the notice must give the command that does run it',
  )
  // A notice, not a failure: a gate that goes red for declining to download a
  // browser is one people learn to ignore.
  const notice = source.slice(source.indexOf('was NOT run here') - 600)
  assert.ok(
    !/failures\.push\([^)]*generated/iu.test(notice),
    'the generated-app notice must not fail the run',
  )
})

test('the preflight itself invokes no writing command', () => {
  // A guard that only ran after the fact would still leave the author with a
  // dirty tree to clean up. Every command this file names must be a checking
  // form, so the ordinary run has nothing to catch.
  const source = readFileSync(new URL('./preflight.mjs', import.meta.url), 'utf8')
  for (const forbidden of [
    "'format'",
    "'run', 'format'",
    '--write',
    '--fix',
    "'changeset'",
    "release-packages.mjs', '--publish",
  ]) {
    assert.ok(!source.includes(forbidden), `preflight must not invoke ${forbidden}`)
  }
  // The packed-consumer proof is the one expensive phase, and it must stay on
  // the dry-run, artifacts-only path: a real publish from a laptop is exactly
  // what this command must never become.
  assert.match(
    source,
    /'--dry-run',\n\s+'--consumer-smoke',\n\s+'--artifacts-only'|'--dry-run', '--consumer-smoke', '--artifacts-only'/u,
  )
})
