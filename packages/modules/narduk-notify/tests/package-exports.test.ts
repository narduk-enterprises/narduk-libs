import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import * as root from '../src/index'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>
  exports: Record<string, unknown>
  files: string[]
  name: string
  private: boolean
  publishConfig: Record<string, string>
  version: string
}

describe('narduk-notify package surface', () => {
  it('publishes to GitHub Packages under restricted access with a parseable version', () => {
    expect(manifest.name).toBe('@narduk-enterprises/narduk-notify')
    expect(manifest.private).toBe(false)
    expect(manifest.publishConfig).toEqual({
      access: 'restricted',
      registry: 'https://npm.pkg.github.com',
    })
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z-.]+)?$/u)
  })

  it('has no runtime dependencies: fetch, Web Crypto and D1 come from the host', () => {
    expect(manifest.dependencies ?? {}).toEqual({})
  })

  it('keeps node:http2 out of the root entry so Workers bundles never import it', () => {
    expect(Object.keys(manifest.exports)).toEqual(['.', './node', './migrations/*'])
    for (const file of readdirSync(join(packageRoot, 'src'))) {
      if (file === 'node.ts') continue
      expect(readFileSync(join(packageRoot, 'src', file), 'utf8')).not.toMatch(/from 'node:/u)
    }
    expect(Object.keys(root)).toEqual(
      expect.arrayContaining([
        'createApnsClient',
        'buildApnsRequest',
        'createResendClient',
        'createNotifier',
        'createNotifyPreferences',
        'recordDeliveries',
        'listDeliveries',
        'pruneDeliveries',
      ]),
    )
    expect(Object.keys(root)).not.toContain('createNodeHttp2Transport')
  })

  it('ships the D1 migrations', () => {
    expect(manifest.files).toContain('migrations/')
    expect(readdirSync(join(packageRoot, 'migrations'))).toEqual(['0001_notify.sql'])
  })
})
