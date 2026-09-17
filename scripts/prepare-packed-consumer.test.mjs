import assert from 'node:assert/strict'
import test from 'node:test'
import { packedConsumerBuildArgs } from './prepare-packed-consumer.mjs'

test('builds publishable packages and their dependencies, not private applications', () => {
  const packages = [
    { manifest: { name: '@example/runtime', private: false } },
    { manifest: { name: '@example/tool' } },
    { manifest: { name: '@example/preview', private: true } },
  ]
  const args = packedConsumerBuildArgs(packages, '/tmp/build-cache')
  assert.deepEqual(
    args.filter((arg) => arg.startsWith('--filter=')),
    ['--filter=@example/runtime...', '--filter=@example/tool...'],
  )
  assert.ok(args.includes('--concurrency=2'))
  assert.ok(args.includes('--cache-dir=/tmp/build-cache'))
  assert.ok(packedConsumerBuildArgs(packages, '/tmp/cache', 4).includes('--concurrency=4'))
  for (const invalid of [0, -1, 5, 1.5, NaN])
    assert.throws(() => packedConsumerBuildArgs(packages, '/tmp/cache', invalid), /concurrency/)
  assert.throws(() => packedConsumerBuildArgs([packages[2]], '/tmp/cache'), /No publishable/)
})
