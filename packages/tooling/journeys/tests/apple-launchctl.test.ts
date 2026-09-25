import { describe, expect, it } from 'vitest'

import { pidFromLaunchctlList } from '../src/apple-control.js'

// Shaped like `xcrun simctl spawn <udid> launchctl list`: PID, status, label.
const LIST = [
  'PID\tStatus\tLabel',
  '4101\t0\tUIKitApplication:com.narduk.stonx.watchkitapp[1a2b][rb-legacy]',
  '4102\t0\tUIKitApplication:com.narduk.stonx-beta[3c4d][rb-legacy]',
  '4103\t0\tUIKitApplication:com.narduk.stonx[5e6f][rb-legacy]',
  '-\t0\tUIKitApplication:com.narduk.idle[7a8b][rb-legacy]',
  '88\t0\tcom.apple.backboardd',
].join('\n')

describe('pidFromLaunchctlList', () => {
  it('matches the whole label, not a bundle id it prefixes (#883)', () => {
    expect(pidFromLaunchctlList(LIST, 'com.narduk.stonx')).toBe(4103)
    expect(pidFromLaunchctlList(LIST, 'com.narduk.stonx.watchkitapp')).toBe(4101)
    expect(pidFromLaunchctlList(LIST, 'com.narduk.stonx-beta')).toBe(4102)
  })

  it('accepts a label without instance tags', () => {
    expect(
      pidFromLaunchctlList('512\t0\tUIKitApplication:com.narduk.stonx\n', 'com.narduk.stonx'),
    ).toBe(512)
  })

  it('returns null for an app that is loaded but not running, or absent', () => {
    expect(pidFromLaunchctlList(LIST, 'com.narduk.idle')).toBeNull()
    expect(pidFromLaunchctlList(LIST, 'com.narduk.missing')).toBeNull()
    expect(pidFromLaunchctlList(LIST, 'com.narduk')).toBeNull()
  })
})
