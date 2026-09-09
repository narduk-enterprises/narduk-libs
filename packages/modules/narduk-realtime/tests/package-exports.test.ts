import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

interface PackageManifest {
  dependencies: Record<string, string>
  exports: Record<string, { import: string; types: string }>
  files: string[]
  name: string
  publishConfig: { access: string; registry: string }
  private: boolean
  version: string
}

const manifest = JSON.parse(
  readFileSync(join(packageRoot, 'package.json'), 'utf8'),
) as PackageManifest

describe('narduk-realtime package surface', () => {
  it('publishes to GitHub Packages under restricted access', () => {
    expect(manifest.name).toBe('@narduk-enterprises/narduk-realtime')
    expect(manifest.private).toBe(false)
    expect(manifest.publishConfig).toEqual({
      access: 'restricted',
      registry: 'https://npm.pkg.github.com',
    })
  })

  it('exposes the module entry and the Durable Object base class', () => {
    expect(manifest.exports['.']).toEqual({
      types: './dist/module.d.ts',
      import: './dist/module.js',
    })
    expect(manifest.exports['./nuxt']).toEqual(manifest.exports['.'])
    expect(manifest.exports['./server/durable-object']).toEqual({
      types: './dist/server/durable-object.d.ts',
      import: './dist/server/durable-object.js',
    })
  })

  // Everything the exports map names has to be inside a `files` entry, or the
  // published tarball resolves to nothing on the consumer's side.
  it('ships every export target in the tarball', () => {
    for (const target of Object.values(manifest.exports).flatMap((entry) => [
      entry.import,
      entry.types,
    ])) {
      expect(
        manifest.files.some((included) => target.startsWith(`./${included.replace(/\/$/u, '')}`)),
        target,
      ).toBe(true)
    }
  })

  // A build-time Nuxt module: @nuxt/kit is the only runtime dependency, and
  // @cloudflare/workers-types stays a type-only devDependency.
  it('adds no runtime dependency beyond @nuxt/kit', () => {
    expect(Object.keys(manifest.dependencies)).toEqual(['@nuxt/kit'])
  })

  it('starts at the first minor of its own line', () => {
    expect(manifest.version).toMatch(/^0\.\d+\.\d+$/u)
  })
})
