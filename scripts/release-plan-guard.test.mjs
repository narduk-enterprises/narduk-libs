import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import {
  DEFERRED_DEPENDENCY_FIELDS,
  DEV_ONLY_MANIFEST_FIELDS,
  PUBLISH_LIFECYCLE_SCRIPTS,
  SUGGESTED_CHANGESET_PATH,
  classifyChangedPackages,
  classifyManifestChange,
  ignoredPackageNames,
  publishLifecycleScriptKeys,
  renderGuardReport,
  renderSuggestedChangeset,
} from './release-plan-guard.mjs'

const packages = [
  {
    name: '@narduk-enterprises/narduk-testkit',
    relativeDirectory: 'packages/tooling/narduk-testkit',
  },
  {
    name: '@narduk-enterprises/narduk-app-tools',
    relativeDirectory: 'packages/tooling/narduk-app-tools',
  },
  { name: '@narduk-enterprises/narduk-charts', relativeDirectory: 'packages/design/narduk-charts' },
  {
    name: '@narduk-enterprises/design-system-build',
    relativeDirectory: 'packages/design/design-system-build',
    private: true,
  },
]

const baseManifest = {
  name: '@narduk-enterprises/narduk-testkit',
  version: '1.3.2',
  main: './dist/index.js',
  exports: { '.': './dist/index.js' },
  files: ['dist'],
  scripts: { build: 'tsc', 'test:unit': 'vitest run' },
  dependencies: { sharp: '^0.34.5' },
  devDependencies: { vitest: '^4.1.6' },
  peerDependencies: { vue: '>=3.5.0' },
}

function classifyOne(
  after,
  { changedFiles = [], workspacePackages = packages, before = baseManifest } = {},
) {
  return classifyChangedPackages({
    packages: workspacePackages,
    changedFiles: ['packages/tooling/narduk-testkit/package.json', ...changedFiles],
    readManifests: () => ({ before, after }),
  })[0]
}

test('a devDependency-only bump across the whole workspace needs no changeset', () => {
  // PR #323's shape: vitest 4.1.6 -> 4.1.11 in 26 package manifests and the
  // root manifest, which `changeset status` failed as "changed but no
  // changesets were found" (run 35173069724).
  const changedFiles = [
    'package.json',
    'pnpm-lock.yaml',
    ...packages.map(({ relativeDirectory }) => `${relativeDirectory}/package.json`),
  ]
  const entries = classifyChangedPackages({
    packages,
    changedFiles,
    readManifests: () => ({
      before: baseManifest,
      after: { ...baseManifest, devDependencies: { vitest: '^4.1.11' } },
    }),
  })

  assert.equal(entries.length, packages.length)
  assert.deepEqual([...new Set(entries.map((entry) => entry.verdict))], ['ok'])
  const report = renderGuardReport(entries, [])
  assert.equal(report.ok, true)
  assert.match(report.text, /need no release/u)
  // The root manifest and the lockfile belong to no workspace package.
  assert.equal(
    entries.some((entry) => entry.otherFiles.length > 0),
    false,
  )
})

test('a runtime dependency range bump is deferred to release-time synthesis', () => {
  // PR #324's shape: sharp 0.34.5 -> 0.35.4 in `dependencies`.
  const entry = classifyOne({ ...baseManifest, dependencies: { sharp: '^0.35.4' } })
  assert.equal(entry.verdict, 'deferred')
  assert.deepEqual(entry.manifest.deferred, [{ field: 'dependencies', keys: ['sharp'] }])

  const report = renderGuardReport([entry], [])
  assert.equal(report.ok, true)
  assert.match(report.text, /patch-releases them from registry drift/u)
  assert.match(report.text, /narduk-testkit: dependencies \(sharp\)/u)
})

test('an all-deferred report does not claim zero packages were settled', () => {
  // Every changed package deferred used to print "0 changed package(s) are
  // already released by a Changeset or need no release", which reads as if the
  // check examined nothing. The deferred block above it already says what
  // happened.
  const entry = classifyOne({ ...baseManifest, dependencies: { sharp: '^0.35.4' } })
  assert.equal(entry.verdict, 'deferred')

  const report = renderGuardReport([entry], [])
  assert.equal(report.ok, true)
  assert.match(report.text, /^1 changed package\(s\) only moved runtime dependency ranges/u)
  assert.doesNotMatch(report.text, /^0 changed package\(s\)/mu)
  assert.equal(report.text.trimEnd().split('\n').length, 2)

  // A settled package alongside a deferred one still gets its own line.
  const settled = classifyOne(baseManifest, { workspacePackages: packages })
  assert.match(
    renderGuardReport([entry, settled], []).text,
    /^1 changed package\(s\) are already released by a Changeset or need no release\.$/mu,
  )
})

test('a deferred verdict is only sound while the release workflow synthesizes the changeset', () => {
  // `deferred` lets a package merge without a Changeset because the release
  // job writes one from registry drift. If that step ever leaves release.yml,
  // the guard would be silently waiving releases.
  const workflow = readFileSync(
    new URL('../.github/workflows/release.yml', import.meta.url),
    'utf8',
  )
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

  assert.equal(
    manifest.scripts['release:synthesize-drift'],
    'node scripts/synthesize-manifest-drift.mjs',
  )
  assert.match(workflow, /run: pnpm run release:synthesize-drift/u)
  assert.match(workflow, /if: steps\.main-state\.outputs\.current == 'true'/u)

  const synthesisAt = workflow.indexOf('pnpm run release:synthesize-drift')
  const modeAt = workflow.indexOf('id: release-mode')
  const actionAt = workflow.indexOf('uses: changesets/action@')
  assert.ok(synthesisAt > 0 && modeAt > synthesisAt && actionAt > modeAt)
})

test('added, removed and workspace-linked runtime dependencies still need a changeset', () => {
  for (const [label, after] of [
    ['added', { ...baseManifest, dependencies: { sharp: '^0.34.5', zod: '^4.4.3' } }],
    ['removed', { ...baseManifest, dependencies: {} }],
    [
      'workspace-linked',
      {
        ...baseManifest,
        dependencies: { sharp: '^0.34.5', '@narduk-enterprises/narduk-platform': 'workspace:*' },
      },
    ],
  ]) {
    const entry = classifyOne(after)
    assert.equal(entry.verdict, 'needs-changeset', label)
    assert.equal(entry.manifest.releaseRelevant[0].field, 'dependencies', label)
  }

  // Moving an existing range onto the catalog is a range-only change by the
  // letter of the rule, but pnpm resolves `catalog:` at pack time, so
  // release-time drift synthesis can never see it. Deferring it would owe a
  // release nothing ever writes.
  const catalogued = classifyOne({ ...baseManifest, dependencies: { sharp: 'catalog:' } })
  assert.equal(catalogued.verdict, 'needs-changeset')
  assert.deepEqual(catalogued.manifest.releaseRelevant, [
    {
      field: 'dependencies',
      keys: ['sharp'],
      reason: 'workspace- or catalog-linked dependency',
    },
  ])
  assert.deepEqual(catalogued.manifest.deferred, [])
})

test('a peer dependency range is a semver decision a human makes', () => {
  const entry = classifyOne({ ...baseManifest, peerDependencies: { vue: '>=4.0.0' } })
  assert.equal(entry.verdict, 'needs-changeset')
  assert.equal(
    DEFERRED_DEPENDENCY_FIELDS.includes('peerDependencies'),
    false,
    'peerDependencies must never be auto-patched',
  )
})

test('published-surface manifest fields need a changeset', () => {
  for (const after of [
    { ...baseManifest, exports: { '.': './dist/other.js' } },
    { ...baseManifest, main: './dist/other.js' },
    { ...baseManifest, files: ['dist', 'bin'] },
    { ...baseManifest, bin: { narduk: './bin/cli.mjs' } },
    { ...baseManifest, version: '1.3.3' },
    { ...baseManifest, private: true },
    { ...baseManifest, publishConfig: { registry: 'https://example.invalid' } },
  ]) {
    assert.equal(classifyOne(after).verdict, 'needs-changeset')
  }
})

test('an unknown manifest field is release-relevant, not silently exempt', () => {
  const entry = classifyOne({ ...baseManifest, someFutureNpmField: { enabled: true } })
  assert.equal(entry.verdict, 'needs-changeset')
  assert.equal(entry.manifest.releaseRelevant[0].field, 'someFutureNpmField')
  assert.deepEqual([...DEV_ONLY_MANIFEST_FIELDS], ['devDependencies', 'scripts'])
})

test('publish and install lifecycle scripts are release-relevant; other scripts are not', () => {
  for (const key of PUBLISH_LIFECYCLE_SCRIPTS) {
    const entry = classifyOne({
      ...baseManifest,
      scripts: { ...baseManifest.scripts, [key]: 'node ./tools/changed.mjs' },
    })
    assert.equal(entry.verdict, 'needs-changeset', key)
    assert.equal(entry.manifest.releaseRelevant[0].reason, 'publish lifecycle script', key)
  }

  const entry = classifyOne({
    ...baseManifest,
    scripts: { ...baseManifest.scripts, 'test:unit': 'vitest run --coverage' },
  })
  assert.equal(entry.verdict, 'ok')
  assert.deepEqual(entry.manifest.devOnly, [{ field: 'scripts', keys: ['test:unit'] }])
})

test('a script the packing lifecycle reaches is release-relevant, however it is spelled', () => {
  // `prebuild` runs before `build`, which every packing lifecycle script in
  // this workspace delegates to; seven packages define it. narduk-timeseries'
  // goes one hop further (`... && pnpm run deps:build`). Both change the
  // packed artifact, and the literal lifecycle list named neither.
  const manifest = {
    ...baseManifest,
    scripts: {
      ...baseManifest.scripts,
      prebuild: 'node scripts/clean-dist.mjs && pnpm run deps:build',
      'deps:build': 'pnpm --filter @narduk-enterprises/narduk-postgres run build',
    },
  }

  for (const key of ['prebuild', 'deps:build']) {
    const entry = classifyOne(
      { ...manifest, scripts: { ...manifest.scripts, [key]: 'node ./tools/changed.mjs' } },
      { before: manifest },
    )
    assert.equal(entry.verdict, 'needs-changeset', key)
    assert.deepEqual(entry.manifest.releaseRelevant, [
      { field: 'scripts', keys: [key], reason: 'publish lifecycle script' },
    ])
  }

  // Removing the delegation is the same change seen from the other side.
  const removed = classifyOne({ ...manifest, scripts: baseManifest.scripts }, { before: manifest })
  assert.equal(removed.verdict, 'needs-changeset')
  assert.deepEqual(removed.manifest.releaseRelevant, [
    { field: 'scripts', keys: ['deps:build', 'prebuild'], reason: 'publish lifecycle script' },
  ])

  // A script nothing published reaches stays dev-only even next to them.
  const unreached = classifyOne(
    { ...manifest, scripts: { ...manifest.scripts, 'test:unit': 'vitest run --coverage' } },
    { before: manifest },
  )
  assert.equal(unreached.verdict, 'ok')
  assert.deepEqual(unreached.manifest.devOnly, [{ field: 'scripts', keys: ['test:unit'] }])

  assert.equal(publishLifecycleScriptKeys(manifest.scripts).has('deps:build'), true)
  assert.equal(publishLifecycleScriptKeys(manifest.scripts).has('test:unit'), false)
  // Reachability is per manifest: the same key is dev-only where nothing runs it.
  assert.equal(publishLifecycleScriptKeys({ 'deps:build': 'tsc' }).has('deps:build'), false)
})

test('reordering a manifest is not a change', () => {
  const entry = classifyOne({
    ...baseManifest,
    dependencies: { sharp: '^0.34.5' },
    devDependencies: { vitest: '^4.1.6' },
    exports: { '.': './dist/index.js' },
  })
  assert.equal(entry.verdict, 'ok')
  assert.deepEqual(entry.manifest, { devOnly: [], deferred: [], releaseRelevant: [] })
})

test('any non-manifest file under a package keeps the original requirement', () => {
  const entry = classifyOne(baseManifest, {
    changedFiles: ['packages/tooling/narduk-testkit/src/index.ts'],
  })
  assert.equal(entry.verdict, 'needs-changeset')

  const failing = renderGuardReport([entry], [])
  assert.equal(failing.ok, false)
  assert.match(failing.text, /src\/index\.ts changed/u)

  const covered = renderGuardReport([entry], ['@narduk-enterprises/narduk-testkit'])
  assert.equal(covered.ok, true)
})

test('a private package is never published, so a range change owes no release', () => {
  const entries = classifyChangedPackages({
    packages,
    changedFiles: ['packages/design/design-system-build/package.json'],
    readManifests: () => ({
      before: baseManifest,
      after: { ...baseManifest, dependencies: { sharp: '^0.35.4' } },
    }),
  })
  assert.equal(entries[0].name, '@narduk-enterprises/design-system-build')
  assert.equal(entries[0].verdict, 'ok')
})

test('a frozen package owes no changeset however much of it changed', () => {
  // `@narduk-enterprises/narduk-mapkit-nuxt` is frozen at 2.0.x in
  // `.changeset/config.json`'s `ignore`. Its source on main is the 2.1
  // contract, which the guard read as four changed files owing a patch
  // release -- but a Changeset naming an ignored package makes
  // `changeset version` throw instead of releasing it, so the only
  // satisfiable answer was to un-freeze it and publish a false 2.0.7.
  const frozenPackages = [
    ...packages,
    {
      name: '@narduk-enterprises/narduk-mapkit-nuxt',
      relativeDirectory: 'packages/modules/narduk-mapkit-nuxt',
      frozen: true,
    },
  ]
  const changedFiles = [
    'packages/modules/narduk-mapkit-nuxt/src/runtime/server/mapkit-token.get.ts',
    'packages/modules/narduk-mapkit-nuxt/test/nuxt.test.ts',
  ]

  const entries = classifyChangedPackages({
    packages: frozenPackages,
    changedFiles,
    readManifests: () => ({ before: baseManifest, after: baseManifest }),
  })
  assert.equal(entries[0].name, '@narduk-enterprises/narduk-mapkit-nuxt')
  assert.equal(entries[0].verdict, 'frozen')
  assert.equal(entries[0].frozen, true)

  // The report passes, names the package, and does not count it as settled.
  const report = renderGuardReport(entries, [])
  assert.equal(report.ok, true)
  assert.match(
    report.text,
    /1 changed package\(s\) are frozen in the Changesets `ignore` list and release nothing:/u,
  )
  assert.match(report.text, /- @narduk-enterprises\/narduk-mapkit-nuxt: .*mapkit-token\.get\.ts/u)
  assert.doesNotMatch(report.text, /need a Changeset/u)
  assert.doesNotMatch(report.text, /are already released by a Changeset/u)

  // The same diff on the same package, not frozen, still owes a Changeset.
  const unfrozen = classifyChangedPackages({
    packages: frozenPackages.map((entry) => ({ ...entry, frozen: false })),
    changedFiles,
    readManifests: () => ({ before: baseManifest, after: baseManifest }),
  })
  assert.equal(unfrozen[0].verdict, 'needs-changeset')
  assert.equal(renderGuardReport(unfrozen, []).ok, false)
})

test('a frozen package reported for a dev-only change still names a reason', () => {
  // Every other verdict reaches the report with at least one non-devOnly
  // reason, so the reason list used to end at the colon here.
  const entry = classifyChangedPackages({
    packages: [
      {
        name: '@narduk-enterprises/narduk-testkit',
        relativeDirectory: 'packages/tooling/narduk-testkit',
        frozen: true,
      },
    ],
    changedFiles: ['packages/tooling/narduk-testkit/package.json'],
    readManifests: () => ({
      before: baseManifest,
      after: { ...baseManifest, devDependencies: { vitest: '^4.1.11' } },
    }),
  })[0]
  assert.equal(entry.verdict, 'frozen')
  assert.match(renderGuardReport([entry], []).text, /- @narduk-enterprises\/narduk-testkit: \S/u)
})

test('the frozen list is the one Changesets reads', () => {
  assert.deepEqual(ignoredPackageNames({ ignore: ['a', 'b'] }), ['a', 'b'])
  assert.deepEqual(ignoredPackageNames({ ignore: [] }), [])
  assert.deepEqual(ignoredPackageNames({}), [])
  assert.deepEqual(ignoredPackageNames(undefined), [])
  // A non-array `ignore` is malformed config, not an excuse to throw here;
  // Changesets' own schema rejects it.
  assert.deepEqual(ignoredPackageNames({ ignore: 'not-an-array' }), [])

  const config = JSON.parse(
    readFileSync(new URL('../.changeset/config.json', import.meta.url), 'utf8'),
  )
  assert.ok(
    ignoredPackageNames(config).includes('@narduk-enterprises/narduk-mapkit-nuxt'),
    'narduk-mapkit-nuxt must stay frozen until a release path that pins published core 2.0.2 exists',
  )
})

test('the failure prints the exact changeset file to add', () => {
  const entry = classifyOne(baseManifest, {
    changedFiles: ['packages/tooling/narduk-testkit/src/index.ts'],
  })
  const report = renderGuardReport([entry], [])
  assert.equal(report.ok, false)
  assert.match(report.text, new RegExp(`Add ${SUGGESTED_CHANGESET_PATH.replace('.', '\\.')}`, 'u'))
  assert.ok(
    report.text.includes(
      [
        '---',
        "'@narduk-enterprises/narduk-testkit': patch",
        '---',
        '',
        'Describe the change these packages release.',
        '',
      ].join('\n'),
    ),
  )
})

test('a suggested changeset lists every uncovered package once, sorted', () => {
  assert.equal(
    renderSuggestedChangeset(['@scope/b', '@scope/a', '@scope/b'], 'Summary.'),
    "---\n'@scope/a': patch\n'@scope/b': patch\n---\n\nSummary.\n",
  )
})

test('an added or removed manifest is always a release decision', () => {
  assert.equal(classifyManifestChange(undefined, baseManifest).releaseRelevant[0].reason, 'added')
  assert.equal(classifyManifestChange(baseManifest, undefined).releaseRelevant[0].reason, 'removed')
  assert.deepEqual(classifyManifestChange(undefined, undefined), {
    devOnly: [],
    deferred: [],
    releaseRelevant: [],
  })
})
