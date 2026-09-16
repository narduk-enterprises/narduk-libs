import assert from 'node:assert/strict'
import test from 'node:test'
import { consumerSmokePhases, mapPackages, qualityPhases } from './consumer-smoke-phases.mjs'

test('expands the complete quality chain in order without discarding duplicate calls', () => {
  assert.deepEqual(
    qualityPhases({
      quality: 'pnpm run static && pnpm run browser',
      static: 'pnpm run lint && pnpm run build && pnpm run lint',
      lint: 'eslint .',
      build: 'nuxt build',
      browser: 'playwright test',
    }),
    ['lint', 'build', 'lint', 'browser'],
  )
})

test('preserves lifecycle hooks and shell commands verbatim through pnpm', () => {
  for (const scripts of [
    { quality: 'pnpm run lint', prequality: 'prepare', lint: 'eslint .' },
    { quality: 'pnpm run lint', postquality: 'cleanup', lint: 'eslint .' },
    { quality: 'pnpm run lint -- --fix', lint: 'eslint .' },
    { quality: 'pnpm run lint || true', lint: 'eslint .' },
    { quality: 'FOO=1 pnpm run lint', lint: 'eslint .' },
  ])
    assert.deepEqual(qualityPhases(scripts), ['quality'])
})

test('a missing or cyclic gate fails instead of becoming an empty success', () => {
  assert.throws(() => qualityPhases({ quality: 'pnpm run absent' }), /Missing/)
  assert.throws(
    () => qualityPhases({ quality: 'pnpm run static', static: 'pnpm run quality' }),
    /Cyclic/,
  )
})

test('release smoke trims scaffold checks and retains compatibility and future checks', () => {
  const scripts = {
    quality: 'pnpm run static && pnpm run test:e2e',
    static:
      'pnpm run format:check && pnpm run lint && pnpm run knip && pnpm run foundation:shared-ui-pinned && pnpm run typecheck && pnpm run build && pnpm run test:unit && pnpm run future-contract',
    'format:check': 'prettier --check .',
    lint: 'nuxt prepare && eslint .',
    knip: 'knip',
    'foundation:shared-ui-pinned': 'narduk-app foundation:check:shared-ui-pinned',
    typecheck: 'nuxt typecheck',
    build: 'nuxt build',
    'test:unit': 'vitest run',
    'test:e2e': 'playwright test',
    'future-contract': 'node check-contract.mjs',
  }
  assert.deepEqual(consumerSmokePhases(scripts), [
    'foundation:shared-ui-pinned',
    'typecheck',
    'build',
    'future-contract',
    'test:e2e',
  ])
  assert.equal(qualityPhases(scripts).includes('lint'), true)
  assert.throws(() => consumerSmokePhases({ quality: 'pnpm run absent' }), /Missing/)
})

test('package work is bounded and preserves every result in input order', async () => {
  let active = 0
  let maximum = 0
  const result = await mapPackages([1, 2, 3, 4, 5], async (value) => {
    active++
    maximum = Math.max(maximum, active)
    await new Promise((resolve) => setTimeout(resolve, value === 1 ? 20 : 1))
    active--
    return value * 2
  })
  assert.equal(maximum, 2)
  assert.deepEqual(result, [2, 4, 6, 8, 10])
})

test('failure stops scheduling and waits for in-flight packing before cleanup', async () => {
  const started = []
  let finished = false
  await assert.rejects(
    mapPackages([1, 2, 3, 4], async (value) => {
      started.push(value)
      if (value === 1) throw new Error('invalid package')
      await new Promise((resolve) => setTimeout(resolve, 10))
      finished = true
    }),
    /invalid package/,
  )
  assert.deepEqual(started, [1, 2])
  assert.equal(finished, true)
})
