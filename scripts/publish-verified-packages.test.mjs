import assert from 'node:assert/strict'
import { test } from 'node:test'
import { publicationPlan, unresolvedGeneratorPins } from './publish-verified-packages.mjs'

const manifest = (version) => ({
  name: '@narduk-enterprises/example',
  version,
  publishConfig: { registry: 'https://npm.pkg.github.com' },
})
const records = (versions, latest) => ({ '@narduk-enterprises/example': { versions, latest } })

test('permits only new stable versions ahead of the registry latest tag', () => {
  const target = manifest('1.25.0')
  assert.deepEqual(publicationPlan([target], records(['1.24.0'], '1.24.0')), [target])
  assert.deepEqual(publicationPlan([target], records([], undefined)), [target])
  assert.deepEqual(publicationPlan([manifest('1.10.0')], records(['1.9.0'], '1.9.0')), [
    manifest('1.10.0'),
  ])
})

test('already-published ancestors are idempotent and never reset latest', () => {
  assert.deepEqual(
    publicationPlan([manifest('1.24.0')], records(['1.24.0', '1.25.0'], '1.25.0')),
    [],
  )
})

test('unknown metadata, foreign registries and unpublished downgrades refuse before publish', () => {
  for (const [packages, evidence] of [
    [[manifest('1.24.0')], records(['1.25.0'], '1.25.0')],
    [[manifest('1.25.0')], {}],
    [[manifest('1.25.0')], records('invalid', '1.24.0')],
    [[manifest('1.25.0')], records(['1.24.0'], undefined)],
    [[manifest('1.25.0-beta.1')], records([], undefined)],
    [
      [{ ...manifest('1.25.0'), publishConfig: { registry: 'https://example.com' } }],
      records([], undefined),
    ],
  ])
    assert.throws(() => publicationPlan(packages, evidence))
})

// narduk-libs#284: create-narduk-app pins other local packages' versions as
// string literals in its manifest.ts, invisible to changesets' own
// dependency graph. A pin is only safe to ship if the version it names is
// already live on the registry, or is publishing in this very batch --
// never on the hope that some later, separate release will catch up. `0.0.0`
// must not be flagged by itself: it is the correct pin pre-first-publish.
test('a pin already live on the registry is resolved', () => {
  const pins = new Map([['@narduk-enterprises/narduk-shell', '0.1.0']])
  const evidence = { '@narduk-enterprises/narduk-shell': { versions: ['0.1.0'], latest: '0.1.0' } }
  assert.deepEqual(unresolvedGeneratorPins(pins, [], evidence), [])
})

test('a pin publishing in the same batch at the pinned version is resolved', () => {
  const pins = new Map([['@narduk-enterprises/narduk-shell', '0.1.0']])
  const pending = [manifest('0.1.0')].map((m) => ({
    ...m,
    name: '@narduk-enterprises/narduk-shell',
  }))
  assert.deepEqual(unresolvedGeneratorPins(pins, pending, {}), [])
})

test('an unpublished pin with no matching pending release is unresolved, even at 0.0.0', () => {
  const pins = new Map([['@narduk-enterprises/narduk-shell', '0.0.0']])
  assert.deepEqual(unresolvedGeneratorPins(pins, [], {}), [
    '@narduk-enterprises/narduk-shell@0.0.0',
  ])
})

test('a pending release at a different version than the pin does not resolve it', () => {
  const pins = new Map([['@narduk-enterprises/narduk-shell', '0.1.0']])
  const pending = [{ name: '@narduk-enterprises/narduk-shell', version: '0.2.0' }]
  const evidence = { '@narduk-enterprises/narduk-shell': { versions: ['0.0.9'], latest: '0.0.9' } }
  assert.deepEqual(unresolvedGeneratorPins(pins, pending, evidence), [
    '@narduk-enterprises/narduk-shell@0.1.0',
  ])
})

test('multiple pins report only the ones that are actually unresolved', () => {
  const pins = new Map([
    ['@narduk-enterprises/narduk-core', '1.23.2'],
    ['@narduk-enterprises/narduk-shell', '0.0.0'],
  ])
  const evidence = {
    '@narduk-enterprises/narduk-core': { versions: ['1.23.2'], latest: '1.23.2' },
  }
  assert.deepEqual(unresolvedGeneratorPins(pins, [], evidence), [
    '@narduk-enterprises/narduk-shell@0.0.0',
  ])
})
