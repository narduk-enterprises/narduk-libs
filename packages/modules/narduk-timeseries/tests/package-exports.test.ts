import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

interface PackageManifest {
  dependencies?: Record<string, string>
  exports: Record<string, string | { import: string; types: string }>
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

describe('narduk-timeseries package surface', () => {
  it('publishes to GitHub Packages under restricted access', () => {
    expect(manifest.name).toBe('@narduk-enterprises/narduk-timeseries')
    expect(manifest.private).toBe(false)
    expect(manifest.publishConfig).toEqual({
      access: 'restricted',
      registry: 'https://npm.pkg.github.com',
    })
  })

  // Not pinned to a literal or to major 0. A hardcoded '0.1.0' failed CI the
  // moment changesets bumped this package to 0.2.0, and the regex that
  // replaced it (`/^0\.\d+\.\d+$/`) only moves the same failure to this
  // package's first 1.0.0 (narduk-libs#291, #297 -- the same defect twice).
  // This proves the manifest carries a parseable semver, which is what a
  // package-surface test can actually promise; it says nothing about how far
  // the package has released, so no future bump can fail it again.
  it('carries a parseable semantic version', () => {
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z-.]+)?$/u)
  })

  // `workspace:*` is what makes the internal dependency pack as the exact
  // version; a range would make the packed tarball resolve some other build.
  it('depends on narduk-postgres by exact workspace version and on nothing else', () => {
    expect(manifest.dependencies).toEqual({
      '@narduk-enterprises/narduk-postgres': 'workspace:*',
    })
  })

  it('separates the type-only entry from the SQL-bearing subpaths', () => {
    expect(manifest.exports['.']).toEqual({
      types: './dist/index.d.ts',
      import: './dist/index.js',
    })
    expect(manifest.exports['./timescale']).toBeDefined()
    expect(manifest.exports['./influx']).toBeDefined()
    // The .sql files are the deploy job's input, so they are addressable.
    expect(manifest.exports['./migrations/*']).toBe('./migrations/*')
  })

  it('ships the migrations and every export target in the tarball', () => {
    expect(manifest.files).toContain('migrations/')
    const targets = Object.values(manifest.exports).flatMap((entry) =>
      typeof entry === 'string' ? [entry] : [entry.import, entry.types],
    )
    for (const target of targets) {
      expect(
        manifest.files.some((included) => target.startsWith(`./${included.replace(/\/$/u, '')}`)),
        target,
      ).toBe(true)
    }
    expect(readdirSync(join(packageRoot, 'migrations')).length).toBeGreaterThan(0)
  })

  // The root entry is what a route handler or a second backend imports. Pulling
  // SQL in there would make every consumer carry the Timescale adapter.
  it('keeps SQL out of the root entry', () => {
    const root = readFileSync(join(packageRoot, 'src', 'index.ts'), 'utf8')
    expect(root).not.toMatch(/^(?:import|export).*'\.\/(?:timescale|influx)/mu)
    expect(root).not.toContain('INSERT INTO')
  })

  it('imports no driver and reaches the filesystem only through narduk-postgres', () => {
    const sources = readdirSync(join(packageRoot, 'src'), { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
      .map((entry) => readFileSync(join(entry.parentPath, entry.name), 'utf8'))
    for (const source of sources) {
      expect(source).not.toMatch(/^import .* from 'postgres'/mu)
      expect(source).not.toMatch(/^import .* from 'pg'/mu)
      expect(source).not.toContain("from 'node:")
    }
  })

  it('builds its dist before packing, so a published tarball is never empty', () => {
    expect(manifest.scripts.prepack).toContain('build')
    expect(manifest.scripts['check:package']).toContain('publint --strict')
  })
})
