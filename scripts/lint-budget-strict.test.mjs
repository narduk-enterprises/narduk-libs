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

// A narduk-lint run is narrowed unless it runs from the budget file's
// directory with no path but that directory and no --ignore-pattern, and a
// narrowed run never writes lint-budget.json: it would clear entries whose
// warnings live in files it skipped, renewing their expiry on the next full
// run (narduk-libs#1237). A package's lint script is its canonical run, so
// every narduk-lint invocation in it must be a whole-package one; files a
// package must skip belong in ESLint's config, not on the command line.
const VALUE_FLAGS = new Set(['--budget', '--cache-location', '--ignore-pattern'])
const DIRECTORY_FLAGS = new Set(['-C', '--dir', '--prefix', '--cwd'])

function tokens(segment) {
  return segment
    .trim()
    .split(/\s+/u)
    .filter(Boolean)
    .map((token) => token.replace(/^['"]|['"]$/gu, ''))
}

/** Every problem with the narduk-lint invocations in a lint script. */
export function nardukLintProblems(lint) {
  const problems = []
  let changedDirectory = false
  for (const segment of lint.split(/&&|\|\||;|\|/u)) {
    const words = tokens(segment)
    if (words[0] === 'cd' || words[0] === 'pushd') {
      changedDirectory = true
      continue
    }
    let start = words.findIndex((word) => /(?:^|\/)narduk-lint(?:\.mjs)?$/u.test(word))
    if (start === -1) {
      const quality = words.findIndex((word) => /package-quality\.mjs$/u.test(word))
      if (quality === -1 || words[quality + 1] !== 'lint') continue
      start = quality + 1
    }
    if (changedDirectory) problems.push('runs after a `cd`')
    for (const word of words.slice(0, start)) {
      if (DIRECTORY_FLAGS.has(word.split('=')[0])) problems.push(`changes directory with ${word}`)
    }
    const args = words.slice(start + 1)
    for (let index = 0; index < args.length; index += 1) {
      const arg = args[index]
      if (VALUE_FLAGS.has(arg)) {
        const value = args[index + 1] ?? ''
        index += 1
        if (arg === '--ignore-pattern') problems.push(`passes --ignore-pattern ${value}`)
        if (arg === '--budget' && value.includes('/')) problems.push(`passes --budget ${value}`)
      } else if (!arg.startsWith('-') && arg !== '.' && arg !== './') {
        problems.push(`passes the path ${arg}`)
      }
    }
  }
  return problems
}

test('every narduk-lint package lints the whole package', () => {
  const problems = loadWorkspace(root)
    .packages.filter(({ manifest }) => lintsWithNardukLint(manifest))
    .flatMap(({ relativeDirectory, manifest }) =>
      nardukLintProblems(manifest.scripts.lint).map(
        (problem) => `${relativeDirectory}: "lint" ${problem}`,
      ),
    )
  assert.deepEqual(
    problems,
    [],
    `Run plain \`narduk-lint\` from the package root and move any file exclusions into the ESLint config:\n${problems.join('\n')}`,
  )
})

test('finds every narrowed narduk-lint invocation, however it is spelled', () => {
  for (const clean of [
    'narduk-lint',
    'narduk-lint .',
    'narduk-lint --ci --cache',
    'narduk-lint && narduk-stylelint tokens.css',
    'nuxt prepare && narduk-lint',
    'node ./bin/narduk-lint.mjs',
    'node ../../../tools/package-quality.mjs lint',
    'narduk-lint && pnpm run lint:server-boundaries',
  ]) {
    assert.deepEqual(nardukLintProblems(clean), [], clean)
  }
  for (const narrowed of [
    'narduk-lint src tests',
    'narduk-lint . src',
    'narduk-lint --ignore-pattern x.ts && y',
    'pnpm exec narduk-lint src',
    'npx narduk-lint src',
    'NODE_OPTIONS=--max-old-space-size=4096 narduk-lint src',
    'cross-env NODE_ENV=test narduk-lint src',
    'node ../eslint-config/bin/narduk-lint.mjs src',
    'narduk-lint && narduk-lint src',
    'cd src && narduk-lint',
    'pnpm -C src exec narduk-lint',
    'narduk-lint --budget ../other/lint-budget.json',
    "node ../../../tools/package-quality.mjs lint 'src/**/*.ts'",
  ]) {
    assert.notDeepEqual(nardukLintProblems(narrowed), [], narrowed)
  }
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
