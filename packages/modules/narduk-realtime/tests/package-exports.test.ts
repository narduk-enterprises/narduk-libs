import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { UPGRADE_ROUTER_MODULE } from '../src/worker-entry.js'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

interface PackageManifest {
  dependencies: Record<string, string>
  exports: Record<string, { import: string; types: string }>
  files: string[]
  name: string
  publishConfig: { access: string; registry: string }
  private: boolean
  scripts: Record<string, string>
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

  // The upgrade router is imported by the GENERATED Worker entry under exactly
  // this specifier (`UPGRADE_ROUTER_MODULE`), so a rename here breaks every
  // built app that declares an upgrade.
  it('exposes the upgrade router and the principal helper the router writes', () => {
    expect(manifest.exports['./worker/upgrade-router']).toEqual({
      types: './dist/worker/upgrade-router.d.ts',
      import: './dist/worker/upgrade-router.js',
    })
    expect(manifest.exports['./worker/principal']).toEqual({
      types: './dist/worker/principal.d.ts',
      import: './dist/worker/principal.js',
    })
    expect(`${manifest.name}/worker/upgrade-router`).toBe(UPGRADE_ROUTER_MODULE)
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

  // This package's `dist/` is committed, so a refactor pushed without a rebuild
  // hands a git-dependency consumer type errors on exports `src` clearly
  // declares -- which is exactly what happened before the check was wired in.
  it('checks the committed dist output on every build and package check', () => {
    expect(manifest.scripts.build).toContain('scripts/check-dist-clean.mjs')
    expect(manifest.scripts['check:package']).toContain('scripts/check-dist-clean.mjs')
  })

  // Not pinned to a literal or to major 0. narduk-postgres and
  // narduk-timeseries copied this exact regex and it broke CI at their first
  // release (narduk-libs#291, #297 -- the same defect twice). This proves the
  // manifest carries a parseable semver, which is what a package-surface test
  // can actually promise; it says nothing about how far the package has
  // released, so no future bump -- including this package's own -- can fail
  // it again.
  it('carries a parseable semantic version', () => {
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z-.]+)?$/u)
  })
})
