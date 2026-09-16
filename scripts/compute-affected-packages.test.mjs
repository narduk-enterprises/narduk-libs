import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { computeAffectedSet, loadWorkspace } from './compute-affected-packages.mjs'
import { packageJobs } from './ci-package-plan.mjs'

const scope = '@narduk-enterprises/'
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function createWorkspace(packageDefinitions) {
  const root = mkdtempSync(join(tmpdir(), 'narduk-libs-affected-test-'))
  mkdirSync(join(root, 'packages'))
  writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - "packages/*"\n')

  for (const definition of packageDefinitions) {
    const directory = join(root, 'packages', definition.directory)
    mkdirSync(directory)
    writeJson(join(directory, 'package.json'), {
      name: `${scope}${definition.directory}`,
      version: '1.0.0',
      ...(definition.manifest || {}),
    })
  }
  return root
}

function names(result) {
  return result.affectedNames.map((name) => name.replace(scope, ''))
}

test('browser suites follow the affected dependency graph and declared scripts', () => {
  const root = createWorkspace([
    { directory: 'base' },
    {
      directory: 'charts',
      manifest: {
        dependencies: { [`${scope}base`]: 'workspace:*' },
        scripts: { 'test:e2e': 'playwright test' },
      },
    },
    { directory: 'journeys', manifest: { scripts: { 'test:e2e': 'node tests/web.mjs' } } },
  ])
  try {
    assert.deepEqual(
      computeAffectedSet({ root, changedFiles: ['packages/base/index.ts'] }).browserPackages,
      [`${scope}charts`],
    )
    assert.deepEqual(
      computeAffectedSet({ root, changedFiles: [], forceAll: true }).browserPackages,
      [`${scope}charts`, `${scope}journeys`],
    )
    assert.deepEqual(computeAffectedSet({ root, changedFiles: ['README.md'] }).browserPackages, [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('builds the dependency graph from every workspace dependency section', () => {
  const root = createWorkspace([
    { directory: 'base' },
    {
      directory: 'runtime-dependent',
      manifest: { dependencies: { [`${scope}base`]: 'workspace:*' } },
    },
    {
      directory: 'dev-dependent',
      manifest: { devDependencies: { [`${scope}base`]: 'workspace:*' } },
    },
    {
      directory: 'peer-dependent',
      manifest: { peerDependencies: { [`${scope}base`]: '>=1' } },
    },
    {
      directory: 'optional-dependent',
      manifest: { optionalDependencies: { [`${scope}base`]: 'workspace:*' } },
    },
  ])

  try {
    const workspace = loadWorkspace(root)
    assert.deepEqual([...workspace.dependents.get(`${scope}base`)].sort(), [
      `${scope}dev-dependent`,
      `${scope}optional-dependent`,
      `${scope}peer-dependent`,
      `${scope}runtime-dependent`,
    ])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('selects a changed dependency and all transitive dependents', () => {
  const root = createWorkspace([
    { directory: 'platform' },
    {
      directory: 'core',
      manifest: { dependencies: { [`${scope}platform`]: 'workspace:*' } },
    },
    {
      directory: 'auth',
      manifest: { dependencies: { [`${scope}core`]: 'workspace:*' } },
    },
    { directory: 'leaf' },
  ])

  try {
    const result = computeAffectedSet({
      root,
      changedFiles: ['packages/platform/src/index.ts'],
    })
    assert.deepEqual(names(result), ['auth', 'core', 'platform'])
    assert.deepEqual(result.skippedNames, [`${scope}leaf`])
    assert.equal(result.fullRun, false)
    assert.equal(result.packedConsumer, true)
    assert.equal(result.batches.length, 3)
    assert.deepEqual(result.packageJobs, [
      { label: 'auth', filter: '', 'extra-scripts': 'ci:batch', packages: [`${scope}auth`] },
      { label: 'core', filter: '', 'extra-scripts': 'ci:batch', packages: [`${scope}core`] },
      {
        label: 'platform',
        filter: '',
        'extra-scripts': 'ci:batch',
        packages: [`${scope}platform`],
      },
    ])
    assert.equal(
      computeAffectedSet({ root, changedFiles: ['packages/platform/src/index.ts'], batchCount: 1 })
        .batches.length,
      1,
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the hosted plan requires unique library filters and gives each one its own job', () => {
  assert.throws(
    () =>
      packageJobs([
        { label: 'first', filter: 'same' },
        { label: 'second', filter: 'same' },
      ]),
    /duplicates/u,
  )
  const result = computeAffectedSet({ root: repoRoot, changedFiles: [], forceAll: true })
  assert.equal(result.packageJobs.length, result.matrix.length)
  assert.ok(result.packageJobs.length > 1)
  assert.deepEqual(
    result.packageJobs.map(({ label, packages }) => ({ label, packages })),
    result.matrix.map(({ label, filter }) => ({ label, packages: [filter] })),
  )
})

test('does not select dependencies of a changed dependent', () => {
  const root = createWorkspace([
    { directory: 'platform' },
    {
      directory: 'core',
      manifest: { dependencies: { [`${scope}platform`]: 'workspace:*' } },
    },
  ])

  try {
    const result = computeAffectedSet({
      root,
      changedFiles: ['packages/core/src/module.ts'],
    })
    assert.deepEqual(names(result), ['core'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('global trigger files fan out to the full workspace and require packed proof', () => {
  const root = createWorkspace([{ directory: 'one' }, { directory: 'two' }])
  const triggers = [
    'package.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'tsconfig.json',
    'eslint.config.mjs',
    'turbo.json',
    '.github/workflows/ci.yml',
    'scripts/shared-build.mjs',
    'tools/package-quality.mjs',
  ]

  try {
    for (const trigger of triggers) {
      const result = computeAffectedSet({ root, changedFiles: [trigger] })
      assert.deepEqual(names(result), ['one', 'two'], trigger)
      assert.equal(result.fullRun, true, trigger)
      assert.equal(result.packedConsumer, true, trigger)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('test-only and release-metadata changes keep package gates but skip packed consumer', () => {
  const root = createWorkspace([
    { directory: 'base' },
    {
      directory: 'dependent',
      manifest: { peerDependencies: { [`${scope}base`]: '>=1' } },
    },
  ])

  try {
    const result = computeAffectedSet({
      root,
      changedFiles: [
        'packages/base/tests/contract.test.ts',
        'packages/base/CHANGELOG.md',
        '.changeset/test-only.md',
      ],
    })
    assert.deepEqual(names(result), ['base', 'dependent'])
    assert.equal(result.fullRun, false)
    assert.equal(result.packedConsumer, false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('unclassified repository files fail closed to a full package run', () => {
  const root = createWorkspace([{ directory: 'one' }, { directory: 'two' }])
  try {
    const result = computeAffectedSet({ root, changedFiles: ['config/unknown.yaml'] })
    assert.deepEqual(names(result), ['one', 'two'])
    assert.equal(result.fullRun, true)
    assert.equal(result.packedConsumer, false)
    assert.match(result.reasons.join('\n'), /unclassified repository path/u)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('inert repository paths select no packages and do not force a full run', () => {
  const root = createWorkspace([{ directory: 'one' }, { directory: 'two' }])
  try {
    const result = computeAffectedSet({
      root,
      changedFiles: ['docs/architecture.md', 'README.md', 'LICENSE'],
    })
    assert.deepEqual(names(result), [])
    assert.equal(result.fullRun, false)
    assert.equal(result.packedConsumer, false)
    assert.equal(result.matrix.length, 0)
    assert.deepEqual(result.skippedNames.sort(), [`${scope}one`, `${scope}two`].sort())
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('an inert path mixed with a real package change only selects that package', () => {
  const root = createWorkspace([{ directory: 'one' }, { directory: 'two' }])
  try {
    const result = computeAffectedSet({
      root,
      changedFiles: ['docs/architecture.md', 'packages/one/src/index.ts'],
    })
    assert.deepEqual(names(result), ['one'])
    assert.equal(result.fullRun, false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a changeset-only diff with no package touched is inert, not a full run', () => {
  const root = createWorkspace([{ directory: 'one' }, { directory: 'two' }])
  try {
    const result = computeAffectedSet({ root, changedFiles: ['.changeset/some-change.md'] })
    assert.deepEqual(names(result), [])
    assert.equal(result.fullRun, false)
    assert.equal(result.matrix.length, 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('an explicit full run cannot produce an empty matrix', () => {
  const root = createWorkspace([{ directory: 'one' }, { directory: 'two' }])
  try {
    const result = computeAffectedSet({ root, changedFiles: [], forceAll: true })
    assert.deepEqual(names(result), ['one', 'two'])
    assert.equal(result.packedConsumer, true)
    assert.equal(result.matrix.length, 2)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('resolves packages across the four-family layout and attributes nested paths', () => {
  // company-hq D-WEBFOUND-2 Q2 (a): packages/ carries one directory level per
  // family, so the workspace loader must resolve several `<family>/*` globs and
  // `packageForPath` must attribute a nested file to its own package.
  const root = mkdtempSync(join(tmpdir(), 'narduk-libs-affected-families-'))
  try {
    writeFileSync(
      join(root, 'pnpm-workspace.yaml'),
      'packages:\n  - "packages/modules/*"\n  - "packages/tooling/*"\n  - "packages/design/*"\n  - "packages/contracts/*"\n',
    )
    const families = {
      modules: ['core'],
      tooling: ['app-tools'],
      design: ['ui'],
      contracts: ['platform'],
    }
    for (const [family, directories] of Object.entries(families)) {
      mkdirSync(join(root, 'packages', family), { recursive: true })
      for (const directory of directories) {
        mkdirSync(join(root, 'packages', family, directory))
        writeJson(join(root, 'packages', family, directory, 'package.json'), {
          name: `${scope}${directory}`,
          version: '1.0.0',
          ...(family === 'tooling' ? { dependencies: { [`${scope}core`]: 'workspace:*' } } : {}),
        })
      }
    }

    const workspace = loadWorkspace(root)
    assert.deepEqual(workspace.packages.map(({ relativeDirectory }) => relativeDirectory).sort(), [
      'packages/contracts/platform',
      'packages/design/ui',
      'packages/modules/core',
      'packages/tooling/app-tools',
    ])

    const result = computeAffectedSet({
      root,
      changedFiles: ['packages/modules/core/src/module.ts'],
    })
    assert.equal(result.fullRun, false)
    assert.deepEqual(names(result).sort(), ['app-tools', 'core'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the live workspace discovers narduk-shell from pnpm-workspace.yaml', () => {
  const workspace = loadWorkspace(repoRoot)
  const shell = workspace.byName.get(`${scope}narduk-shell`)
  assert.ok(shell, 'loadWorkspace must include narduk-shell')
  assert.equal(shell.relativeDirectory, 'packages/design/narduk-shell')
  // Deliberately not a literal. This test proves workspace *discovery*; pinning
  // the version instead makes every narduk-shell release PR fail its own gate,
  // which is what stalled the 0.1.0 release for nine days. Assert that the
  // manifest was read and parsed, not what it currently happens to say.
  assert.match(
    shell.manifest.version,
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-.]+)?$/,
    'narduk-shell manifest version must parse as semver',
  )

  const result = computeAffectedSet({
    root: repoRoot,
    changedFiles: ['packages/design/narduk-shell/src/module.ts'],
  })
  assert.equal(result.fullRun, false)
  assert.deepEqual(result.changedNames, [`${scope}narduk-shell`])
  assert.ok(result.affectedNames.includes(`${scope}narduk-shell`))

  // Item 4 / narduk-libs#251 owns the generator default-module pin, and now
  // does: narduk-shell ships to every generated app by default, exactly pinned.
  const generatorManifest = readFileSync(
    join(repoRoot, 'packages/tooling/create-narduk-app/src/manifest.ts'),
    'utf8',
  )
  assert.equal(generatorManifest.includes('narduk-shell'), true)

  const durations = JSON.parse(
    readFileSync(join(repoRoot, 'scripts/ci-package-durations.json'), 'utf8'),
  )
  assert.equal(typeof durations.gateSeconds['narduk-shell'], 'number')
})
