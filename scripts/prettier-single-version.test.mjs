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

/**
 * The resolved-tree checks above only see what pnpm installed *inside this
 * workspace*, so they stay green while a published manifest declares a
 * different exact prettier — narduk-libs#210 review: create-narduk-app pinned
 * `3.8.3` while the override resolved `3.9.4`, which re-creates #175 one hop
 * out for anyone installing that manifest from its packed artifact. This check
 * reads the declared specifiers instead.
 *
 * `semver` is not a dependency of this workspace and #175 does not justify
 * adding one, so `satisfiedByPinned` is a deliberately narrow string/number
 * comparison over the exact, `^` and `~` forms this workspace actually
 * declares. Anything else is reported as unrecognised rather than assumed to
 * pass, so a range this function cannot reason about fails the guard instead of
 * slipping through it.
 */
const PRETTIER_SPECIFIER =
  /^(?<operator>[\^~]?)(?<version>(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+))$/u
const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies']

function parseSpecifier(value) {
  const match = PRETTIER_SPECIFIER.exec(value)
  if (!match?.groups) return undefined
  return {
    operator: match.groups.operator,
    version: match.groups.version,
    parts: [match.groups.major, match.groups.minor, match.groups.patch].map(Number),
  }
}

/** -1, 0 or 1 for `a` below, equal to, or above `b`. */
function comparePrecedence(a, b) {
  for (const [index, part] of a.entries()) {
    if (part !== b[index]) return part < b[index] ? -1 : 1
  }
  return 0
}

function satisfiedByPinned(declared, pinned) {
  const wanted = parseSpecifier(declared)
  const actual = parseSpecifier(pinned)
  if (!wanted || !actual) return false
  if (comparePrecedence(actual.parts, wanted.parts) < 0) return false

  const [wantedMajor, wantedMinor] = wanted.parts
  const [actualMajor, actualMinor] = actual.parts
  if (wanted.operator === '') return wanted.version === actual.version
  // `^0.x.y` is minor-locked in semver; prettier is on 3.x here, so the major
  // branch is the live one and the 0.x branch is stated rather than relied on.
  if (wanted.operator === '^') {
    return actualMajor === wantedMajor && (wantedMajor !== 0 || actualMinor === wantedMinor)
  }
  return actualMajor === wantedMajor && actualMinor === wantedMinor
}

test('every declared prettier specifier is satisfied by the single pinned version', () => {
  const rootManifest = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))
  const pinned = rootManifest.pnpm?.overrides?.prettier
  assert.ok(pinned, 'root package.json must pin prettier in pnpm.overrides')

  const workspace = loadWorkspace(repoRoot)
  const manifests = [
    { name: `${rootManifest.name} (root)`, manifest: rootManifest },
    ...workspace.packages.map(({ name, manifest }) => ({ name, manifest })),
  ]

  const declarations = []
  const mismatches = []
  for (const { name, manifest } of manifests) {
    for (const field of DEPENDENCY_FIELDS) {
      const declared = manifest[field]?.prettier
      if (typeof declared !== 'string') continue
      declarations.push(`${name} ${field}: ${declared}`)
      if (!satisfiedByPinned(declared, pinned)) {
        mismatches.push(`${name} ${field}: ${declared} is not satisfied by the pinned ${pinned}`)
      }
    }
  }

  assert.ok(declarations.length > 0, 'expected at least one declared prettier specifier')
  assert.deepEqual(mismatches, [])
})
