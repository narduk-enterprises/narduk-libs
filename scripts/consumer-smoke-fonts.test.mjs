import assert from 'node:assert/strict'
import { test } from 'node:test'
import consumerSmokeFonts from './consumer-smoke-fonts.mjs'

test('the fixture retains local font processing and removes every remote provider before initialization', () => {
  let hook
  consumerSmokeFonts(
    {},
    {
      hook(name, callback) {
        assert.equal(name, 'fonts:providers')
        hook = callback
      },
    },
  )
  const local = () => 'local files'
  const remote = () => {
    throw new Error('Remote font provider must never initialize')
  }
  const providers = { local, google: remote, fontshare: remote, futureProvider: remote }
  hook(providers)
  assert.deepEqual(Object.keys(providers), ['local'])
  assert.equal(providers.local(), 'local files')
  assert.throws(() => hook({ google: remote }), /requires the local font provider/)
})
