import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { packedConsumerBuildArgs, preparePackedConsumer } from './prepare-packed-consumer.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))

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

for (const failingTask of ['build', 'browser', null]) {
  test(`preparation overlaps independent work and drains both (${failingTask ?? 'success'})`, async () => {
    const started = []
    const finished = []
    const release = new Map()
    const preparation = preparePackedConsumer({
      root,
      cacheDirectory: '/tmp/build-cache',
      installBrowser: true,
      run: async (command, args, options) => {
        assert.equal(command, 'pnpm')
        assert.equal(options.cwd, root)
        const task = args[1] === 'turbo' ? 'build' : 'browser'
        if (task === 'browser')
          assert.deepEqual(args, ['exec', 'playwright', 'install', '--with-deps', 'chromium'])
        started.push(task)
        await new Promise((resolve) => release.set(task, resolve))
        finished.push(task)
        if (task === failingTask) throw new Error(`${task} failed`)
      },
    })
    assert.deepEqual(started, ['build', 'browser'])
    let settled = false
    const verdict = preparation.then(
      () => {
        settled = true
        return null
      },
      (error) => {
        settled = true
        return error
      },
    )
    const first = failingTask || 'build'
    release.get(first)()
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(settled, false, 'must wait for the other child even after failure')
    release.get(first === 'build' ? 'browser' : 'build')()
    const error = await verdict
    assert.equal(finished.length, 2)
    if (failingTask) assert.equal(error.message, `${failingTask} failed`)
    else assert.equal(error, null)
  })
}

test('local build preparation does not install Linux browser dependencies', async () => {
  const calls = []
  await preparePackedConsumer({
    root,
    cacheDirectory: '/tmp/build-cache',
    installBrowser: false,
    run: async (_command, args) => calls.push(args),
  })
  assert.equal(calls.length, 1)
  assert.equal(calls[0][1], 'turbo')
})
