import { describe, expect, it } from 'vitest'

import { renderRegistryAuth, resolveRegistryConfig } from '../src/registry-auth'

describe('registry-auth', () => {
  it('scopes GitHub Packages to the Narduk scope and keeps Loganrenz public', () => {
    const output = renderRegistryAuth(
      ['@loganrenz:registry=https://npm.pkg.github.com', 'auto-install-peers=false'].join('\n'),
      '//npm.pkg.github.com/:_authToken=stale\n',
      resolveRegistryConfig({
        NARDUK_PLATFORM_GH_PACKAGES_READ: 'test-token',
        PACKAGE_REGISTRY_WRITE_LITERAL_TOKEN: 'false',
      }),
    )
    expect(output).toContain('@narduk-enterprises:registry=https://npm.pkg.github.com')
    expect(output).toContain('@loganrenz:registry=https://registry.npmjs.org/')
    expect(output).not.toContain('@loganrenz:registry=https://npm.pkg.github.com')
    expect(output).toContain('${NARDUK_PLATFORM_GH_PACKAGES_READ}')
    expect(output).not.toContain('stale')
  })
})
