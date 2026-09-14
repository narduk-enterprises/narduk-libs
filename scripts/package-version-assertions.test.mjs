import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { loadWorkspace } from './compute-affected-packages.mjs'

/**
 * A package-surface test has hardcoded its own package's version three times
 * now, and each time the hardcoding was structurally guaranteed to fail the
 * next time changesets moved that number:
 *
 * - narduk-shell's discovery test asserted the literal `'0.0.0'`. PR #244's
 *   0.1.0 release sat for nine days, and once it ran, this single assertion
 *   failed the required `contracts` gate (narduk-libs#291).
 * - narduk-postgres and narduk-timeseries asserted the literal `'0.1.0'` in
 *   their own package-exports tests. The #294 release bumped both to 0.2.0,
 *   so the release could never pass CI (narduk-libs#297).
 * - #297's own fix replaced the literal with `/^0\.\d+\.\d+$/`, copying the
 *   shape narduk-realtime's test already used. That regex still hardcodes
 *   major version 0, so it fails all three packages' first 1.0.0 the same
 *   way -- the same defect, one bump further out, and this workspace already
 *   has packages well past 1.0 (narduk-testkit is 1.3.0) proving that bump is
 *   a "when", not an "if".
 *
 * All three incidents share one textual signature: an `expect(...)` whose
 * target mentions `version`, chained onto either an exact three-part literal
 * (`.toBe('0.1.0')`) or a regex anchored to a hardcoded leading digit
 * (`.toMatch(/^0\.` -- or `/^1\.`, `/^2\.`, any literal digit right after
 * `^`). A real semver-shape assertion anchors on a digit *class* instead
 * (`.toMatch(/^\d+\.\d+\.\d+/)`, as narduk-libs#291's fix and
 * `eslint-config`'s own plugin-version check already do) and never needs to
 * change when the package releases.
 *
 * This is a plain content scan, not a parser -- it cannot see a pin built by
 * string concatenation or a helper function, and it does not need to: the
 * three real incidents above were all copy-pasted boilerplate, not evasion,
 * so a textual guard closes the actual recurrence path. Scope is every
 * workspace package's own "tests" directory, walked recursively for
 * "*.test.ts" and "*.test.mjs" files, with the package list itself read from
 * pnpm-workspace.yaml via loadWorkspace rather than assumed -- because that
 * is where the pattern has actually recurred, and where a new package's
 * copy-pasted template is most likely to reintroduce it. The root
 * scripts/*.test.mjs suite is not scanned: it uses node:assert, not vitest's
 * expect, has no live instance of this shape, and its one former instance
 * (this file's neighbour, compute-affected-packages.test.mjs) already
 * carries its own comment against reintroducing it.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

// A literal three-part version passed to `.toBe`, e.g. `.toBe('0.1.0')`.
const PINS_EXACT_LITERAL = /expect\([^()]*version[^()]*\)\s*\.toBe\(\s*['"]\d+\.\d+\.\d+['"]/iu
// A regex anchored to one hardcoded leading digit, e.g. `.toMatch(/^0\.../)`.
// `/^\d/` (a digit *class*, not a literal digit) does not match this and is
// the accepted replacement shape.
const PINS_LEADING_DIGIT = /expect\([^()]*version[^()]*\)\s*\.toMatch\(\s*\/\^\d/iu

function testFilesUnder(directory) {
  let entries
  try {
    entries = readdirSync(directory, { withFileTypes: true })
  } catch {
    return []
  }
  const files = []
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue
    const full = join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...testFilesUnder(full))
    } else if (/\.test\.(?:ts|mjs)$/u.test(entry.name)) {
      files.push(full)
    }
  }
  return files
}

test("no package-surface test pins its own manifest's version", () => {
  const workspace = loadWorkspace(repoRoot)
  const offenders = []

  for (const { directory } of workspace.packages) {
    for (const file of testFilesUnder(join(directory, 'tests'))) {
      const source = readFileSync(file, 'utf8')
      if (PINS_EXACT_LITERAL.test(source) || PINS_LEADING_DIGIT.test(source)) {
        offenders.push(file.slice(repoRoot.length + 1))
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    'these test files assert an exact or major-version-pinned semver against ' +
      "their own package's manifest.version -- the exact shape that broke CI " +
      'in narduk-libs#291 and #297. Assert a real semver shape instead (a ' +
      'digit *class* after ^, not a hardcoded leading digit; no exact ' +
      `three-part literal): ${offenders.join(', ')}`,
  )
})
