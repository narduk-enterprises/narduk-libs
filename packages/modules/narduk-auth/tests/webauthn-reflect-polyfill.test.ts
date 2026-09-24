import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)

/**
 * Strips block comments and whole-line `//` comments so assertions about
 * load order cannot be satisfied by the prose that explains them.
 */
function stripComments(source: string): string {
  return source
    .replaceAll(/\/\*[\s\S]*?\*\//gu, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//u.test(line))
    .join('\n')
}

function workersShapedImport(moduleSpecifier: string, beforeImport = '') {
  return spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `
        const reflect = Reflect
        delete reflect.getMetadata
        delete reflect.getOwnMetadata
        delete reflect.defineMetadata
        ${beforeImport}
        try {
          await import(${JSON.stringify(moduleSpecifier)})
          console.log('MODULE_LOADED')
        } catch (error) {
          console.error(error && error.message ? error.message : String(error))
          process.exitCode = 2
        }
      `,
    ],
    {
      cwd: packageRoot,
      encoding: 'utf8',
      env: { ...process.env, NODE_OPTIONS: '' },
    },
  )
}

function resolveFromSimpleWebauthn(specifier: string): string {
  const simpleWebauthn = require.resolve('@simplewebauthn/server')
  return require.resolve(specifier, { paths: [simpleWebauthn] })
}

describe('Workers reflect polyfill for passkey routes (narduk-libs#786)', () => {
  it('reproduces the tsyringe load failure when Reflect.getMetadata is missing', () => {
    // Cloudflare Workers does not implement the TC39 metadata proposal.
    // @simplewebauthn/server → @peculiar/x509 → tsyringe throws at module
    // evaluation, which is the opaque 500 Logan hit on jev.nard.uk.
    const tsyringe = resolveFromSimpleWebauthn('tsyringe')
    const result = workersShapedImport(tsyringe)
    expect(result.status, result.stderr).toBe(2)
    expect(`${result.stdout}${result.stderr}`).toMatch(/reflect polyfill/i)
    expect(`${result.stdout}${result.stderr}`).not.toContain('MODULE_LOADED')
  })

  it('loads the polyfill first so @simplewebauthn/server can evaluate', async () => {
    const { installReflectMetadataPolyfill } =
      await import('../server/lib/app-auth/reflect-metadata-polyfill')
    const reflect = Reflect as typeof Reflect & { getMetadata?: unknown }
    delete reflect.getMetadata
    expect(typeof reflect.getMetadata).not.toBe('function')

    expect(installReflectMetadataPolyfill()).toBe(true)
    expect(typeof reflect.getMetadata).toBe('function')

    await expect(import('@simplewebauthn/server')).resolves.toMatchObject({
      generateAuthenticationOptions: expect.any(Function),
      generateRegistrationOptions: expect.any(Function),
    })
  })

  it('installs getOwnMetadata so a Nitro bundle can keep the polyfill', async () => {
    const { installReflectMetadataPolyfill } =
      await import('../server/lib/app-auth/reflect-metadata-polyfill')
    installReflectMetadataPolyfill()
    const target = {}
    const reflect = Reflect as typeof Reflect & {
      defineMetadata: (key: unknown, value: unknown, target: object) => void
      getOwnMetadata: (key: unknown, target: object) => unknown
    }
    reflect.defineMetadata('narduk-auth:test', 'kept', target)
    expect(reflect.getOwnMetadata('narduk-auth:test', target)).toBe('kept')
  })

  it('webauthn-server loads the polyfill before @simplewebauthn/server', () => {
    const source = stripComments(
      readFileSync(join(packageRoot, 'server/lib/app-auth/webauthn-server.ts'), 'utf8'),
    )
    const polyfillIndex = source.indexOf("from './reflect-metadata-polyfill'")
    const serverIndex = source.search(/from ['"]@simplewebauthn\/server(?:\/helpers)?['"]/u)
    expect(polyfillIndex).toBeGreaterThan(-1)
    expect(serverIndex).toBeGreaterThan(-1)
    expect(polyfillIndex).toBeLessThan(serverIndex)
    expect(source).toContain('void reflectMetadataPolyfillInstalled')
  })

  it('ceremony modules reach @simplewebauthn/server only through webauthn-server', () => {
    for (const relativePath of [
      'server/lib/app-auth/webauthn-core.ts',
      'server/lib/app-auth/webauthn-verification.ts',
    ]) {
      const source = stripComments(readFileSync(join(packageRoot, relativePath), 'utf8'))
      expect(source).toContain("from './webauthn-server'")
      expect(source).not.toMatch(/from ['"]@simplewebauthn\/server(?:\/helpers)?['"]/u)
    }
  })

  it('keeps a 00-reflect-metadata Nitro plugin that installs at module load', () => {
    const plugins = readdirSync(join(packageRoot, 'server/plugins'))
      .filter((name) => name.endsWith('.ts'))
      .sort()
    expect(plugins[0]).toBe('00-reflect-metadata.ts')

    const source = stripComments(
      readFileSync(join(packageRoot, 'server/plugins/00-reflect-metadata.ts'), 'utf8'),
    )
    expect(source).toContain('installReflectMetadataPolyfill')
    expect(source).toMatch(/installReflectMetadataPolyfill\(\)/u)
  })
})
