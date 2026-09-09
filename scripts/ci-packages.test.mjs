import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { batchPackages, packageGates } from './ci-package-plan.mjs'
import { runPackageGates } from './ci-packages.mjs'

const names = ['one', 'two', 'three']
const workspace = () => ({
  byName: new Map(
    names.map((name) => [
      name,
      { manifest: { scripts: Object.fromEntries(packageGates.map((gate) => [gate, 'true'])) } },
    ]),
  ),
})

test('full and narrow plans select every package exactly once in at most four install batches', () => {
  for (const count of [0, 1, 2, 3, 4, 21]) {
    const matrix = Array.from({ length: count }, (_, index) => ({
      label: `p${index}`,
      filter: `@example/p${index}`,
    }))
    const batches = batchPackages(matrix, { p0: 100, p1: 50 })
    assert.equal(batches.length, Math.min(4, count))
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
