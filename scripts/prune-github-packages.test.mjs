import assert from 'node:assert/strict'
import test from 'node:test'

import { planPackage } from './prune-github-packages.mjs'

const v = (name, id, created_at) => ({ name, id, created_at })
const dist = (integrity) => ({ dist: { integrity } })

test('keeps dist-tags and the newest, deletes archived old versions', () => {
  const plan = planPackage({
    versions: [
      v('1.0.0', 1, '2026-01-01'),
      v('2.0.0', 2, '2026-02-01'),
      v('3.0.0-beta', 3, '2026-03-01'),
    ],
    distTags: { latest: '2.0.0' },
    upstreamVersions: {
      '1.0.0': dist('sha512-a'),
      '2.0.0': dist('sha512-b'),
      '3.0.0-beta': dist('sha512-c'),
    },
    mirrorVersions: {
      '1.0.0': dist('sha512-a'),
      '2.0.0': dist('sha512-b'),
      '3.0.0-beta': dist('sha512-c'),
    },
    mirrorTarballOk: () => true,
  })
  assert.deepEqual(
    plan.map((s) => [s.name, s.action]),
    [
      ['1.0.0', 'delete'],
      ['2.0.0', 'keep'],
      ['3.0.0-beta', 'keep'],
    ],
  )
})

test('never deletes a version the mirror lacks, differs on, or does not serve', () => {
  const plan = planPackage({
    versions: [
      v('0.1.0', 1, '2026-01-01'),
      v('0.2.0', 2, '2026-01-02'),
      v('0.3.0', 3, '2026-01-03'),
      v('1.0.0', 4, '2026-02-01'),
    ],
    distTags: { latest: '1.0.0' },
    upstreamVersions: {
      '0.1.0': dist('sha512-a'),
      '0.2.0': dist('sha512-b'),
      '0.3.0': dist('sha512-c'),
      '1.0.0': dist('sha512-d'),
    },
    mirrorVersions: {
      '0.2.0': dist('sha512-OTHER'),
      '0.3.0': dist('sha512-c'),
      '1.0.0': dist('sha512-d'),
    },
    mirrorTarballOk: (name) => name !== '0.3.0',
  })
  assert.deepEqual(
    plan.map((s) => [s.name, s.action, s.reason]),
    [
      ['0.1.0', 'skip', 'not on npm.nard.uk'],
      ['0.2.0', 'skip', 'integrity differs on npm.nard.uk'],
      ['0.3.0', 'skip', 'npm.nard.uk tarball not served'],
      ['1.0.0', 'keep', 'dist-tag or newest'],
    ],
  )
})
