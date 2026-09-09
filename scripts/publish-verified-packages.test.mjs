import assert from 'node:assert/strict'
import { test } from 'node:test'
import { publicationPlan } from './publish-verified-packages.mjs'

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
