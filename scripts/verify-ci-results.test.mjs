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
  GENERATED_CONSUMER_EXPECTED: 'true',
  PACKED_CONSUMER_SMOKE_RESULT: 'success',
  BROWSER_EXPECTED: 'true',
  BROWSER_RESULT: 'success',
  LOGGING_EXPECTED: 'true',
  LOGGING_RESULT: 'success',
}
const run = (env) =>
  spawnSync('bash', ['-e', '-o', 'pipefail', '-c', shell], {
    env: { ...process.env, ...green, ...env },
    encoding: 'utf8',
  })

test('selected execution lanes start after planning while contracts run independently', () => {
  const jobSource = workflow.split('\njobs:\n')[1]
  assert.ok(jobSource, 'the workflow must declare jobs')
  const jobs = [...jobSource.matchAll(/^  ([\w-]+):\s*$/gm)].map((match, index, matches) => ({
    name: match[1],
    source: jobSource.slice(match.index, matches[index + 1]?.index),
  }))
  const preflight = ['affected', 'contracts']
  const executionJobs = jobs.filter(
    ({ name }) => ![...preflight, 'verify', 'cancel-after-contracts-failure'].includes(name),
  )
  assert.ok(executionJobs.length > 0, 'the workflow must include execution gates')
  for (const { name, source } of executionJobs) {
    const declaration = source.match(/^    needs:\s*(\[[\s\S]*?\]|[\w-]+)/m)?.[1]
    const needs = declaration?.match(/[\w-]+/g) ?? []
    assert.deepEqual(needs, ['affected'], `${name} must wait only for the package plan`)
    const condition = source.match(/^    if:([^\n]*(?:\n {6,}[^\n]*)*)/m)?.[1] ?? ''
    assert.doesNotMatch(
      condition,
      /\b(?:always|failure|cancelled)\s*\(/,
      `${name} must not bypass the affected selection`,
    )
  }
  for (const { name, source } of jobs.filter(({ name }) => preflight.includes(name))) {
    assert.doesNotMatch(source, /^    (?:needs|if):/m, `${name} must run unconditionally`)
  }
})

test('failed, cancelled or missing contracts reject even successful downstream work', () => {
  for (const result of ['failure', 'cancelled', 'skipped', '']) {
    const outcome = run({ CONTRACTS_RESULT: result })
    assert.notEqual(outcome.status, 0)
    assert.match(outcome.stdout, new RegExp(`CONTRACTS gate reported '${result}'`))
  }
})

test('full and explicitly empty plans pass the actual final aggregate', () => {
  assert.equal(run({}).status, 0)
  assert.equal(
    run({
      AFFECTED_COUNT: '0',
      PACKED_CONSUMER_EXPECTED: 'false',
      GENERATED_CONSUMER_EXPECTED: 'false',
      PACKED_CONSUMER_SMOKE_RESULT: 'skipped',
      BROWSER_EXPECTED: 'false',
      BROWSER_RESULT: 'skipped',
      LOGGING_EXPECTED: 'false',
      LOGGING_RESULT: 'skipped',
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
    'LOGGING_RESULT',
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
  assert.notEqual(run({ LOGGING_EXPECTED: 'false' }).status, 0)
  assert.notEqual(run({ LOGGING_EXPECTED: '', LOGGING_RESULT: 'skipped' }).status, 0)
})

test('artifact-only success is accepted but missing or contradictory app selection fails', () => {
  assert.equal(run({ GENERATED_CONSUMER_EXPECTED: 'false' }).status, 0)
  for (const value of ['', 'unknown'])
    assert.notEqual(run({ GENERATED_CONSUMER_EXPECTED: value }).status, 0)
  assert.notEqual(
    run({ PACKED_CONSUMER_EXPECTED: 'false', PACKED_CONSUMER_SMOKE_RESULT: 'skipped' }).status,
    0,
  )
})
