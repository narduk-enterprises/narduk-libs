import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  GENERIC_NAMES,
  SHARED_EXPORTS_MODULE_RELATIVE_PATH,
  deriveSharedExports,
  isCandidateName,
} from './generate-shared-exports.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** The committed `SHARED_EXPORT_OWNERS` entries, read as text so this test
 * needs no TypeScript loader. */
function committedOwners() {
  const text = readFileSync(join(repoRoot, SHARED_EXPORTS_MODULE_RELATIVE_PATH), 'utf8')
  const entries = {}
  for (const match of text.matchAll(/^ {2}([\w$]+): \[([^\]]*)\],$/gm)) {
    entries[match[1]] = [...match[2].matchAll(/'([^']+)'/g)].map((owner) => owner[1])
  }
  return entries
}

test('every committed name is still exported by its listed owners', () => {
  // A stale name is a false warning in an app, so it fails. A package gaining
  // an export does not fail unrelated pull requests; the next
  // `node scripts/generate-shared-exports.mjs` picks it up.
  const { names } = deriveSharedExports(repoRoot)
  const stale = []
  for (const [name, owners] of Object.entries(committedOwners())) {
    const real = names[name] ?? []
    for (const owner of owners) {
      if (!real.includes(owner)) stale.push(`${name} (${owner})`)
    }
  }
  assert.deepEqual(
    stale,
    [],
    `shared-exports.ts names exports a package no longer has. Run \`node scripts/generate-shared-exports.mjs\` and commit the result.`,
  )
})

test('the list covers the duplicated exports the #2120 survey found', () => {
  const owners = committedOwners()
  for (const name of [
    'median',
    'plural',
    'ordinal',
    'initials',
    'slugify',
    'formatNumber',
    'formatDate',
    'formatPercent',
    'sha256Hex',
    'apiError',
    'nonDocumentSecurityHeaders',
    'serializeNonDocumentCsp',
    'useStoredState',
    'useShare',
  ]) {
    assert.ok(owners[name]?.length, `${name} is a released export and must be listed`)
  }
})

test('the list holds only candidate names', () => {
  for (const name of Object.keys(committedOwners())) {
    assert.ok(isCandidateName(name), `${name} is short, SCREAMING_CASE or generic`)
    assert.ok(!GENERIC_NAMES.has(name))
  }
  assert.equal(isCandidateName('mean'), false)
  assert.equal(isCandidateName('DEFAULT_LIMIT'), false)
  assert.equal(isCandidateName('isRecord'), false)
  assert.equal(isCandidateName('median'), true)
})

test('tooling packages are not owners', () => {
  const { packages } = deriveSharedExports(repoRoot)
  for (const tooling of [
    'eslint-config',
    'create-narduk-app',
    'narduk-app-tools',
    'narduk-testkit',
  ]) {
    assert.ok(!packages.includes(tooling), `${tooling} is tooling, never a duplicate finding`)
  }
  assert.ok(packages.includes('narduk-core'))
})
