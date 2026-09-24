import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CONSUMER_SMOKE_TEST_OG_IMAGE_SECRET,
  CONSUMER_SMOKE_TEST_SESSION_PASSWORD,
  consumerSmokePhases,
  consumerSmokeTestEnv,
  isGeneratedBuildPhase,
  mapPackages,
  qualityPhases,
} from './consumer-smoke-phases.mjs'

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

test('fixture env fills test-only OG and session secrets only when unset', () => {
  assert.deepEqual(consumerSmokeTestEnv({}), {
    NUXT_OG_IMAGE_SECRET: CONSUMER_SMOKE_TEST_OG_IMAGE_SECRET,
    NUXT_SESSION_PASSWORD: CONSUMER_SMOKE_TEST_SESSION_PASSWORD,
  })
  assert.deepEqual(
    consumerSmokeTestEnv({
      NUXT_OG_IMAGE_SECRET: 'already-set-og',
      NUXT_SESSION_PASSWORD: 'already-set-session',
    }),
    {
      NUXT_OG_IMAGE_SECRET: 'already-set-og',
      NUXT_SESSION_PASSWORD: 'already-set-session',
    },
  )
  assert.deepEqual(consumerSmokeTestEnv({ FOO: 'bar', NUXT_OG_IMAGE_SECRET: '' }), {
    FOO: 'bar',
    NUXT_OG_IMAGE_SECRET: CONSUMER_SMOKE_TEST_OG_IMAGE_SECRET,
    NUXT_SESSION_PASSWORD: CONSUMER_SMOKE_TEST_SESSION_PASSWORD,
  })
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

test('recognises the build phase under either name the generated gate has used', () => {
  // `quality:static` called `build` before narduk-libs#617 and calls `build:ci`
  // after it. release-packages.mjs asserts the font provider fixture activated
  // during whichever one runs; a literal script name there stopped asserting
  // anything the moment the generated chain moved.
  assert.equal(isGeneratedBuildPhase('build'), true)
  assert.equal(isGeneratedBuildPhase('build:ci'), true)
  // Different commands, not the app's build.
  for (const phase of ['build:analyze', 'build:ci:fast', 'prebuild', 'typecheck', 'rebuild']) {
    assert.equal(isGeneratedBuildPhase(phase), false, phase)
  }
})

test('a generated quality chain always yields exactly one build phase to smoke', () => {
  // Both shapes the generated `quality:static` has had. If a future chain
  // stops producing a build phase, release-packages.mjs now fails outright
  // rather than skipping the fixture proof in silence.
  for (const buildScript of ['build', 'build:ci']) {
    const scripts = {
      quality: 'pnpm run quality:static && pnpm run test:e2e',
      'quality:static': [
        'pnpm run format:check',
        'pnpm run foundation:shared-ui-pinned',
        'pnpm run lint',
        'pnpm run knip',
        'pnpm run manifests:validate',
        'pnpm run typecheck',
        `pnpm run ${buildScript}`,
        'pnpm run test:unit',
      ].join(' && '),
      'format:check': 'prettier --check .',
      'foundation:shared-ui-pinned': 'pnpm --filter web run foundation:shared-ui-pinned',
      lint: 'narduk-lint',
      knip: 'knip',
      'manifests:validate': 'node scripts/validate-manifests.mjs',
      typecheck: 'pnpm --filter web run typecheck',
      build: 'pnpm --filter web run build',
      'build:ci': 'pnpm --filter web run build:ci',
      'test:unit': 'vitest run',
      'test:e2e': 'playwright test',
    }
    const builds = consumerSmokePhases(scripts).filter(isGeneratedBuildPhase)
    assert.deepEqual(builds, [buildScript])
  }
})
