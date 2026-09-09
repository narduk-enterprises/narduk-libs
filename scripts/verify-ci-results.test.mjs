import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

// Execute the shipped final shell step, not a reimplementation of its rules.
const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')
const aggregate = workflow.split('      - name: Require every gate\n')[1]
assert.ok(aggregate, 'the final aggregate must exist')
const lines = aggregate.split('        run: |\n')[1].split('\n')
const shell = lines
  .slice(
    0,
    lines.findIndex((line) => line && !line.startsWith('          ')) < 0
      ? undefined
      : lines.findIndex((line) => line && !line.startsWith('          ')),
  )
  .map((line) => line.slice(10))
  .join('\n')
const green = {
  AFFECTED_RESULT: 'success',
  CI_RESULT: 'success',
  CONTRACTS_RESULT: 'success',
  AFFECTED_COUNT: '21',
  PACKED_CONSUMER_EXPECTED: 'true',
  PACKED_CONSUMER_SMOKE_RESULT: 'success',
  BROWSER_EXPECTED: 'true',
  BROWSER_RESULT: 'success',
}
const run = (env) =>
  spawnSync('bash', ['-e', '-o', 'pipefail', '-c', shell], {
    env: { ...process.env, ...green, ...env },
    encoding: 'utf8',
  })

test('full and explicitly empty plans pass the actual final aggregate', () => {
  assert.equal(run({}).status, 0)
  assert.equal(
    run({
      AFFECTED_COUNT: '0',
      PACKED_CONSUMER_EXPECTED: 'false',
      PACKED_CONSUMER_SMOKE_RESULT: 'skipped',
      BROWSER_EXPECTED: 'false',
      BROWSER_RESULT: 'skipped',
    }).status,
    0,
  )
})

test('failure, cancellation, missing output and unexpected skips cannot satisfy the final gate', () => {
  for (const field of [
    'AFFECTED_RESULT',
    'CI_RESULT',
    'CONTRACTS_RESULT',
    'PACKED_CONSUMER_SMOKE_RESULT',
    'BROWSER_RESULT',
  ]) {
    for (const value of ['failure', 'cancelled', 'skipped', ''])
      assert.notEqual(run({ [field]: value }).status, 0, `${field}=${value}`)
  }
  assert.notEqual(run({ AFFECTED_COUNT: '' }).status, 0)
  assert.notEqual(
    run({ PACKED_CONSUMER_EXPECTED: '', PACKED_CONSUMER_SMOKE_RESULT: 'skipped' }).status,
    0,
  )
  assert.notEqual(run({ PACKED_CONSUMER_EXPECTED: 'false' }).status, 0)
  assert.notEqual(run({ BROWSER_EXPECTED: 'false' }).status, 0)
  assert.notEqual(run({ BROWSER_EXPECTED: '', BROWSER_RESULT: 'skipped' }).status, 0)
})
