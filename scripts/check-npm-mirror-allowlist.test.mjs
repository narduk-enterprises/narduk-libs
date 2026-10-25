/**
 * Tests for the npm.nard.uk allowlist gate. None of them touch the network: the
 * `--upstream` read is an injected fetcher.
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test, { after } from 'node:test'
import { fileURLToPath } from 'node:url'

import { loadWorkspace } from './compute-affected-packages.mjs'
import {
  InconclusiveError,
  MIRROR_PATH,
  checkAgainstAllowlist,
  compareWithUpstream,
  fetchUpstreamViaGh,
  parseUpstreamContract,
  publicPackages,
  readMirror,
  runCheck,
} from './check-npm-mirror-allowlist.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const scope = '@narduk-enterprises'
const temporaryDirectories = []

after(() => {
  for (const directory of temporaryDirectories) rmSync(directory, { recursive: true, force: true })
})

// A throwaway workspace laid out like the real one: packages/<family>/<name>.
function fixtureWorkspace(packages) {
  const directory = mkdtempSync(join(tmpdir(), 'npm-mirror-allowlist-'))
  temporaryDirectories.push(directory)
  const families = [...new Set(packages.map(([family]) => family))]
  writeFileSync(
    join(directory, 'pnpm-workspace.yaml'),
    `packages:\n${families.map((family) => `  - "packages/${family}/*"\n`).join('')}`,
  )
  for (const [family, name, extra] of packages) {
    const packageDirectory = join(directory, 'packages', family, name)
    mkdirSync(packageDirectory, { recursive: true })
    writeFileSync(
      join(packageDirectory, 'package.json'),
      JSON.stringify({ name: `${scope}/${name}`, version: '1.0.0', ...extra }),
    )
  }
  return loadWorkspace(directory)
}

const mirror = (names) => ({ scope, packages: names })

test('a public package missing from the allowlist fails and is named', () => {
  const workspace = fixtureWorkspace([
    ['modules', 'narduk-core', {}],
    ['modules', 'narduk-brand-new', {}],
  ])
  const result = runCheck({ workspace, mirror: mirror(['narduk-core']) })
  assert.equal(result.ok, false)
  assert.equal(result.problems.length >= 1, true)
  assert.match(result.problems[0], /@narduk-enterprises\/narduk-brand-new/u)
  assert.match(result.problems[0], /packages\/modules\/narduk-brand-new/u)
  assert.ok(!result.problems.join('\n').includes('narduk-core ('), 'a listed package is not named')
  // The fix points at package-delivery first, the mirror second.
  assert.match(result.problems.at(-1), /package-delivery.*registry-contract\.ts/u)
})

test('a private package is ignored', () => {
  const workspace = fixtureWorkspace([
    ['modules', 'narduk-core', {}],
    ['design', 'internal-tool', { private: true }],
  ])
  assert.deepEqual(
    publicPackages(workspace).map(({ name }) => name),
    [`${scope}/narduk-core`],
  )
  const result = runCheck({ workspace, mirror: mirror(['narduk-core']) })
  assert.equal(result.ok, true)
  assert.deepEqual(result.problems, [])
})

test('a public package outside the mirrored scope fails', () => {
  const problems = checkAgainstAllowlist({
    packages: [{ name: '@other/thing', relativeDirectory: 'packages/modules/thing' }],
    scope,
    allowlisted: ['thing'],
  })
  assert.equal(problems.length, 1)
  assert.match(problems[0], /@other\/thing .*outside the mirrored scope/u)
})

test('the current tree passes against the checked-in mirror', () => {
  const result = runCheck({ workspace: loadWorkspace(root), mirror: readMirror() })
  assert.deepEqual(result.problems, [])
  assert.equal(result.ok, true)
})

test('the CLI passes on the current tree and exits 0', () => {
  const run = spawnSync('node', ['scripts/check-npm-mirror-allowlist.mjs'], {
    cwd: root,
    encoding: 'utf8',
  })
  assert.equal(run.status, 0, run.stderr)
  assert.match(run.stdout, /public packages are in the npm\.nard\.uk allowlist mirror/u)
})

test('the mirror file is a sorted, duplicate-free list that records its upstream commit', () => {
  const file = readMirror()
  assert.equal(file.scope, scope)
  assert.deepEqual(file.packages, [...new Set(file.packages)].sort())
  assert.match(file.syncedFrom.commit, /^[0-9a-f]{40}$/u)
  assert.equal(file.syncedFrom.repository, 'narduk-enterprises/package-delivery')
  assert.equal(file.syncedFrom.path, 'src/registry-contract.ts')
  assert.equal(readFileSync(MIRROR_PATH, 'utf8').endsWith('\n'), true)
})

test('an unreadable or malformed mirror is inconclusive, never a pass', () => {
  assert.throws(() => readMirror(join(tmpdir(), 'no-such-mirror.json')), InconclusiveError)
  const directory = mkdtempSync(join(tmpdir(), 'npm-mirror-allowlist-'))
  temporaryDirectories.push(directory)
  const empty = join(directory, 'empty.json')
  writeFileSync(empty, JSON.stringify({ scope, packages: [] }))
  assert.throws(() => readMirror(empty), InconclusiveError)
})

const upstreamSource = `
export const NPM_SCOPE = "@narduk-enterprises" as const;
/** doc */
export const ALLOWLISTED_PACKAGE_NAMES = [
  "narduk-core", // trailing comment "not-a-name"
  // "commented-out",
  "narduk-notify",
] as const;
`

test('the upstream contract parses scope and names, ignoring comments', () => {
  assert.deepEqual(parseUpstreamContract(upstreamSource), {
    scope,
    packages: ['narduk-core', 'narduk-notify'],
  })
})

test('upstream parsing fails closed on format drift', () => {
  assert.throws(
    () => parseUpstreamContract('export const NPM_SCOPE = "@x" as const;'),
    /not found/u,
  )
  assert.throws(
    () =>
      parseUpstreamContract(
        'export const NPM_SCOPE = "@x" as const;\nexport const ALLOWLISTED_PACKAGE_NAMES = [] as const;',
      ),
    /zero names/u,
  )
  assert.throws(() => parseUpstreamContract(''), InconclusiveError)
})

test('--upstream passes only on exact equality, in both directions', () => {
  const workspace = fixtureWorkspace([['modules', 'narduk-core', {}]])
  const commit = 'a'.repeat(40)
  const fetcher = (source) => () => ({ commit, source })
  const source = (names) =>
    `export const NPM_SCOPE = "${scope}" as const;\nexport const ALLOWLISTED_PACKAGE_NAMES = [${names
      .map((name) => `"${name}"`)
      .join(', ')}] as const;`

  const equal = runCheck({
    workspace,
    mirror: mirror(['narduk-core']),
    upstreamFetcher: fetcher(source(['narduk-core'])),
  })
  assert.equal(equal.ok, true)
  assert.match(equal.lines.join('\n'), new RegExp(`at ${commit}`, 'u'))

  const upstreamHasMore = runCheck({
    workspace,
    mirror: mirror(['narduk-core']),
    upstreamFetcher: fetcher(source(['narduk-core', 'narduk-notify'])),
  })
  assert.equal(upstreamHasMore.ok, false)
  assert.match(upstreamHasMore.problems.join('\n'), /Upstream lists "narduk-notify"/u)

  // The gap this mode exists for: a name added to the mirror alone.
  const mirrorOnly = runCheck({
    workspace,
    mirror: mirror(['narduk-core', 'narduk-notify']),
    upstreamFetcher: fetcher(source(['narduk-core'])),
  })
  assert.equal(mirrorOnly.ok, false)
  assert.match(mirrorOnly.problems.join('\n'), /mirror lists "narduk-notify"/u)

  assert.match(
    compareWithUpstream({
      mirror: { scope: '@a', packages: ['x'] },
      upstream: { scope: '@b', packages: ['x'] },
      upstreamCommit: commit,
    })[0],
    /scope @a differs/u,
  )
})

test('a failed upstream read is inconclusive, not a pass', () => {
  const failing = () => {
    throw new Error('HTTP 404: Not Found\nsecond line')
  }
  assert.throws(
    () => fetchUpstreamViaGh(failing),
    (error) => {
      assert.ok(error instanceof InconclusiveError)
      assert.match(error.message, /Cannot read narduk-enterprises\/package-delivery/u)
      assert.match(error.message, /Inconclusive, not a pass/u)
      assert.ok(!error.message.includes('second line'))
      return true
    },
  )
  assert.throws(
    () => fetchUpstreamViaGh(() => 'not a sha'),
    (error) => error instanceof InconclusiveError,
  )
  const calls = []
  const result = fetchUpstreamViaGh((command, args) => {
    calls.push([command, ...args])
    return args.some((argument) => argument.includes('/commits/main'))
      ? `${'b'.repeat(40)}\n`
      : 'src'
  })
  assert.deepEqual(result, { commit: 'b'.repeat(40), source: 'src' })
  assert.match(calls[1].at(-1), new RegExp(`\\?ref=${'b'.repeat(40)}$`, 'u'))
})

// The brief's actual requirement: a release PR must fail here. ci.yml skips
// release-plan:check there, so this gate has to be invoked before that skip.
test('ci.yml runs the gate on every run, including the release PR', () => {
  const ci = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8')
  const gate = ci.indexOf('node scripts/check-npm-mirror-allowlist.mjs')
  const skip = ci.indexOf('if [ "${IS_CHANGESET_RELEASE}" != "true" ]; then')
  assert.ok(gate > 0, 'ci.yml must invoke the allowlist gate')
  assert.ok(skip > gate, 'the gate must come before the IS_CHANGESET_RELEASE skip')
  assert.match(
    ci,
    /if \[ "\$\{IS_CHANGESET_RELEASE\}" != "true" \]; then\n\s+pnpm run release-plan:check/u,
  )
  assert.ok(!ci.includes('check-npm-mirror-allowlist.mjs --upstream'), 'CI never reads upstream')
})
