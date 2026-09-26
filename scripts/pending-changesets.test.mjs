import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  pendingChangesetNames,
  restorePendingChangesets,
  setAsidePendingChangesets,
} from './pending-changesets.mjs'
import { publicationPlan } from './publish-verified-packages.mjs'

const registry = 'https://npm.pkg.github.com'

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'narduk-pending-changesets-'))
  const changesetDir = join(root, '.changeset')
  mkdirSync(changesetDir)
  writeFileSync(join(changesetDir, 'README.md'), '# Changesets\n')
  writeFileSync(join(changesetDir, 'config.json'), '{}\n')
  writeFileSync(join(changesetDir, 'late-feature.md'), "---\n'@narduk-enterprises/a': minor\n---\n")
  writeFileSync(join(changesetDir, 'late-fix.md'), "---\n'@narduk-enterprises/b': patch\n---\n")
  return { root, changesetDir, holdDir: join(root, 'hold') }
}

test('only .md files other than the README are pending', () => {
  const { root, changesetDir } = fixture()
  try {
    assert.deepEqual(pendingChangesetNames(changesetDir), ['late-feature.md', 'late-fix.md'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('set-aside and restore round-trip the pending Changesets byte for byte', () => {
  const { root, changesetDir, holdDir } = fixture()
  try {
    const before = readFileSync(join(changesetDir, 'late-fix.md'), 'utf8')
    assert.deepEqual(setAsidePendingChangesets(changesetDir, holdDir), [
      'late-feature.md',
      'late-fix.md',
    ])
    assert.deepEqual(readdirSync(changesetDir).sort(), ['README.md', 'config.json'])
    assert.deepEqual(restorePendingChangesets(changesetDir, holdDir), [
      'late-feature.md',
      'late-fix.md',
    ])
    assert.equal(readFileSync(join(changesetDir, 'late-fix.md'), 'utf8'), before)
    assert.deepEqual(readdirSync(holdDir), [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('restore refuses to overwrite a Changeset that reappeared', () => {
  const { root, changesetDir, holdDir } = fixture()
  try {
    setAsidePendingChangesets(changesetDir, holdDir)
    writeFileSync(join(changesetDir, 'late-fix.md'), 'rewritten\n')
    assert.throws(
      () => restorePendingChangesets(changesetDir, holdDir),
      /Changesets already present: late-fix\.md/u,
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// The #1102 merge commit: the release PR bumped `a` to 1.3.0, which is not on
// the registry yet, and two later PRs left Changesets pending. Before the fix
// the pending Changesets kept the Release run off the publish path entirely.
test('a merge commit with an unpublished bump and pending Changesets still publishes the bump', () => {
  const { root, changesetDir, holdDir } = fixture()
  try {
    const packages = [
      { name: '@narduk-enterprises/a', version: '1.3.0', publishConfig: { registry } },
      { name: '@narduk-enterprises/b', version: '2.0.1', publishConfig: { registry } },
    ]
    const records = {
      '@narduk-enterprises/a': { versions: ['1.2.0'], latest: '1.2.0' },
      '@narduk-enterprises/b': { versions: ['2.0.1'], latest: '2.0.1' },
    }
    assert.equal(pendingChangesetNames(changesetDir).length, 2)

    setAsidePendingChangesets(changesetDir, holdDir)
    assert.equal(pendingChangesetNames(changesetDir).length, 0)
    assert.deepEqual(
      publicationPlan(packages, records).map(({ name, version }) => `${name}@${version}`),
      ['@narduk-enterprises/a@1.3.0'],
    )

    restorePendingChangesets(changesetDir, holdDir)
    assert.equal(pendingChangesetNames(changesetDir).length, 2)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('release.yml publishes bumped versions before preparing the next release PR', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/release.yml', import.meta.url),
    'utf8',
  )
  const at = (needle) => {
    const index = workflow.indexOf(needle)
    assert.ok(index > 0, `release.yml is missing: ${needle}`)
    return index
  }
  const order = [
    at('id: release-mode'),
    at('id: set-aside'),
    at('id: publish-first'),
    at('- name: Verify the versions published first'),
    at('- name: Restore pending changesets'),
    at('id: changesets'),
  ]
  assert.deepEqual(
    order,
    [...order].sort((left, right) => left - right),
  )

  const step = (name) => workflow.split(`- name: ${name}\n`)[1].split('\n      - name: ')[0]
  assert.match(
    step("Set aside pending changesets to publish main's bumped versions first"),
    /if: steps\.release-mode\.outputs\.publish == 'false'/u,
  )
  assert.match(step('Publish versions main already bumped'), /publish: pnpm run release:publish/u)
  assert.doesNotMatch(step('Publish versions main already bumped'), /version:/u)
  assert.match(
    step('Restore pending changesets'),
    /if: always\(\) && steps\.set-aside\.outcome == 'success'/u,
  )
  assert.match(
    workflow,
    /published: \$\{\{ steps\.publish-first\.outputs\.published == 'true' \|\| steps\.changesets\.outputs\.published == 'true' \}\}/u,
  )
})
