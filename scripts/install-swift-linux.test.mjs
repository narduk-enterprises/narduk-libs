import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import test from 'node:test'

// Calls toolchain() from install-swift-linux.py with a synthetic os-release,
// returning either the selected toolchain or the error message.
function select(osRelease) {
  const program = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("installer", "scripts/install-swift-linux.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
try:
    print(json.dumps({"ok": module.toolchain(json.loads(sys.argv[1]))}))
except RuntimeError as error:
    print(json.dumps({"error": str(error)}))
`
  return JSON.parse(
    execFileSync('python3', ['-c', program, JSON.stringify(osRelease)], {
      encoding: 'utf8',
    }),
  )
}

test('Ubuntu 24.04 keeps the pinned Swift 6.3.3 noble archive', () => {
  assert.deepEqual(select({ ID: 'ubuntu', VERSION_ID: '24.04' }).ok, [
    '6.3.3',
    'swift-6.3.3-RELEASE-ubuntu24.04',
    'https://download.swift.org/swift-6.3.3-release/ubuntu2404/swift-6.3.3-RELEASE/swift-6.3.3-RELEASE-ubuntu24.04.tar.gz',
  ])
})

test('Ubuntu 26.04 selects the first release with an ubuntu26.04 archive', () => {
  assert.deepEqual(select({ ID: 'ubuntu', VERSION_ID: '26.04' }).ok, [
    '6.4.0',
    'swift-6.4.0-RELEASE-ubuntu26.04',
    'https://download.swift.org/swift-6.4.0-release/ubuntu2604/swift-6.4.0-RELEASE/swift-6.4.0-RELEASE-ubuntu26.04.tar.gz',
  ])
})

test('unsupported releases fail with the release they found', () => {
  assert.match(
    select({ ID: 'ubuntu', VERSION_ID: '22.04' }).error,
    /No pinned signed Swift archive for ubuntu 22\.04; supported: Ubuntu 24\.04, Ubuntu 26\.04/,
  )
  assert.match(
    select({ ID: 'debian', VERSION_ID: '24.04' }).error,
    /No pinned signed Swift archive for debian 24\.04/,
  )
})
