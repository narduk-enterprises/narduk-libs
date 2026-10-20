import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

/**
 * narduk-libs#1033, #1940: this package renders Nuxt UI components, so it
 * declares `@nuxt/ui` as a peer. narduk-core declares the same range (a peer,
 * not a pin, so an existing app on any 4.x from 4.7.1 keeps its own copy), and
 * is tested against the version it carries as a devDependency.
 */
function manifest(path: string): Record<string, Record<string, string> | undefined> {
  return JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as Record<
    string,
    Record<string, string> | undefined
  >
}

describe('@nuxt/ui peer (#1033)', () => {
  it('is a peer on the same range as narduk-core', () => {
    const own = manifest('../package.json')
    const core = manifest('../../narduk-core/package.json')

    expect(own.peerDependencies?.['@nuxt/ui']).toBe('>=4.7.1 <5')
    expect(core.peerDependencies?.['@nuxt/ui']).toBe(own.peerDependencies?.['@nuxt/ui'])
  })

  it('is no longer a hard dependency of narduk-core', () => {
    const core = manifest('../../narduk-core/package.json')

    expect(core.dependencies?.['@nuxt/ui']).toBeUndefined()
    expect(core.devDependencies?.['@nuxt/ui']).toMatch(/^4\.\d+\.\d+$/u)
  })
})
