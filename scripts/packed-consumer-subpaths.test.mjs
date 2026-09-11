import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { loadWorkspace } from './compute-affected-packages.mjs'
import {
  exportEntry,
  exportSubpaths,
  hasRuntimeCondition,
  packageSubpathPlan,
  subpathProbeProgram,
  subpathResolutionPlans,
  subpathSpecifier,
} from './packed-consumer-subpaths.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

test('a subpath map contributes every non-pattern key', () => {
  assert.deepEqual(
    exportSubpaths({
      '.': './src/module.ts',
      './format': './src/format.ts',
      './theme.css': './theme.css',
    }),
    ['.', './format', './theme.css'],
  )
})

test('string, array and condition-only exports are all the single `.` subpath', () => {
  assert.deepEqual(exportSubpaths('./index.js'), ['.'])
  assert.deepEqual(exportSubpaths(['./index.js', './fallback.js']), ['.'])
  assert.deepEqual(exportSubpaths({ import: './index.mjs', require: './index.cjs' }), ['.'])
})

test('exports mixing subpath and condition keys is a packaging bug, not a silent half-check', () => {
  assert.throws(
    () => exportSubpaths({ '.': './index.js', import: './index.mjs' }),
    /mixes subpath keys with condition keys/,
  )
})

test('specifiers are built from the package name, with `.` meaning the bare name', () => {
  assert.equal(subpathSpecifier('@scope/pkg', '.'), '@scope/pkg')
  assert.equal(subpathSpecifier('@scope/pkg', './format'), '@scope/pkg/format')
  assert.equal(subpathSpecifier('@scope/pkg', './theme.css'), '@scope/pkg/theme.css')
})

test('pattern and null subpaths are skipped by name rather than guessed at', () => {
  const plan = packageSubpathPlan({
    name: '@narduk-enterprises/narduk-core',
    exports: {
      '.': './src/module.ts',
      './nuxt': './src/module.ts',
      './server/*': './runtime/server/*.ts',
      './internal/blocked': null,
    },
  })

  assert.deepEqual(plan.specifiers, [
    '@narduk-enterprises/narduk-core',
    '@narduk-enterprises/narduk-core/nuxt',
  ])
  assert.deepEqual(plan.skipped, [
    { subpath: './server/*', reason: 'pattern subpath' },
    { subpath: './internal/blocked', reason: 'blocked by a null exports entry' },
  ])
})

// Both narduk-auth and narduk-ai ship a real types-only subpath
// (`./shared/types/native-auth`, `./shared/types/runtime-config`). Node never
// selects the `types` condition when resolving, so probing one fails the
// release for a manifest that is not wrong. The first run of this tier against
// the packed workspace found exactly those two and nothing else.
test('a types-only exports entry offers no runtime condition', () => {
  assert.equal(hasRuntimeCondition({ types: './shared/types/native-auth.ts' }), false)
  assert.equal(hasRuntimeCondition({ types: './x.d.ts', import: './x.js' }), true)
  assert.equal(hasRuntimeCondition({ node: { types: './x.d.ts', default: './x.js' } }), true)
  assert.equal(hasRuntimeCondition({ node: { types: './x.d.ts' } }), false)
  assert.equal(hasRuntimeCondition('./x.js'), true)
  assert.equal(hasRuntimeCondition(null), false)
})

test('a types-only subpath is skipped by name rather than probed', () => {
  const plan = packageSubpathPlan({
    name: '@narduk-enterprises/narduk-auth',
    exports: {
      '.': { import: './src/module.ts' },
      './shared/types/native-auth': { types: './shared/types/native-auth.ts' },
    },
  })

  assert.deepEqual(plan.specifiers, ['@narduk-enterprises/narduk-auth'])
  assert.deepEqual(plan.skipped, [
    {
      subpath: './shared/types/native-auth',
      reason: 'types-only exports entry (publint proves the file ships)',
    },
  ])
})

test('the sugar exports shapes resolve their `.` entry, not an undefined lookup', () => {
  assert.equal(exportEntry('./index.js', '.'), './index.js')
  assert.deepEqual(exportEntry({ import: './index.mjs' }, '.'), { import: './index.mjs' })
  assert.equal(exportEntry({ '.': './index.js' }, '.'), './index.js')

  // A condition-object root export must be probed, never mistaken for
  // types-only because `exports['.']` happens to be undefined.
  assert.deepEqual(
    packageSubpathPlan({ name: '@scope/pkg', exports: { import: './index.mjs' } }).specifiers,
    ['@scope/pkg'],
  )
})

test('the live workspace plans narduk-ui, narduk-charts and narduk-shell subpaths', () => {
  const workspace = loadWorkspace(repoRoot)
  const plans = subpathResolutionPlans(workspace.packages)
  const byName = new Map(plans.map((plan) => [plan.name, plan]))

  const ui = byName.get('@narduk-enterprises/narduk-ui')
  assert.ok(ui, 'narduk-ui must be in the packed-consumer subpath plan')
  assert.ok(ui.specifiers.includes('@narduk-enterprises/narduk-ui/tokens.css'))
  assert.ok(ui.specifiers.includes('@narduk-enterprises/narduk-ui/core'))
  assert.ok(ui.specifiers.includes('@narduk-enterprises/narduk-ui/instruments'))
  assert.deepEqual(ui.skipped, [{ subpath: './instruments/*.vue', reason: 'pattern subpath' }])

  const charts = byName.get('@narduk-enterprises/narduk-charts')
  assert.ok(charts, 'narduk-charts must be in the packed-consumer subpath plan')
  assert.deepEqual(charts.specifiers, [
    '@narduk-enterprises/narduk-charts',
    '@narduk-enterprises/narduk-charts/line',
    '@narduk-enterprises/narduk-charts/bar',
    '@narduk-enterprises/narduk-charts/pie',
    '@narduk-enterprises/narduk-charts/candle',
    '@narduk-enterprises/narduk-charts/studies',
    '@narduk-enterprises/narduk-charts/style.css',
  ])

  const shell = byName.get('@narduk-enterprises/narduk-shell')
  assert.ok(shell, 'narduk-shell must be in the packed-consumer subpath plan')
  assert.deepEqual(shell.specifiers, [
    '@narduk-enterprises/narduk-shell',
    '@narduk-enterprises/narduk-shell/format',
    '@narduk-enterprises/narduk-shell/theme.css',
  ])
  assert.deepEqual(shell.skipped, [])

  assert.ok(
    byName.has('@narduk-enterprises/narduk-testkit'),
    'narduk-testkit stays in the plan; evaluation of its subpaths is a later tier',
  )
})

test('the plan covers every packed package with an exports map, not just narduk-testkit', () => {
  const plans = subpathResolutionPlans([
    {
      manifest: { name: '@narduk-enterprises/narduk-testkit', exports: { '.': './dist/index.js' } },
    },
    {
      manifest: {
        name: '@narduk-enterprises/narduk-ui',
        exports: { './tokens.css': './tokens.css' },
      },
    },
    {
      manifest: {
        name: '@narduk-enterprises/narduk-charts',
        exports: { '.': './dist/narduk-charts.js', './style.css': './dist/narduk-charts.css' },
      },
    },
    { manifest: { name: '@narduk-enterprises/no-exports', version: '1.0.0' } },
  ])

  assert.deepEqual(
    plans.map(({ name, specifiers }) => [name, specifiers]),
    [
      ['@narduk-enterprises/narduk-testkit', ['@narduk-enterprises/narduk-testkit']],
      ['@narduk-enterprises/narduk-ui', ['@narduk-enterprises/narduk-ui/tokens.css']],
      [
        '@narduk-enterprises/narduk-charts',
        ['@narduk-enterprises/narduk-charts', '@narduk-enterprises/narduk-charts/style.css'],
      ],
    ],
  )
})

// The probe is the gate's actual proof, so it is executed here rather than
// string-matched: a fixture package whose exports map promises a file the
// tarball does not ship must fail, and `import.meta.resolve` alone does NOT
// catch that (Node 22.22.3 resolves a specifier whose target is absent), which
// is exactly why the probe also checks existence.
function withFixtureConsumer(run) {
  const directory = mkdtempSync(join(tmpdir(), 'narduk-libs-subpath-fixture-'))
  try {
    const packageDirectory = join(directory, 'node_modules', 'fixture-pkg')
    mkdirSync(packageDirectory, { recursive: true })
    writeFileSync(
      join(packageDirectory, 'package.json'),
      `${JSON.stringify(
        {
          name: 'fixture-pkg',
          version: '1.0.0',
          type: 'module',
          exports: { './shipped': './shipped.js', './unshipped': './unshipped.js' },
        },
        null,
        2,
      )}\n`,
    )
    writeFileSync(join(packageDirectory, 'shipped.js'), 'export const shipped = true\n')
    run(directory)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

function probe(directory, specifiers) {
  return spawnSync(
    process.execPath,
    ['--input-type=module', '--eval', subpathProbeProgram('fixture-pkg', specifiers)],
    { cwd: directory, encoding: 'utf8' },
  )
}

test('the probe passes for a subpath the packed artifact actually ships', () => {
  withFixtureConsumer((directory) => {
    const result = probe(directory, ['fixture-pkg/shipped'])
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`)
    assert.match(result.stdout, /Resolved 1 fixture-pkg export subpath\(s\)/)
  })
})

test('the probe fails, naming package and specifier, when the file is not in the tarball', () => {
  withFixtureConsumer((directory) => {
    const result = probe(directory, ['fixture-pkg/shipped', 'fixture-pkg/unshipped'])
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /fixture-pkg: export subpath "fixture-pkg\/unshipped"/)
    assert.match(result.stderr, /packed artifact does not contain/)
  })
})

test('the probe fails, naming package and specifier, when the subpath is not exported at all', () => {
  withFixtureConsumer((directory) => {
    const result = probe(directory, ['fixture-pkg/undeclared'])
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /fixture-pkg: export subpath "fixture-pkg\/undeclared"/)
    assert.match(result.stderr, /does not resolve from an external consumer/)
  })
})

test('the probe refuses an empty specifier list rather than printing a vacuous pass', () => {
  assert.throws(() => subpathProbeProgram('fixture-pkg', []), /no subpaths to probe/)
})
