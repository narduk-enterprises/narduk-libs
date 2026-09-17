import assert from 'node:assert/strict'
import { test } from 'node:test'
import consumerSmokeFonts from './consumer-smoke-fonts.mjs'

test('the fixture removes Fontshare before initialization and preserves required font resolution', () => {
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
  const google = () => 'Inter font data'
  const futureProvider = () => 'other font data'
  const providers = {
    local,
    google,
    futureProvider,
    fontshare() {
      throw new Error('Unused Fontshare catalog must never initialize')
    },
  }
  hook(providers)
  assert.deepEqual(providers, { local, google, futureProvider })
  assert.equal(providers.google(), 'Inter font data')
  assert.equal(providers.local(), 'local files')
})
