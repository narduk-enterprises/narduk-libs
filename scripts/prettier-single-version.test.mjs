import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { loadWorkspace } from './compute-affected-packages.mjs'

/**
 * narduk-libs#175: the root `format:check` resolved prettier 3.9.4 while every
 * package resolved 3.8.3 from its own `^3.8.3` devDependency, and the two
 * versions format a multi-member union differently — reproduced 2026-09-09 on
 * `type Fn = ((a: string) => void) | ((b: number) => void) | ...`, which 3.9.4
 * keeps on one line and 3.8.3 breaks onto `|` members. One of the two checks
 * was therefore always red on the same file. The root `pnpm.overrides` entry
 * pins one prettier for the whole workspace; this test fails if a second one
 * ever gets installed again.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

function resolvedPrettier(directory) {
  const require = createRequire(join(directory, 'package.json'))
  return {
    path: require.resolve('prettier'),
    version: require('prettier/package.json').version,
  }
}

test('root pnpm.overrides pins exactly one prettier version', () => {
  const rootManifest = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))
  const pinned = rootManifest.pnpm?.overrides?.prettier
  assert.ok(pinned, 'root package.json must pin prettier in pnpm.overrides')
  assert.match(pinned, /^\d+\.\d+\.\d+$/u, 'the prettier override must be an exact version')
  assert.equal(resolvedPrettier(repoRoot).version, pinned)
})

test('every workspace package that uses prettier resolves the root-pinned copy', () => {
  const root = resolvedPrettier(repoRoot)
  const workspace = loadWorkspace(repoRoot)
  const users = workspace.packages.filter(
    ({ manifest }) =>
      manifest.devDependencies?.prettier ||
      manifest.dependencies?.prettier ||
      Object.values(manifest.scripts ?? {}).some((script) => /(^|\s)prettier(\s|$)/u.test(script)),
  )
  assert.ok(users.length > 0, 'expected at least one package to use prettier')

  const mismatches = []
  for (const workspacePackage of users) {
    const resolved = resolvedPrettier(workspacePackage.directory)
    if (resolved.version !== root.version) {
      mismatches.push(`${workspacePackage.name}: ${resolved.version} (root ${root.version})`)
    }
  }
  assert.deepEqual(mismatches, [])
})
