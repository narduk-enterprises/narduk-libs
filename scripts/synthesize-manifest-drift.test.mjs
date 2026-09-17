import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import getReleasePlan from '@changesets/get-release-plan'

import {
  DRIFT_SECTIONS,
  changesetPath,
  generatorFollowUp,
  interpretRegistryResult,
  manifestDrift,
  planDriftSynthesis,
  renderDriftChangeset,
  renderSynthesisSummary,
} from './synthesize-manifest-drift.mjs'

const generatorName = '@narduk-enterprises/create-narduk-app'

const testkit = {
  name: '@narduk-enterprises/narduk-testkit',
  version: '1.3.2',
  dependencies: { sharp: '^0.34.5' },
  devDependencies: { vitest: '^4.1.11' },
}

function record(manifest) {
  return { published: true, manifest }
}

test('drift is the difference between main and the published manifest', () => {
  // PR #324's shape after it merges: main says ^0.35.4, the published 1.3.2
  // tarball still says ^0.34.5, so consumers never get the fix without a
  // patch release.
  const drift = manifestDrift({ ...testkit, dependencies: { sharp: '^0.35.4' } }, testkit)
  assert.deepEqual(drift, [
    { section: 'dependencies', name: 'sharp', published: '^0.34.5', local: '^0.35.4' },
  ])
  assert.deepEqual(manifestDrift(testkit, testkit), [])
  // devDependencies are not a consumer's business and never drive a release.
  assert.deepEqual(
    manifestDrift({ ...testkit, devDependencies: { vitest: '^5.0.0' } }, testkit),
    [],
  )
  assert.deepEqual(
    [...DRIFT_SECTIONS],
    ['dependencies', 'peerDependencies', 'optionalDependencies'],
  )
})

test('a workspace: specifier is never drift', () => {
  // pnpm rewrites `workspace:*` to the exact version when it packs, so a
  // literal comparison would synthesize a release on every single run.
  const local = {
    ...testkit,
    dependencies: { '@narduk-enterprises/narduk-platform': 'workspace:*', sharp: '^0.34.5' },
  }
  const published = {
    ...testkit,
    dependencies: { '@narduk-enterprises/narduk-platform': '2.1.0', sharp: '^0.34.5' },
  }
  assert.deepEqual(manifestDrift(local, published), [])
})

test('an added, removed or peer-range drift is reported across every section', () => {
  const drift = manifestDrift(
    {
      dependencies: { sharp: '^0.34.5', zod: '^4.4.3' },
      peerDependencies: { vue: '>=3.6.0' },
      optionalDependencies: {},
    },
    {
      dependencies: { sharp: '^0.34.5' },
      peerDependencies: { vue: '>=3.5.0' },
      optionalDependencies: { fsevents: '^2.3.3' },
    },
  )
  assert.deepEqual(drift, [
    { section: 'dependencies', name: 'zod', published: undefined, local: '^4.4.3' },
    { section: 'peerDependencies', name: 'vue', published: '>=3.5.0', local: '>=3.6.0' },
    {
      section: 'optionalDependencies',
      name: 'fsevents',
      published: '^2.3.3',
      local: undefined,
    },
  ])
})

test('a pending publication is never delayed by synthesis', () => {
  // Right after a version PR merges, main carries versions that are not on
  // the registry yet. Writing a changeset then would flip the Changesets
  // action off its publish path.
  const plan = planDriftSynthesis({
    packages: [
      {
        name: testkit.name,
        version: '1.3.3',
        manifest: { ...testkit, dependencies: { sharp: '^0.35.4' } },
      },
    ],
    covered: [],
    registryRecords: new Map([[testkit.name, { published: false }]]),
  })
  assert.deepEqual(plan.releases, [])
  assert.match(plan.skipped, /not published yet: @narduk-enterprises\/narduk-testkit@1\.3\.3/u)
})

test('a package a pending changeset already releases is skipped', () => {
  const packages = [
    {
      name: testkit.name,
      version: '1.3.2',
      manifest: { ...testkit, dependencies: { sharp: '^0.35.4' } },
    },
  ]
  const registryRecords = new Map([[testkit.name, record(testkit)]])

  assert.deepEqual(
    planDriftSynthesis({ packages, covered: [testkit.name], registryRecords }).releases,
    [],
  )
  const plan = planDriftSynthesis({ packages, covered: [], registryRecords })
  assert.equal(plan.releases.length, 1)
  assert.equal(
    plan.releases[0].path,
    '.changeset/auto-manifest-narduk-enterprises-narduk-testkit.md',
  )
})

test('a covered drift is reported as covered, not as no drift', () => {
  // The run after synthesis writes a Changeset -- and any run where a human
  // Changeset already covers the drifted package -- has nothing to write. It
  // used to print "Every published package manifest matches main", which is
  // false: the manifests still drift, they are just already being released.
  const packages = [
    {
      name: testkit.name,
      version: '1.3.2',
      manifest: { ...testkit, dependencies: { sharp: '^0.35.4' } },
    },
  ]
  const registryRecords = new Map([[testkit.name, record(testkit)]])

  const plan = planDriftSynthesis({ packages, covered: [testkit.name], registryRecords })
  assert.deepEqual(plan.releases, [])
  assert.deepEqual(plan.covered, [testkit.name])
  assert.match(
    renderSynthesisSummary(plan.covered),
    /a pending Changeset already releases 1 drifted package\(s\): @narduk-enterprises\/narduk-testkit\.$/mu,
  )

  // A covered package that does not drift is not reported either way.
  const clean = planDriftSynthesis({
    packages: [{ name: testkit.name, version: '1.3.2', manifest: testkit }],
    covered: [testkit.name],
    registryRecords,
  })
  assert.deepEqual(clean.covered, [])
  assert.equal(
    renderSynthesisSummary(clean.covered),
    'Every published package manifest matches main.\n',
  )

  // Skipping for a pending publication still reports nothing as covered.
  assert.deepEqual(
    planDriftSynthesis({
      packages: [{ name: testkit.name, version: '9.9.9', manifest: testkit }],
      covered: [],
      registryRecords: new Map([[testkit.name, { published: false }]]),
    }).covered,
    [],
  )
})

test('the generator is released only when synthesis itself moved a pin', () => {
  const pinnedNames = new Set([testkit.name])
  assert.deepEqual(
    generatorFollowUp({
      plannedNames: [testkit.name],
      pinnedNames,
      synthesizedNames: [testkit.name],
    }),
    {
      name: generatorName,
      path: changesetPath(generatorName),
      body: [
        '---',
        `'${generatorName}': patch`,
        '---',
        '',
        `Repin the generator to the versions released for published manifest drift: ${testkit.name}.`,
        '',
      ].join('\n'),
    },
  )
  // Nothing synthesized: a human plan is never amended by this script.
  assert.equal(
    generatorFollowUp({ plannedNames: [testkit.name], pinnedNames, synthesizedNames: [] }),
    undefined,
  )
  // The generator is already releasing, or no pin moved.
  assert.equal(
    generatorFollowUp({
      plannedNames: [testkit.name, generatorName],
      pinnedNames,
      synthesizedNames: [testkit.name],
    }),
    undefined,
  )
  assert.equal(
    generatorFollowUp({
      plannedNames: ['@narduk-enterprises/unpinned'],
      pinnedNames,
      synthesizedNames: ['@narduk-enterprises/unpinned'],
    }),
    undefined,
  )
})

test('a registry read that is neither a manifest nor a clean 404 fails the release', () => {
  assert.deepEqual(
    interpretRegistryResult({ status: 0, stdout: JSON.stringify(testkit) }, testkit.name, '1.3.2'),
    {
      published: true,
      manifest: testkit,
    },
  )
  assert.deepEqual(
    interpretRegistryResult(
      { status: 1, stdout: JSON.stringify({ error: { code: 'E404' } }) },
      testkit.name,
      '9.9.9',
    ),
    { published: false },
  )
  for (const [label, result, version] of [
    ['auth failure', { status: 1, stdout: JSON.stringify({ error: { code: 'E401' } }) }, '1.3.2'],
    ['unparseable body', { status: 0, stdout: 'not json' }, '1.3.2'],
    ['empty body', { status: 1, stdout: '' }, '1.3.2'],
    ['wrong version', { status: 0, stdout: JSON.stringify(testkit) }, '1.3.3'],
  ]) {
    assert.throws(
      () => interpretRegistryResult(result, testkit.name, version),
      /Registry metadata for @narduk-enterprises\/narduk-testkit/u,
      label,
    )
  }
  assert.throws(
    () => interpretRegistryResult({ error: new Error('spawn failed') }, testkit.name, '1.3.2'),
    /spawn failed/u,
  )
})

test('a synthesized changeset is one Changesets itself assembles into a patch', async () => {
  // The file is only useful if `changeset version` consumes it, so parse it
  // back with the real assembler rather than asserting on its text.
  const root = mkdtempSync(join(tmpdir(), 'narduk-drift-'))
  try {
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n')
    writeFileSync(
      join(root, 'package.json'),
      `${JSON.stringify({ name: 'fixture-root', private: true, version: '0.0.0' }, null, 2)}\n`,
    )
    mkdirSync(join(root, '.changeset'))
    writeFileSync(
      join(root, '.changeset', 'config.json'),
      `${JSON.stringify({ changelog: false, commit: false, baseBranch: 'main', updateInternalDependencies: 'patch' }, null, 2)}\n`,
    )
    mkdirSync(join(root, 'packages', 'narduk-testkit'), { recursive: true })
    writeFileSync(
      join(root, 'packages', 'narduk-testkit', 'package.json'),
      `${JSON.stringify(testkit, null, 2)}\n`,
    )

    const drift = manifestDrift({ ...testkit, dependencies: { sharp: '^0.35.4' } }, testkit)
    writeFileSync(
      join(root, changesetPath(testkit.name)),
      renderDriftChangeset(testkit.name, drift),
    )
    assert.deepEqual(readdirSync(join(root, '.changeset')).sort(), [
      'auto-manifest-narduk-enterprises-narduk-testkit.md',
      'config.json',
    ])

    const plan = await getReleasePlan(root)
    assert.deepEqual(
      plan.releases
        .filter((release) => release.type !== 'none')
        .map(({ name, type, oldVersion, newVersion }) => ({ name, type, oldVersion, newVersion })),
      [{ name: testkit.name, type: 'patch', oldVersion: '1.3.2', newVersion: '1.3.3' }],
    )
    assert.match(plan.changesets[0].summary, /dependencies\.sharp`: \^0\.34\.5 -> \^0\.35\.4/u)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
