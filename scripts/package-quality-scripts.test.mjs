import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

// A package's `quality` script is what "the package gate is green" means. It
// once ran `test:unit` alone, and one package had none, so a filtered
// `pnpm --filter <pkg> run quality` exited 0 having checked nothing
// (narduk-libs#666). Every workspace package with unit tests must define it,
// and it must run formatting, lint, types and the unit tests.
const REQUIRED_STEPS = ['format:check', 'lint', 'typecheck', 'test:unit']

function workspacePackages() {
  const found = []
  for (const group of readdirSync('packages')) {
    const groupDir = join('packages', group)
    for (const name of readdirSync(groupDir)) {
      const manifest = join(groupDir, name, 'package.json')
      if (existsSync(manifest)) found.push(manifest)
    }
  }
  return found
}

test('every workspace package with unit tests has a quality script that means quality', () => {
  const problems = []
  const manifests = workspacePackages()
  assert.ok(manifests.length > 20, `expected the workspace packages, found ${manifests.length}`)
  for (const manifest of manifests) {
    const scripts = JSON.parse(readFileSync(manifest, 'utf8')).scripts ?? {}
    if (!scripts['test:unit']) continue
    const quality = scripts.quality
    if (typeof quality !== 'string') {
      problems.push(`${manifest}: no quality script`)
      continue
    }
    const steps = new Set([...quality.matchAll(/pnpm run ([\w:-]+)/gu)].map((match) => match[1]))
    for (const step of REQUIRED_STEPS) {
      if (!steps.has(step)) problems.push(`${manifest}: quality does not run ${step}`)
      else if (!scripts[step])
        problems.push(`${manifest}: quality runs ${step}, which is undefined`)
    }
  }
  assert.deepEqual(problems, [])
})
