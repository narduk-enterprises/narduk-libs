import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  assertResolvedSeoUnheadCompatibility,
  assertSeoUnheadCompatible,
  readSeoUnheadStack,
  seoUnheadIncompatibility,
} from '../shared/seoUnheadCompat'

const tempRoots: string[] = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { force: true, recursive: true })
})

const MANIFEST = 'package.json'
const NODE_MODULES = 'node_modules'
const UNHEAD = '@unhead/vue'
const UNHEAD_3 = '3.4.1'
const SCHEMA_ORG = 'nuxt-schema-org'
const SEO_UTILS = 'nuxt-seo-utils'
const OLD_SCHEMA = '6.0.4'
const OLD_UTILS = '8.1.7'

function writeJson(path: string, value: unknown): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value)}\n`)
}

function manifest(root: string, ...segments: string[]): string {
  return join(root, ...segments, MANIFEST)
}

/**
 * App-shaped tree: Nuxt's own @unhead/vue, plus the SEO packages the app
 * resolved. Nothing here is the copy narduk-seo itself depends on.
 */
function writeStack(options: {
  schemaOrg: string
  seoUtils: string
  unhead: string
  unheadNestedUnderNuxt?: boolean
}): string {
  const root = mkdtempSync(join(tmpdir(), 'narduk-seo-unhead-'))
  tempRoots.push(root)
  writeJson(manifest(root), { name: 'fixture-app', private: true })
  writeJson(manifest(root, NODE_MODULES, 'nuxt'), { name: 'nuxt', version: '4.5.2' })
  const unheadDir = options.unheadNestedUnderNuxt
    ? [NODE_MODULES, 'nuxt', NODE_MODULES, '@unhead', 'vue']
    : [NODE_MODULES, '@unhead', 'vue']
  writeJson(manifest(root, ...unheadDir), { name: UNHEAD, version: options.unhead })
  writeJson(manifest(root, NODE_MODULES, SCHEMA_ORG), {
    name: SCHEMA_ORG,
    version: options.schemaOrg,
  })
  writeJson(manifest(root, NODE_MODULES, SEO_UTILS), {
    name: SEO_UTILS,
    version: options.seoUtils,
  })
  return root
}

describe('Unhead / SEO package compatibility (narduk-libs#1190)', () => {
  it('accepts Unhead 2 with the older SEO packages', () => {
    expect(
      seoUnheadIncompatibility({
        schemaOrgVersion: OLD_SCHEMA,
        seoUtilsVersion: OLD_UTILS,
        unheadVersion: '2.1.12',
      }),
    ).toBeNull()
  })

  it('accepts Unhead 3 with nuxt-schema-org >=6.3 and nuxt-seo-utils >=8.5', () => {
    expect(() =>
      assertSeoUnheadCompatible({
        schemaOrgVersion: '6.3.2',
        seoUtilsVersion: '8.5.1',
        unheadVersion: UNHEAD_3,
      }),
    ).not.toThrow()
  })

  it('fails the build when Unhead 3 meets an older schema-org or seo-utils', () => {
    expect(() =>
      assertSeoUnheadCompatible({
        schemaOrgVersion: OLD_SCHEMA,
        seoUtilsVersion: OLD_UTILS,
        unheadVersion: UNHEAD_3,
      }),
    ).toThrow(/nuxt-schema-org@6\.0\.4.*nuxt-seo-utils@8\.1\.7.*JSON-LD/su)

    const onlyUtils = seoUnheadIncompatibility({
      schemaOrgVersion: '6.3.2',
      seoUtilsVersion: '8.4.0',
      unheadVersion: UNHEAD_3,
    })
    expect(onlyUtils).toMatch(/incompatible with nuxt-seo-utils@8\.4\.0/u)
    expect(onlyUtils).not.toMatch(/nuxt-schema-org@/u)
  })

  it('fires against a resolved Unhead 3 tree whose SEO packages are too old', () => {
    const root = writeStack({
      schemaOrg: OLD_SCHEMA,
      seoUtils: OLD_UTILS,
      unhead: UNHEAD_3,
      unheadNestedUnderNuxt: true,
    })

    expect(() =>
      assertResolvedSeoUnheadCompatibility({ moduleUrl: import.meta.url, rootDir: root }),
    ).toThrow(/@unhead\/vue@3\.4\.1 is incompatible with nuxt-schema-org@6\.0\.4/u)
    expect(readSeoUnheadStack([manifest(root)])).toEqual({
      schemaOrgVersion: OLD_SCHEMA,
      seoUtilsVersion: OLD_UTILS,
      unheadVersion: UNHEAD_3,
    })
  })

  it('accepts a resolved Unhead 3 tree on the fixed SEO package floors', () => {
    const root = writeStack({
      schemaOrg: '6.3.2',
      seoUtils: '8.5.1',
      unhead: UNHEAD_3,
    })

    expect(() =>
      assertResolvedSeoUnheadCompatibility({ moduleUrl: import.meta.url, rootDir: root }),
    ).not.toThrow()
  })

  it('refuses to continue when a required package version cannot be read', () => {
    const root = mkdtempSync(join(tmpdir(), 'narduk-seo-unhead-missing-'))
    tempRoots.push(root)
    writeJson(manifest(root), { name: 'fixture-app', private: true })
    writeJson(manifest(root, NODE_MODULES, '@unhead', 'vue'), {
      name: UNHEAD,
      version: UNHEAD_3,
    })

    expect(() => readSeoUnheadStack([manifest(root)])).toThrow(
      /Could not read the installed version of nuxt-schema-org/u,
    )
  })
})
