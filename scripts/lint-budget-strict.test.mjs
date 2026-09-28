// Every workspace package that lints with narduk-lint keeps a committed,
// strict lint-budget.json (#673). Without one, narduk-lint cannot fail on a
// warning in a rule that has no budget entry, and a package with no file has
// no warning gate at all -- the gate reports "0 errors" and exits 0.
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { loadWorkspace } from './compute-affected-packages.mjs'
import { NEVER_PUBLISHED_FILES } from './release-plan-guard.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// narduk-lint directly, or through tools/package-quality.mjs, whose `lint`
// command runs narduk-lint in the package directory.
export function lintsWithNardukLint(manifest) {
  const lint = manifest.scripts?.lint ?? ''
  return lint.includes('narduk-lint') || /package-quality\.mjs\s+lint\b/u.test(lint)
}

test('every narduk-lint package has a strict lint-budget.json', () => {
  const packages = loadWorkspace(root).packages.filter(({ manifest }) =>
    lintsWithNardukLint(manifest),
  )
  assert.ok(packages.length > 0, 'found no package that lints with narduk-lint')
  const problems = []
  for (const { relativeDirectory } of packages) {
    const file = join(relativeDirectory, 'lint-budget.json')
    if (!existsSync(join(root, file))) {
      problems.push(`${file} is missing`)
      continue
    }
    const budget = JSON.parse(readFileSync(join(root, file), 'utf8'))
    if (budget.strict !== true) problems.push(`${file} is not "strict": true`)
  }
  assert.deepEqual(
    problems,
    [],
    `Commit {"strict": true, "rules": {}} (plus any deliberate entries) for:\n${problems.join('\n')}`,
  )
})

// A narduk-lint run given paths or --ignore-pattern is narrowed: it never
// writes lint-budget.json, because it would clear entries whose warnings live
// in files it skipped and so renew their expiry on the next full run
// (narduk-libs#1237). A package's lint script is its canonical run, so it
// lints the whole package; files a package must skip belong in ESLint's
// config, not on the command line.
export function nardukLintArguments(manifest) {
  const lint = manifest.scripts?.lint ?? ''
  const match =
    /(?:^|&&|\|\||;)\s*narduk-lint((?:\s+[^&|;]+)?)/u.exec(lint) ??
    /package-quality\.mjs\s+lint((?:\s+[^&|;]+)?)/u.exec(lint)
  return match ? match[1].trim().split(/\s+/u).filter(Boolean) : []
}

test('every narduk-lint package lints the whole package', () => {
  const problems = loadWorkspace(root)
    .packages.filter(({ manifest }) => lintsWithNardukLint(manifest))
    .filter(({ manifest }) => nardukLintArguments(manifest).length > 0)
    .map(
      ({ relativeDirectory, manifest }) =>
        `${relativeDirectory}: "lint" passes ${nardukLintArguments(manifest).join(' ')}`,
    )
  assert.deepEqual(
    problems,
    [],
    `Run plain \`narduk-lint\` and move any file exclusions into the ESLint config:\n${problems.join('\n')}`,
  )
})

test('reads the arguments a lint script passes to narduk-lint', () => {
  const args = (lint) => nardukLintArguments({ scripts: { lint } })
  assert.deepEqual(args('narduk-lint'), [])
  assert.deepEqual(args('narduk-lint && narduk-stylelint tokens.css'), [])
  assert.deepEqual(args('nuxt prepare && narduk-lint'), [])
  assert.deepEqual(args('narduk-lint src tests'), ['src', 'tests'])
  assert.deepEqual(args('narduk-lint --ignore-pattern x.ts && y'), ['--ignore-pattern', 'x.ts'])
  assert.deepEqual(args('node ../../../tools/package-quality.mjs lint'), [])
  assert.deepEqual(args("node ../../../tools/package-quality.mjs lint 'src/**/*.ts'"), [
    "'src/**/*.ts'",
  ])
  assert.deepEqual(args('node ./bin/narduk-lint.mjs'), [])
})

test('recognizes both ways a package reaches narduk-lint', () => {
  assert.equal(lintsWithNardukLint({ scripts: { lint: 'narduk-lint src tests' } }), true)
  assert.equal(
    lintsWithNardukLint({
      scripts: { lint: "node ../../../tools/package-quality.mjs lint 'src/**/*.ts'" },
    }),
    true,
  )
  assert.equal(lintsWithNardukLint({ scripts: { lint: 'eslint .' } }), false)
  assert.equal(lintsWithNardukLint({}), false)
})

// release-plan-guard.mjs treats a lint-budget.json change as owing no release
// on the ground that no tarball contains it. Hold that ground: every published
// package names its files, and none names a budget or a pattern that sweeps
// root files in.
test('no published package ships a file the release guard ignores', () => {
  const problems = []
  for (const { relativeDirectory, manifest } of loadWorkspace(root).packages) {
    if (manifest.private === true) continue
    if (!Array.isArray(manifest.files)) {
      problems.push(`${relativeDirectory}/package.json has no "files" list`)
      continue
    }
    for (const entry of manifest.files) {
      const name = entry.replace(/^\.\//u, '')
      if (NEVER_PUBLISHED_FILES.has(name) || /^[*.]/u.test(name) || name === '') {
        problems.push(
          `${relativeDirectory}: "files" entry ${JSON.stringify(entry)} can publish a gate-only file`,
        )
      }
    }
  }
  assert.deepEqual(problems, [])
})
