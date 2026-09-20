import { rmSync } from 'node:fs'

import { afterEach, describe, expect, it } from 'vitest'

import {
  FROZEN_NUXT_ADAPTER,
  MAPKIT_PACKAGE,
  runMapKitProvenanceCheck,
  SUPPORTED_NUXT_ENTRY,
} from '../../src/foundation/evaluate-mapkit-provenance.js'
import { makeTempRepo, writeFile, writeJson } from './helpers.js'

const tempDirs: string[] = []
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

function run(write: (root: string) => void) {
  const root = makeTempRepo()
  tempDirs.push(root)
  write(root)
  return runMapKitProvenanceCheck(root)
}

/** A Nuxt app on the current package and the supported entry. */
function currentNuxtApp(root: string): void {
  writeJson(root, 'apps/web/package.json', { dependencies: { [MAPKIT_PACKAGE]: '2.7.0' } })
  writeFile(
    root,
    'apps/web/nuxt.config.ts',
    `export default defineNuxtConfig({ modules: ['${SUPPORTED_NUXT_ENTRY}'] })\n`,
  )
}

describe('MapKit provenance (adoption requirement 9)', () => {
  it('passes the current package on the supported Nuxt entry', () => {
    const report = run(currentNuxtApp)

    expect(report.provenance).toBe('current')
    expect(report.nuxtEntries).toContain(SUPPORTED_NUXT_ENTRY)
  })

  it('is not-applicable for an app that draws no maps', () => {
    const report = run((root) => {
      writeJson(root, 'package.json', {
        dependencies: { '@narduk-enterprises/narduk-core': '2.6.4' },
      })
    })

    expect(report.provenance).toBe('not-applicable')
    expect(report.pins).toEqual([])
  })

  it('catches the frozen Nuxt adapter even though it is a real published package', () => {
    const report = run((root) => {
      writeJson(root, 'apps/web/package.json', {
        dependencies: { [FROZEN_NUXT_ADAPTER]: '2.0.4', [MAPKIT_PACKAGE]: '2.7.0' },
      })
      writeFile(
        root,
        'apps/web/nuxt.config.ts',
        `export default defineNuxtConfig({ modules: ['${FROZEN_NUXT_ADAPTER}'] })\n`,
      )
    })

    expect(report.provenance).toBe('frozen-adapter')
    expect(report.detail).toContain('2.0.x')
  })

  it('catches a Nuxt app on the right package that never registered the entry', () => {
    const report = run((root) => {
      writeJson(root, 'apps/web/package.json', { dependencies: { [MAPKIT_PACKAGE]: '2.7.0' } })
      writeFile(root, 'apps/web/nuxt.config.ts', 'export default defineNuxtConfig({})\n')
    })

    expect(report.provenance).toBe('frozen-adapter')
    expect(report.detail).toContain(SUPPORTED_NUXT_ENTRY)
  })

  it('catches a standalone-era package name', () => {
    const report = run((root) => {
      writeJson(root, 'apps/web/package.json', { dependencies: { '@narduk-geo/mapkit': '1.4.0' } })
    })

    expect(report.provenance).toBe('standalone-era')
    expect(report.pins.map((pin) => pin.package)).toContain('@narduk-geo/mapkit')
  })

  it('catches a vendored copy a lockfile would resolve happily', () => {
    const report = run((root) => {
      currentNuxtApp(root)
      writeJson(root, 'vendor/narduk-mapkit/package.json', { name: 'narduk-mapkit' })
    })

    expect(report.provenance).toBe('vendored')
    expect(report.vendored).toContain('vendor/narduk-mapkit')
  })

  it('catches a local tarball specifier', () => {
    const report = run((root) => {
      writeJson(root, 'apps/web/package.json', {
        dependencies: { [MAPKIT_PACKAGE]: 'file:../../narduk-mapkit-2.7.0.tgz' },
      })
      writeFile(
        root,
        'apps/web/nuxt.config.ts',
        `export default defineNuxtConfig({ modules: ['${SUPPORTED_NUXT_ENTRY}'] })\n`,
      )
    })

    expect(report.provenance).toBe('vendored')
    expect(report.detail).toContain('not the registry')
  })

  it('a non-Nuxt consumer on the package is current without any module entry', () => {
    const report = run((root) => {
      writeJson(root, 'package.json', { dependencies: { [MAPKIT_PACKAGE]: '2.7.0' } })
    })

    expect(report.provenance).toBe('current')
  })

  it('never claims the map works', () => {
    // The whole point: provenance is a dependency fact, and a rendered map is
    // browser evidence. A report that inferred one from the other would be the
    // false capability claim the standard forbids.
    const report = run(currentNuxtApp)

    expect(report.functional).toBe('evidence-required')
  })
})
