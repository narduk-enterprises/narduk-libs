import { readFileSync, readdirSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

interface PackageManifest {
  name: string
  version: string
  license: string
  type: string
  files: string[]
  scripts: Record<string, string>
  exports: Record<string, unknown>
  dependencies: Record<string, string>
  devDependencies: Record<string, string>
  peerDependencies: Record<string, string>
}

const pkg = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as PackageManifest

/** DESIGN.md: "the 14 capability pack names survive". */
const CAPABILITY_PACK_NAMES = [
  'core',
  'design-system',
  'nuxt-ui',
  'seo',
  'cloudflare',
  'server',
  'auth',
  'template',
  'correctness',
  'a11y',
  'complexity',
  'formatting',
  'e2e',
  'monorepo',
]

/** v1 preset names that must not come back as exports. */
const LEGACY_PRESET_NAMES = [
  'recommended',
  'nuxt',
  'vue',
  'vue-strict',
  'vueStrict',
  'app',
  'all',
  'styling',
  'hydration',
  'nuxtCore',
  'vueCore',
  'pinia',
  'serverData',
  'serverRuntime',
  'templateVue',
  'templateProject',
  'templateServer',
  'clientAppPerf',
]

describe('package manifest', () => {
  it('carries the estate license and module type', () => {
    expect(pkg.name).toBe('@narduk-enterprises/eslint-config')
    // D-PKG-5: v1 wrongly claimed MIT.
    expect(pkg.license).toBe('UNLICENSED')
    expect(pkg.type).toBe('module')
  })

  /**
   * The manifest must NOT already say `2.0.0`.
   *
   * Changesets versions *from the manifest*: it applies the highest pending
   * bump to whatever `version` currently reads. A manifest hand-set to `2.0.0`
   * plus a `major` changeset resolves to **3.0.0**, silently burning the major
   * this release is named for — and nothing in the pipeline objects, because
   * both halves are individually valid. The manifest therefore stays at the
   * last published v1 (`1.2.19`, the version the demoted incubator repo pushed
   * on 2026-07-26) and the changeset is what produces 2.0.0.
   *
   * Asserted as "still pre-2.0.0, with a major changeset pending" rather than
   * as an exact string, so the check keeps meaning something after the release
   * commit lands and the manifest legitimately becomes 2.0.0.
   */
  it('is still pre-2.0.0, with the major bump held in a changeset', () => {
    const [major] = pkg.version.split('.').map(Number)
    expect(Number.isFinite(major)).toBe(true)
    expect(major).toBeLessThan(2)

    const changesets = readdirSync(new URL('../../../../.changeset', import.meta.url))
      .filter((entry) => entry.endsWith('.md') && entry !== 'README.md')
      .map((entry) =>
        readFileSync(new URL(`../../../../.changeset/${entry}`, import.meta.url), 'utf8'),
      )

    const majorBump = changesets.some((body) =>
      /^'@narduk-enterprises\/eslint-config':\s*major$/m.test(body),
    )
    expect(majorBump, 'no pending major changeset for @narduk-enterprises/eslint-config').toBe(true)
  })

  it('peers ESLint 10 and vue-eslint-parser 10', () => {
    expect(pkg.peerDependencies.eslint).toBe('^10.0.0')
    expect(pkg.peerDependencies['vue-eslint-parser']).toBe('^10.0.0')
  })

  it('drops every dependency DESIGN.md drops', () => {
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies }

    // The narduk-skills postinstall coupling.
    expect(allDeps).not.toHaveProperty('@narduk-enterprises/narduk-skills')
    expect(pkg.scripts).not.toHaveProperty('postinstall')
    expect(pkg.scripts).not.toHaveProperty('sync:skills')

    // Abandoned; replaced by @vitest/eslint-plugin.
    expect(allDeps).not.toHaveProperty('eslint-plugin-vitest')
    expect(pkg.dependencies).toHaveProperty('@vitest/eslint-plugin')

    // Only the dropped SPA data-fetch rule used picomatch.
    expect(allDeps).not.toHaveProperty('picomatch')
    expect(allDeps).not.toHaveProperty('@types/picomatch')
  })

  it('wires the maintained third-party replacements', () => {
    expect(pkg.dependencies).toHaveProperty('eslint-plugin-better-tailwindcss')
    expect(pkg.dependencies).toHaveProperty('eslint-plugin-pinia')
    expect(pkg.dependencies).toHaveProperty('@nuxt/eslint-plugin')
  })
})

describe('exports map', () => {
  const exportKeys = Object.keys(pkg.exports)

  it('exports exactly the fourteen capability packs', () => {
    const packExports = exportKeys
      .filter((key) => key.startsWith('./config/'))
      .map((key) => key.slice('./config/'.length))

    expect(packExports.sort()).toEqual([...CAPABILITY_PACK_NAMES].sort())
  })

  it('exports the app config under both v1 entry points', () => {
    expect(pkg.exports['./eslint-app-config']).toEqual({ import: './eslint-app-config.mjs' })
    // v1's `./config` pointed at eslint.config.mjs, which owned
    // composeSharedConfigs; v2 folds that into eslint-app-config.mjs.
    expect(pkg.exports['./config']).toEqual({ import: './eslint-app-config.mjs' })
  })

  it('exposes no legacy preset export', () => {
    for (const legacyName of LEGACY_PRESET_NAMES) {
      expect(exportKeys).not.toContain(`./config/${legacyName}`)
      expect(exportKeys).not.toContain(`./${legacyName}`)
    }
  })

  it('drops the v1 SPA data-fetch fragment entry point', () => {
    expect(exportKeys).not.toContain('./eslint-nuxt-spa-data-fetch')
  })

  it('keeps the flat-fragments subpath as the v1 compat shim', () => {
    // DESIGN.md build-time drop record: the standalone
    // eslint-plugin-redundant-nuxt-auto-import is dropped, but the subpath
    // survives so narduk-core's re-export and consumer configs keep resolving.
    expect(exportKeys).toContain('./eslint-nuxt-flat-fragments')
    expect(pkg.exports['./eslint-nuxt-flat-fragments']).toBe('./eslint-nuxt-flat-fragments.mjs')
  })
})

describe('published files', () => {
  it('ships the bundle, the packs, and the app config', () => {
    expect(pkg.files).toContain('dist/')
    expect(pkg.files).toContain('configs/')
    expect(pkg.files).toContain('eslint-app-config.mjs')
    expect(pkg.files).toContain('README.md')
  })

  it('ships every file the exports map points at', () => {
    // An export subpath whose target is outside `files` resolves locally and
    // 404s from the tarball — the failure mode publint calls "file does not
    // exist". Asserted here so a new subpath cannot ship unpublished.
    const targets = new Set<string>()

    const collect = (value: unknown): void => {
      if (typeof value === 'string') {
        targets.add(value)
        return
      }
      if (value && typeof value === 'object') {
        for (const nested of Object.values(value)) {
          collect(nested)
        }
      }
    }

    collect(pkg.exports)

    const unpublished = [...targets]
      .map((target) => target.replace(/^\.\//, ''))
      .filter((target) => target !== 'package.json')
      .filter(
        (target) =>
          !pkg.files.some((entry) => {
            const normalized = entry.replace(/^\.\//, '')
            return normalized.endsWith('/') ? target.startsWith(normalized) : target === normalized
          }),
      )

    expect(unpublished).toEqual([])
  })

  it('ships no postinstall or skills tooling', () => {
    for (const entry of pkg.files) {
      expect(entry).not.toMatch(/skills/i)
      expect(entry).not.toMatch(/postinstall/i)
    }
  })
})
