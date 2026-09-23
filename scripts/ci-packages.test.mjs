import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { batchPackages, packageGates } from './ci-package-plan.mjs'
import {
  dependencyOrder,
  outOfBatchBuilds,
  runBrowserGates,
  runPackageGates,
} from './ci-packages.mjs'

const names = ['one', 'two', 'three']
const workspace = () => ({
  byName: new Map(
    names.map((name) => [
      name,
      { manifest: { scripts: Object.fromEntries(packageGates.map((gate) => [gate, 'true'])) } },
    ]),
  ),
})

test('browser selection executes each declared suite and rejects missing scripts or unknown packages', () => {
  const browserWorkspace = workspace()
  for (const entry of browserWorkspace.byName.values()) entry.manifest.scripts['test:e2e'] = 'true'
  const calls = []
  const execute = (command, args) => {
    calls.push([command, ...args])
    return { status: args[1] === 'two' ? 7 : 0 }
  }
  const results = runBrowserGates(names, browserWorkspace, execute)
  assert.equal(calls.length, 3)
  assert.equal(results[1].status, 7)
  assert.ok(calls.every((call) => call.at(-1) === 'test:e2e'))
  assert.throws(() => runBrowserGates(['missing'], browserWorkspace, execute), /Unknown workspace/)
  delete browserWorkspace.byName.get('one').manifest.scripts['test:e2e']
  assert.throws(() => runBrowserGates(names, browserWorkspace, execute), /missing required script/)
})

test('full and narrow plans select every package exactly once in at most eight install batches', () => {
  for (const count of [0, 1, 2, 3, 4, 8, 21]) {
    const matrix = Array.from({ length: count }, (_, index) => ({
      label: `p${index}`,
      filter: `@example/p${index}`,
    }))
    const batches = batchPackages(matrix, { p0: 100, p1: 50 })
    assert.equal(batches.length, Math.min(8, count))
    assert.deepEqual(
      batches.flatMap(({ packages }) => packages).sort(),
      matrix.map(({ filter }) => filter).sort(),
    )
    assert.deepEqual(batchPackages(matrix, { p0: 100, p1: 50 }), batches)
  }
})

test('longest gates are spread across batches without changing coverage', () => {
  const batches = batchPackages(
    names.map((name) => ({ label: name, filter: name })),
    { one: 100, two: 80, three: 20 },
    2,
  )
  assert.deepEqual(
    batches.map(({ estimatedSeconds }) => estimatedSeconds),
    [100, 100],
  )
  assert.throws(() => batchPackages([{ filter: 'one' }, { filter: 'one' }], {}), /duplicates/)
  assert.throws(() => batchPackages([], {}, 0), /limit/)
  assert.throws(() => batchPackages([], {}, 9), /limit/)
})

for (const failedPackage of names) {
  test(`a failed gate in ${failedPackage} remains red after every later package completes`, () => {
    const invocations = []
    const results = runPackageGates(names, workspace(), (command, args) => {
      invocations.push([command, ...args])
      return spawnSync(process.execPath, [
        '-e',
        `process.exit(${args[1] === failedPackage && args[3] === 'typecheck' ? 7 : 0})`,
      ])
    })
    assert.equal(invocations.length, names.length * packageGates.length)
    assert.deepEqual(
      results
        .filter(({ status }) => status !== 0)
        .map(({ name, gate, status }) => ({ name, gate, status })),
      [{ name: failedPackage, gate: 'typecheck', status: 7 }],
    )
    assert.deepEqual(
      invocations,
      names.flatMap((name) => packageGates.map((gate) => ['pnpm', '--filter', name, 'run', gate])),
    )
  })
}

test('empty, unknown, duplicate, or missing-script selections fail before executing a gate', () => {
  const execute = () => assert.fail('invalid batch executed')
  for (const selection of [null, [], ['absent'], ['one', 'one']])
    assert.throws(() => runPackageGates(selection, workspace(), execute))
  const missing = workspace()
  delete missing.byName.get('three').manifest.scripts['check:package']
  assert.throws(
    () => runPackageGates(names, missing, execute),
    /three is missing required script check:package/,
  )
})

test('a cancelled child stops the batch and cannot become a successful result', () => {
  assert.throws(
    () => runPackageGates(names, workspace(), () => ({ signal: 'SIGTERM', status: null })),
    /interrupted/,
  )
})

// #292: a batch member's workspace dependencies are built before its gates.
const graphWorkspace = (packages) => ({
  byName: new Map(
    Object.entries(packages).map(([name, { dependencies = {}, exports }]) => [
      name,
      {
        manifest: {
          name,
          dependencies,
          ...(exports ? { exports } : {}),
          scripts: Object.fromEntries(packageGates.map((gate) => [gate, 'true'])),
        },
      },
    ]),
  ),
})

test('a batch runs each member after the in-batch packages it depends on (#292)', () => {
  const graph = graphWorkspace({
    consumer: { dependencies: { provider: 'workspace:*' } },
    provider: { dependencies: { base: 'workspace:*' } },
    base: {},
  })
  const order = []
  runPackageGates(['consumer', 'provider', 'base'], graph, (command, args) => {
    if (args[3] === 'lint') order.push(args[1])
    return { status: 0 }
  })
  assert.deepEqual(order, ['base', 'provider', 'consumer'])
})

test('out-of-batch dependencies that export dist/ are built once, first, and transitively (#292)', () => {
  const graph = graphWorkspace({
    consumer: { dependencies: { built: 'workspace:*', source: 'workspace:*' } },
    built: { exports: { '.': { import: './dist/index.js' } }, dependencies: { deep: '1.0.0' } },
    deep: { exports: { '.': './dist/deep.js' } },
    source: { exports: { '.': { import: './src/index.ts' } } },
  })
  const calls = []
  const results = runPackageGates(['consumer'], graph, (command, args) => {
    calls.push(args)
    return { status: 0 }
  })
  assert.deepEqual(calls[0], ['--filter', 'built', '--filter', 'deep', 'run', 'build'])
  assert.equal(calls.length, 1 + packageGates.length)
  assert.deepEqual(results[0].gate, 'dependency build')
  assert.deepEqual(outOfBatchBuilds(['consumer', 'built'], graph), ['deep'])
  assert.deepEqual(dependencyOrder(['consumer', 'built'], graph), ['built', 'consumer'])
})

test('a failed dependency build stays red after the gates run (#292)', () => {
  const graph = graphWorkspace({
    consumer: { dependencies: { built: 'workspace:*' } },
    built: { exports: { '.': './dist/index.js' } },
  })
  const results = runPackageGates(['consumer'], graph, (command, args) => ({
    status: args.at(-1) === 'build' && args[1] === 'built' ? 2 : 0,
  }))
  assert.deepEqual(
    results.filter(({ status }) => status !== 0).map(({ name, gate }) => ({ name, gate })),
    [{ name: 'built', gate: 'dependency build' }],
  )
  assert.throws(
    () => runPackageGates(['consumer'], graph, () => ({ signal: 'SIGTERM', status: null })),
    /dependency build interrupted/,
  )
})
