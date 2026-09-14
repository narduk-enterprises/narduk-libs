import { describe, expect, it } from 'vitest'

import { renderRegistryAuth, resolveRegistryConfig } from '../src/registry-auth.js'

describe('registry-auth', () => {
  it('routes platform and MapKit packages through GitHub Packages', () => {
    const output = renderRegistryAuth(
      ['@narduk-geo:registry=https://registry.npmjs.org', 'auto-install-peers=false'].join('\n'),
      '//npm.pkg.github.com/:_authToken=stale\n',
      resolveRegistryConfig({
        GH_PACKAGES_READ: 'test-token',
      }),
    )
    expect(output).toContain('@narduk-enterprises:registry=https://npm.pkg.github.com')
    expect(output).toContain('@narduk-geo:registry=https://npm.pkg.github.com')
    expect(output).toContain('${GH_PACKAGES_READ}')
    expect(output).not.toContain('test-token')
    expect(output).not.toContain('stale')
  })

  it('adds both managed scopes and removes the retired MapKit scope', () => {
    const output = renderRegistryAuth(
      [
        'registry=https://registry.npmjs.org',
        '@loganrenz:registry=https://registry.npmjs.org',
      ].join('\n'),
      '',
      resolveRegistryConfig({ GH_PACKAGES_READ: 'test-token' }),
    )

    expect(output).toContain('@narduk-enterprises:registry=https://npm.pkg.github.com')
    expect(output).toContain('@narduk-geo:registry=https://npm.pkg.github.com')
    expect(output).not.toContain('@loganrenz:registry=')
    expect(output).not.toContain('//npm.pkg.github.com/:_authToken=test-token')
  })
})
