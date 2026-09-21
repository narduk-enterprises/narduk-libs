/**
 * `check:package`: the Explorer publishes nothing, so this checks what it does
 * ship instead, the prerendered site in `.output/public` (CI runs it after
 * `build`).
 *
 * - The manifest stays private and has no publish surface.
 * - Every catalog, demo and landing route has a prerendered page, so a route
 *   the crawler never reached cannot pass silently.
 * - No shipped file carries a private key, a registry auth token or an
 *   absolute build-machine path.
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadInventory } from '../inventory/index.mts'

const explorerRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = resolve(explorerRoot, '../../..')
const publicRoot = join(explorerRoot, '.output/public')

const manifest = JSON.parse(readFileSync(join(explorerRoot, 'package.json'), 'utf8'))
assert.equal(manifest.private, true, 'libs-explorer must stay private')
for (const field of ['files', 'exports', 'main', 'bin', 'publishConfig']) {
  assert.equal(manifest[field], undefined, `libs-explorer must not declare "${field}"`)
}

assert.ok(existsSync(publicRoot), `${publicRoot} is missing: run build first`)

const { inventory, problems } = loadInventory(repoRoot, explorerRoot)
assert.deepEqual(problems, [])
const routes = [
  '/',
  '/foundations',
  '/components',
  '/packages',
  ...inventory.packages.map(({ slug }) => `/packages/${slug}`),
  ...inventory.examples.map(({ id, category }) => `/${category}/${id}`),
]
const missing = routes.filter((route) => !existsSync(join(publicRoot, route, 'index.html')))
assert.deepEqual(missing, [], 'Routes with no prerendered page')

const FORBIDDEN: [RegExp, string][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'a private key'],
  [/_authToken\s*=/, 'a registry auth token'],
  [/\b(?:ghp|gho|ghs|github_pat)_[A-Za-z0-9_]{20,}/, 'a GitHub token'],
  [/\/(?:Users|home\/runner)\/[^\s"'<>]+/, 'an absolute build-machine path'],
]
const leaks: string[] = []
for (const entry of readdirSync(publicRoot, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile()) continue
  const file = join(entry.parentPath, entry.name)
  const text = readFileSync(file, 'utf8')
  for (const [pattern, what] of FORBIDDEN) {
    if (pattern.test(text)) leaks.push(`${file.slice(publicRoot.length)} contains ${what}`)
  }
}
assert.deepEqual(leaks, [], 'Shipped files leak material')

console.log(`check:package: ${routes.length} routes prerendered, no leaks found`)
