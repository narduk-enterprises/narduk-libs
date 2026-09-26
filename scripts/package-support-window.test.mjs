import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  SUPPORT_WINDOW_FILE,
  checkSupportWindow,
  loadSupportWindow,
  publishedPackageNames,
} from './package-support-window.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function declaration(packages) {
  return {
    schemaVersion: 1,
    rule: { id: 'n-and-n-minus-1', minimumDays: 90, statement: 'N-1 keeps backports.' },
    packages,
  }
}

test('every published workspace package states its N-1 support window (narduk-libs#1034)', () => {
  const problems = checkSupportWindow(loadSupportWindow(root), publishedPackageNames(root))
  assert.deepEqual(problems, [], `${SUPPORT_WINDOW_FILE}:\n${problems.join('\n')}`)
})

test('names a published package with no entry, and prints the line to add', () => {
  const problems = checkSupportWindow(declaration({}), ['@narduk-enterprises/new-thing'])
  assert.equal(problems.length, 1)
  assert.match(problems[0], /@narduk-enterprises\/new-thing has no entry/u)
  assert.match(
    problems[0],
    /"@narduk-enterprises\/new-thing": \{ "compatibility": "n-and-n-minus-1" \}/u,
  )
})

test('names an entry for a package that is not published here any more', () => {
  const problems = checkSupportWindow(
    declaration({ '@narduk-enterprises/gone': { compatibility: 'n-and-n-minus-1' } }),
    [],
  )
  assert.deepEqual(problems, [
    '@narduk-enterprises/gone is listed but is not a published workspace package; remove its entry.',
  ])
})

test('accepts not-applicable only with a reason, and no other value', () => {
  const problems = checkSupportWindow(
    declaration({
      '@narduk-enterprises/a': { compatibility: 'not-applicable' },
      '@narduk-enterprises/b': { compatibility: 'not-applicable', reason: 'one consumer: buoys' },
      '@narduk-enterprises/c': { compatibility: 'forever' },
    }),
    ['@narduk-enterprises/a', '@narduk-enterprises/b', '@narduk-enterprises/c'],
  )
  assert.deepEqual(problems, [
    '@narduk-enterprises/a is not-applicable with no reason; say why (for example, which single consumer it has).',
    '@narduk-enterprises/c has compatibility "forever"; use "n-and-n-minus-1" or "not-applicable".',
  ])
})

test('refuses a declaration whose rule is not the N-1 window', () => {
  const bad = declaration({})
  bad.rule = { id: 'n-only', minimumDays: 0, statement: '' }
  assert.deepEqual(checkSupportWindow(bad, []), [
    'rule.id must be "n-and-n-minus-1" (got "n-only").',
    'rule.minimumDays must be 90 (got 0).',
    'rule.statement must say what the window keeps.',
  ])
})

test('reads only non-private workspace packages as published', () => {
  const names = publishedPackageNames(root)
  assert.ok(names.includes('@narduk-enterprises/narduk-core'))
  assert.ok(!names.includes('@narduk-enterprises/libs-explorer'))
  assert.ok(!names.includes('@narduk-enterprises/design-system-build'))
})
