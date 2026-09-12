import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

interface PackageManifest {
  dependencies?: Record<string, string>
  exports: Record<string, { import: string; types: string }>
  files: string[]
  name: string
  private: boolean
  publishConfig: { access: string; registry: string }
  scripts: Record<string, string>
  version: string
}

const manifest = JSON.parse(
  readFileSync(join(packageRoot, 'package.json'), 'utf8'),
) as PackageManifest

describe('narduk-postgres package surface', () => {
  it('publishes to GitHub Packages under restricted access at its first minor', () => {
    expect(manifest.name).toBe('@narduk-enterprises/narduk-postgres')
    expect(manifest.private).toBe(false)
    expect(manifest.version).toBe('0.1.0')
    expect(manifest.publishConfig).toEqual({
      access: 'restricted',
      registry: 'https://npm.pkg.github.com',
    })
  })

  it('exposes the four runtime subpaths the consumer imports', () => {
    for (const subpath of ['.', './worker', './node', './migrate', './testing']) {
      expect(manifest.exports[subpath]).toBeDefined()
    }
    expect(manifest.exports['./worker']).toEqual({
      types: './dist/worker.d.ts',
      import: './dist/worker.js',
    })
  })

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

  // The driver stays the consumer's: a Worker bundle carries only the driver
  // the app chose, and swapping postgres.js for node-postgres is an app edit.
  it('has no runtime dependency at all, and imports no driver', () => {
    expect(manifest.dependencies ?? {}).toEqual({})
    const sources = ['worker.ts', 'node.ts', 'migrate.ts', 'index.ts', 'testing.ts'].map((file) =>
      readFileSync(join(packageRoot, 'src', file), 'utf8'),
    )
    for (const source of sources) {
      expect(source).not.toMatch(/^import .* from 'postgres'/mu)
      expect(source).not.toMatch(/^import .* from 'pg'/mu)
    }
  })

  // `./migrate` has to stay importable inside a Worker bundle, so the
  // filesystem lives in `./node` and nowhere else.
  it('keeps node: imports out of every module a Worker can import', () => {
    for (const file of ['index.ts', 'worker.ts', 'migrate.ts', 'testing.ts']) {
      expect(readFileSync(join(packageRoot, 'src', file), 'utf8')).not.toContain("from 'node:")
    }
    expect(readFileSync(join(packageRoot, 'src', 'node.ts'), 'utf8')).toContain(
      "from 'node:fs/promises'",
    )
  })

  it('builds its dist before packing, so a published tarball is never empty', () => {
    expect(manifest.scripts.prepack).toContain('build')
    expect(manifest.scripts['check:package']).toContain('publint --strict')
  })
})
