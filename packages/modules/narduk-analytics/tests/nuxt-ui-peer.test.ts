import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

/**
 * narduk-libs#1033, #1981: this package renders Nuxt UI components, so it declares
 * `@nuxt/ui` as a `>=floor <5` peer. The floor must not exceed the version narduk-core
 * is built and tested against (its devDependency), so a core app always satisfies it.
 */
function manifest(path: string): Record<string, Record<string, string> | undefined> {
  return JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as Record<
    string,
    Record<string, string> | undefined
  >
}

function triple(version: string): number[] {
  return version.split('.').map(Number)
}

describe('@nuxt/ui peer (#1033, #1981)', () => {
  it('is a range whose floor core is tested against and whose ceiling is the next major', () => {
    const own = manifest('../package.json')
    const core = manifest('../../narduk-core/package.json')
    const pinned = core.devDependencies?.['@nuxt/ui']
    const peer = own.peerDependencies?.['@nuxt/ui']

    expect(pinned).toMatch(/^\d+\.\d+\.\d+$/u)
    const floor = /^>=(\d+\.\d+\.\d+) <5$/u.exec(peer ?? '')?.[1]
    expect(floor, `peer ${peer} must read ">=x.y.z <5"`).toBeDefined()
    const [fMajor, fMinor, fPatch] = triple(floor ?? '')
    const [pMajor, pMinor, pPatch] = triple(pinned ?? '')
    expect(
      fMajor === pMajor && (fMinor < pMinor || (fMinor === pMinor && fPatch <= pPatch)),
      `peer floor ${floor} must not exceed core's tested ${pinned}`,
    ).toBe(true)
  })
})
