import assert from 'node:assert/strict'
import { test } from 'node:test'
import consumerSmokeFonts from './consumer-smoke-fonts.mjs'

test('the fixture removes unused catalogs before initialization and preserves required font resolution', () => {
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
    bunny() {
      throw new Error('Unused Bunny catalog must never initialize')
    },
  }
  const logged = []
  const originalLog = console.log
  console.log = (line) => logged.push(line)
  try {
    hook(providers)
  } finally {
    console.log = originalLog
  }
  assert.deepEqual(providers, { local, google, futureProvider })
  assert.equal(providers.google(), 'Inter font data')
  assert.equal(providers.local(), 'local files')
  // release-packages.mjs proves the fixture ran by matching this prefix, and
  // reads the rest to see which catalogs went. A provider removed without
  // being named here would make that proof quietly incomplete.
  assert.deepEqual(logged, [
    '[consumer-smoke] Unused font catalog providers disabled: fontshare, bunny',
  ])
})
