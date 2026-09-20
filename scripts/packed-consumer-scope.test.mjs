import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { loadWorkspace } from './compute-affected-packages.mjs'
import {
  consumerSmokeGeneratorPackage,
  generatedConsumerProofAvailable,
  generatedConsumerRequiredPackages,
  parsePackagesArgument,
  resolveConsumerScope,
  selectScopedPackages,
  workspaceDependencyClosure,
} from './packed-consumer-scope.mjs'
import { packedConsumerBuildArgs } from './prepare-packed-consumer.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const scope = '@narduk-enterprises/'

// A workspace shaped like loadWorkspace's return value, without touching disk.
// `leaf` is depended on by `mid`, which is depended on by `top`; `tool` is a
// private build helper standing between two publishable packages.
function workspace(definitions) {
  const packages = definitions.map(({ name, manifest = {} }) => ({
    name: `${scope}${name}`,
    manifest: { name: `${scope}${name}`, version: '1.0.0', ...manifest },
  }))
  return { packages, byName: new Map(packages.map((entry) => [entry.name, entry])) }
}

function dependency(...names) {
  return { dependencies: Object.fromEntries(names.map((name) => [`${scope}${name}`, '*'])) }
}

const sample = workspace([
  { name: 'leaf' },
  { name: 'tool', manifest: { private: true, ...dependency('leaf') } },
  { name: 'mid', manifest: dependency('tool') },
  { name: 'top', manifest: dependency('mid') },
  { name: 'unrelated' },
])

const publishable = ['leaf', 'mid', 'top', 'unrelated'].map((name) => `${scope}${name}`)

function resolve(overrides) {
  return resolveConsumerScope({
    mode: 'scoped',
    packedConsumer: true,
    generatedConsumer: false,
    fullRun: false,
    workspace: sample,
    consumerAffectedNames: new Set(),
    ...overrides,
  })
}

test('a scope is the affected packages plus their workspace dependency closure', () => {
  // `mid` reaches `leaf` only through the private `tool`, so the closure has to
  // traverse private packages even though it can never pack one: the external
  // consumer resolves an unpacked internal dependency from the registry, at a
  // version a pull request has not published.
  const result = resolve({ consumerAffectedNames: new Set([`${scope}mid`]) })
  assert.deepEqual(result.consumerScope, [`${scope}leaf`, `${scope}mid`])
  assert.match(result.consumerScopeReason, /scoped to 2 of 4/u)
})

test('dependents are not pulled in, only dependencies', () => {
  // `top` depends on `mid`; changing `mid` makes `top` an affected *dependent*,
  // and the caller passes both in. Changing `leaf` alone must not pack `mid`.
  assert.deepEqual(resolve({ consumerAffectedNames: new Set([`${scope}leaf`]) }).consumerScope, [
    `${scope}leaf`,
  ])
})

test('an unclassifiable repository path widens to every publishable package', () => {
  // The property that matters most: a planner that cannot classify a changed
  // path reports fullRun, and a scoping rule must widen there rather than
  // narrow. A rule that silently skips the package a pull request broke is
  // worse than no scoping at all.
  const result = resolve({ fullRun: true, consumerAffectedNames: new Set([`${scope}leaf`]) })
  assert.deepEqual(result.consumerScope, publishable)
  assert.match(result.consumerScopeReason, /full run/u)
})

test('the generated-app proof always packs every publishable package', () => {
  const result = resolve({
    generatedConsumer: true,
    consumerAffectedNames: new Set([`${scope}leaf`]),
  })
  assert.deepEqual(result.consumerScope, publishable)
})

test('full mode never narrows, whatever the diff reached', () => {
  assert.deepEqual(
    resolve({ mode: 'full', consumerAffectedNames: new Set([`${scope}leaf`]) }).consumerScope,
    publishable,
  )
})

test('a scope that selects nothing widens instead of proving nothing', () => {
  const result = resolve({ consumerAffectedNames: new Set([`${scope}missing`]) })
  assert.deepEqual(result.consumerScope, publishable)
})

test('no packed-artifact proof means no scope at all', () => {
  assert.deepEqual(resolve({ packedConsumer: false }).consumerScope, [])
})

test('an unknown scope mode is rejected rather than silently treated as full', () => {
  assert.throws(() => resolve({ mode: 'partial' }), /Unknown consumer scope mode/u)
})

test('the closure includes its seeds and terminates on a dependency cycle', () => {
  const cyclic = workspace([
    { name: 'a', manifest: dependency('b') },
    { name: 'b', manifest: dependency('a') },
  ])
  assert.deepEqual([...workspaceDependencyClosure([`${scope}a`], cyclic.byName)].sort(), [
    `${scope}a`,
    `${scope}b`,
  ])
})

test('selectScopedPackages fails closed on a package it cannot pack', () => {
  const packages = publishable.map((name) => ({ manifest: { name } }))
  assert.throws(
    () => selectScopedPackages(packages, [`${scope}leaf`, `${scope}ghost`]),
    /not publishable here: @narduk-enterprises\/ghost/u,
  )
  assert.throws(() => selectScopedPackages(packages, []), /at least one package/u)
  assert.throws(
    () => selectScopedPackages(packages, [`${scope}leaf`, `${scope}leaf`]),
    /must not repeat/u,
  )
})

test('parsePackagesArgument accepts both spellings and is absent by default', () => {
  assert.equal(parsePackagesArgument(['--dry-run', '--consumer-smoke']), undefined)
  assert.deepEqual(parsePackagesArgument(['--packages=a,b']), ['a', 'b'])
  assert.deepEqual(parsePackagesArgument(['--packages', 'a, b']), ['a', 'b'])
})

test('the generated-app proof needs the generator and every pin it asserts', () => {
  const complete = [consumerSmokeGeneratorPackage, ...generatedConsumerRequiredPackages]
  assert.equal(generatedConsumerProofAvailable(complete), true)
  for (const absent of complete) {
    assert.equal(
      generatedConsumerProofAvailable(complete.filter((name) => name !== absent)),
      false,
      `${absent} must be required for the generated-app proof`,
    )
  }
})

test('the build is given the same scope the pack is given', () => {
  const packages = [
    { manifest: { name: `${scope}leaf` } },
    { manifest: { name: `${scope}mid` } },
    { manifest: { name: `${scope}tool`, private: true } },
  ]
  const filters = (args) => args.filter((value) => value.startsWith('--filter='))
  assert.deepEqual(filters(packedConsumerBuildArgs(packages, '/cache', 2, [`${scope}leaf`])), [
    `--filter=${scope}leaf...`,
  ])
  // Unscoped stays every publishable package, private build helpers reached
  // through turbo's `...` rather than named here.
  assert.deepEqual(filters(packedConsumerBuildArgs(packages, '/cache', 2)), [
    `--filter=${scope}leaf...`,
    `--filter=${scope}mid...`,
  ])
  assert.throws(
    () => packedConsumerBuildArgs(packages, '/cache', 2, [`${scope}tool`]),
    /not publishable here/u,
  )
})

// --- The release path, which must never acquire a scope -------------------

test('release:consumer-smoke packs every package, with no scope flag', () => {
  // Asserted rather than inspected: a later refactor must not be able to
  // quietly scope the release path. `release:consumer-smoke` is what the
  // release workflow runs and what verify-release-ci.mjs's publication proof
  // stands on, so it has to keep packing the whole publishable set.
  const { scripts } = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))
  assert.equal(
    scripts['release:consumer-smoke'],
    'node scripts/release-packages.mjs --dry-run --consumer-smoke',
  )
  for (const [name, command] of Object.entries(scripts)) {
    if (!command.includes('release-packages.mjs')) continue
    assert.doesNotMatch(command, /--packages/u, `${name} must not carry a packed-consumer scope`)
  }
})

test('a push to main is planned unscoped; only a pull request scopes', () => {
  const workflow = readFileSync(join(repoRoot, '.github/workflows/ci.yml'), 'utf8')
  assert.match(workflow, /scope_mode=full/u)
  assert.match(
    workflow,
    /if \[ "\$\{EVENT_NAME\}" = "pull_request" \]; then\n\s+scope_mode=scoped/u,
  )
  assert.match(workflow, /--consumer-scope-mode "\$\{scope_mode\}"/u)
})

// --- Against the real workspace -------------------------------------------

test('the real workspace scopes an isolated package and widens shared tooling', () => {
  const real = loadWorkspace(repoRoot)
  const publishableCount = real.packages.filter(({ manifest }) => manifest.private !== true).length
  const mapkit = `${scope}narduk-mapkit`
  assert.ok(real.byName.has(mapkit), 'narduk-mapkit must exist for this test to mean anything')

  const scoped = resolveConsumerScope({
    mode: 'scoped',
    packedConsumer: true,
    generatedConsumer: false,
    fullRun: false,
    workspace: real,
    consumerAffectedNames: new Set([mapkit]),
  })
  assert.ok(scoped.consumerScope.includes(mapkit))
  assert.ok(
    scoped.consumerScope.length < publishableCount,
    'an isolated package must not pack the whole workspace',
  )

  // Shared tooling reaches the generated app, so it keeps the full proof.
  assert.equal(
    resolveConsumerScope({
      mode: 'scoped',
      packedConsumer: true,
      generatedConsumer: true,
      fullRun: true,
      workspace: real,
      consumerAffectedNames: new Set([mapkit]),
    }).consumerScope.length,
    publishableCount,
  )
})
