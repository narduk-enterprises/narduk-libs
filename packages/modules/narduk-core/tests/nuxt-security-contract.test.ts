/**
 * The preset depends on four undocumented facts about nuxt-security's build
 * output, and every one of them would fail SILENTLY if upstream changed it --
 * the app would keep serving a CSP, just a broken or non-enforcing one. A unit
 * test on our own config object cannot see any of that, so these read the
 * installed package.
 *
 * `scripts/prove-nonce.mjs` is the live half of the same guard, but it needs a
 * full Nitro build and a browser, so it is run by hand rather than in CI. These
 * assertions are the cheap tripwire that fires on `pnpm update` first.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { buildNuxtSecurityConfig, resolveSecurityHeaders } from '../runtime/shared/security-headers'

// nuxt-security's `exports` map publishes only `.` (ESM), so a deep subpath is
// not resolvable by specifier. Resolve the one export it does publish and walk
// up out of `dist/` to the package root.
const packageRoot = dirname(dirname(fileURLToPath(import.meta.resolve('nuxt-security'))))

function nuxtSecurityFile(relative: string): string {
  return readFileSync(join(packageRoot, relative), 'utf8')
}

function nuxtSecurityPackageJson(): { dependencies: Record<string, string>; version: string } {
  return JSON.parse(nuxtSecurityFile('package.json')) as {
    dependencies: Record<string, string>
    version: string
  }
}

describe('nuxt-security package', () => {
  it('is a version whose Nuxt 4 support we checked', () => {
    const pkg = nuxtSecurityPackageJson()
    expect(pkg.version.startsWith('2.')).toBe(true)
    // `@nuxt/kit ^4` is the thing that makes it a Nuxt 4 module at all.
    expect(pkg.dependencies['@nuxt/kit']).toMatch(/^\^?4\./)
  })

  it('imports no Node builtin at runtime, which is why it runs on workerd', () => {
    // Build-time code (dist/module.mjs) may use node:fs freely -- Nuxt builds
    // on Node. The runtime is what ships into the Worker.
    for (const file of [
      'dist/runtime/nitro/plugins/40-cspSsrNonce.js',
      'dist/runtime/nitro/plugins/50-updateCsp.js',
      'dist/runtime/nitro/plugins/70-securityHeaders.js',
      'dist/utils/crypto.mjs',
    ]) {
      expect(nuxtSecurityFile(file)).not.toMatch(/from ["']node:/)
    }
  })

  it('mints nonces with Web Crypto rather than node:crypto', () => {
    const crypto = nuxtSecurityFile('dist/utils/crypto.mjs')
    expect(crypto).toContain('crypto.getRandomValues')
    expect(crypto).toContain('crypto.subtle.digest')
  })
})

describe('the placeholder the preset writes into script-src', () => {
  it('is the exact token nuxt-security substitutes, so it cannot silently reach the wire', () => {
    const placeholder = "'nonce-{{nonce}}'"
    expect((resolveSecurityHeaders(true).csp['script-src'] as string[]).includes(placeholder)).toBe(
      true,
    )
    expect(nuxtSecurityFile('dist/runtime/nitro/plugins/50-updateCsp.js')).toContain(placeholder)
  })

  it('is stamped onto script tags by the render:html hook', () => {
    const plugin = nuxtSecurityFile('dist/runtime/nitro/plugins/40-cspSsrNonce.js')
    expect(plugin).toContain('render:html')
    expect(plugin).toContain('nonce=')
  })
})

describe('the report-only switch', () => {
  it('is read off the rules object, not out of headers', () => {
    // If upstream moved this under `headers`, our config would keep setting a
    // sibling key that nothing reads and the soak would silently enforce.
    const plugin = nuxtSecurityFile('dist/runtime/nitro/plugins/70-securityHeaders.js')
    expect(plugin).toContain('rules.contentSecurityPolicyReportOnly')
    expect(plugin).toContain('Content-Security-Policy-Report-Only')
    expect(buildNuxtSecurityConfig(resolveSecurityHeaders(true))).toHaveProperty(
      'contentSecurityPolicyReportOnly',
    )
  })
})

describe('the capabilities the preset switches off', () => {
  it('names every one upstream defaults ON, so a new default cannot slip in', () => {
    const defaults = nuxtSecurityFile('dist/defaultConfig.mjs')
    const config = buildNuxtSecurityConfig(resolveSecurityHeaders(true)) as unknown as Record<
      string,
      unknown
    >
    for (const key of ['hidePoweredBy', 'removeLoggers', 'sri', 'nonce', 'enabled']) {
      expect(defaults).toContain(`${key}:`)
      expect(config).toHaveProperty(key)
    }
  })
})
