import { describe, expect, it } from 'vitest'

import { renderRegistryAuth, resolveRegistryConfig } from '../src/registry-auth.js'

describe('registry-auth', () => {
  it('scopes GitHub Packages to the Narduk scope and keeps Loganrenz public', () => {
    const output = renderRegistryAuth(
      ['@loganrenz:registry=https://npm.pkg.github.com', 'auto-install-peers=false'].join('\n'),
      '//npm.pkg.github.com/:_authToken=stale\n',
      resolveRegistryConfig({
        NARDUK_PLATFORM_GH_PACKAGES_READ: 'test-token',
      }),
    )
    expect(output).toContain('@narduk-enterprises:registry=https://npm.pkg.github.com')
    expect(output).toContain('@loganrenz:registry=https://registry.npmjs.org/')
    expect(output).not.toContain('@loganrenz:registry=https://npm.pkg.github.com')
    expect(output).toContain('${NARDUK_PLATFORM_GH_PACKAGES_READ}')
    expect(output).not.toContain('test-token')
    expect(output).not.toContain('stale')
  })

  it('adds an explicit public Loganrenz scope even when the old global registry is private', () => {
    const output = renderRegistryAuth(
      'registry=https://npm.pkg.github.com',
      '',
      resolveRegistryConfig({ NARDUK_PLATFORM_GH_PACKAGES_READ: 'test-token' }),
    )

    expect(output).toContain('@loganrenz:registry=https://registry.npmjs.org/')
    expect(output).not.toContain('//npm.pkg.github.com/:_authToken=test-token')
  })
})
