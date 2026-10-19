import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

/**
 * narduk-libs#1033: this package renders Nuxt UI components, so it declares
 * `@nuxt/ui` as a peer at exactly the version narduk-core is built and tested against (its
 * devDependency; core itself declares a range peer since narduk-libs#1940).
 */
function manifest(path: string): Record<string, Record<string, string> | undefined> {
  return JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as Record<
    string,
    Record<string, string> | undefined
  >
}

describe('@nuxt/ui peer (#1033)', () => {
  it('is a peer at the version narduk-core is tested against', () => {
    const own = manifest('../package.json')
    const core = manifest('../../narduk-core/package.json')
    const pinned = core.devDependencies?.['@nuxt/ui']

    expect(pinned).toMatch(/^\d+\.\d+\.\d+$/u)
    expect(own.peerDependencies?.['@nuxt/ui']).toBe(pinned)
  })
})
