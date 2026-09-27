import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Nuxt >= 4.5 resolves `@unhead/vue` 3. `nuxt-schema-org` below 6.3 and
 * `nuxt-seo-utils` below 8.5 peer on Unhead 2 and then emit an empty JSON-LD
 * graph and drop `og:site_name` and the twitter tags, with a green build
 * (narduk-libs#1190). These floors are the releases that speak Unhead 3.
 */
export const UNHEAD3_SCHEMA_ORG_MIN = '6.3.0'
export const UNHEAD3_SEO_UTILS_MIN = '8.5.0'

const UNHEAD_MAJOR_REQUIRING_NEW_SEO = 3
const PACKAGE_MANIFEST = 'package.json'
const SCHEMA_ORG_PACKAGE = 'nuxt-schema-org'
const SEO_UTILS_PACKAGE = 'nuxt-seo-utils'
const UNHEAD_PACKAGE = '@unhead/vue'

export interface SeoUnheadStack {
  schemaOrgVersion: string
  seoUtilsVersion: string
  unheadVersion: string
}

type VersionParts = [number, number, number]

function versionParts(version: string, label: string): VersionParts {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/u.exec(version.trim())
  if (!match) {
    throw new Error(
      `[@narduk-enterprises/narduk-seo] Could not parse the installed ${label} version "${version}". ` +
        'The Unhead compatibility check refuses to continue, because a mismatch empties JSON-LD without failing the build (narduk-libs#1190).',
    )
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function below(version: string, minimum: string, label: string): boolean {
  const actual = versionParts(version, label)
  const floor = versionParts(minimum, label)
  for (let index = 0; index < 3; index += 1) {
    const actualPart = actual[index] ?? 0
    const floorPart = floor[index] ?? 0
    if (actualPart !== floorPart) return actualPart < floorPart
  }
  return false
}

/**
 * `null` when the resolved stack can emit JSON-LD and the social tags.
 * A string when the build must stop.
 */
export function seoUnheadIncompatibility(stack: SeoUnheadStack): string | null {
  const unhead = versionParts(stack.unheadVersion, UNHEAD_PACKAGE)
  if (unhead[0] < UNHEAD_MAJOR_REQUIRING_NEW_SEO) return null

  const stale: string[] = []
  if (below(stack.schemaOrgVersion, UNHEAD3_SCHEMA_ORG_MIN, SCHEMA_ORG_PACKAGE)) {
    stale.push(
      `${SCHEMA_ORG_PACKAGE}@${stack.schemaOrgVersion} (needs >=${UNHEAD3_SCHEMA_ORG_MIN})`,
    )
  }
  if (below(stack.seoUtilsVersion, UNHEAD3_SEO_UTILS_MIN, SEO_UTILS_PACKAGE)) {
    stale.push(`${SEO_UTILS_PACKAGE}@${stack.seoUtilsVersion} (needs >=${UNHEAD3_SEO_UTILS_MIN})`)
  }
  if (stale.length === 0) return null

  return (
    `[@narduk-enterprises/narduk-seo] Resolved @unhead/vue@${stack.unheadVersion} is incompatible with ${stale.join(' and ')}. ` +
    'Unhead 3 with those releases silently empties the JSON-LD graph and drops og:site_name and the twitter tags, and the build still exits 0. ' +
    'Upgrade nuxt-schema-org to >=6.3.0 and nuxt-seo-utils to >=8.5.0 (narduk-seo >=2.8.1 depends on those floors). narduk-libs#1190.'
  )
}

export function assertSeoUnheadCompatible(stack: SeoUnheadStack): void {
  const message = seoUnheadIncompatibility(stack)
  if (message) throw new Error(message)
}

function versionFromManifest(manifestPath: string, specifier: string): string | null {
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      name?: unknown
      version?: unknown
    }
    if (parsed.name !== specifier || typeof parsed.version !== 'string') return null
    return parsed.version
  } catch {
    return null
  }
}

/**
 * `require.resolve('pkg/package.json')` fails when the package exports map
 * omits that subpath (nuxt-schema-org, nuxt-seo-utils, @unhead/vue all do).
 * The install is still a real directory under node_modules, including pnpm's
 * symlink, so walk those directories instead.
 */
function installedManifest(specifier: string, startDir: string): string | null {
  const segments = specifier.split('/')
  let dir = startDir
  for (;;) {
    const candidate = join(dir, 'node_modules', ...segments, PACKAGE_MANIFEST)
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

function firstVersion(specifier: string, startDirs: readonly string[]): string | null {
  for (const startDir of startDirs) {
    const manifest = installedManifest(specifier, startDir)
    if (!manifest) continue
    const version = versionFromManifest(manifest, specifier)
    if (version) return version
  }
  return null
}

function unheadBesideNuxt(startDir: string): string | null {
  const nuxtManifest = installedManifest('nuxt', startDir)
  if (!nuxtManifest) return null
  const nuxtPackageDir = dirname(realpathSync(nuxtManifest))
  const candidates = [
    // pnpm places dependencies next to the real package directory.
    join(dirname(nuxtPackageDir), '@unhead', 'vue', PACKAGE_MANIFEST),
    // A classic nested install, and the fixture used by the guard test.
    join(nuxtPackageDir, 'node_modules', '@unhead', 'vue', PACKAGE_MANIFEST),
  ]
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue
    const version = versionFromManifest(candidate, UNHEAD_PACKAGE)
    if (version) return version
  }
  return null
}

function resolvedUnheadVersion(startDirs: readonly string[]): string | null {
  const direct = firstVersion(UNHEAD_PACKAGE, startDirs)
  if (direct) return direct
  for (const startDir of startDirs) {
    const nested = unheadBesideNuxt(startDir)
    if (nested) return nested
  }
  return null
}

function missingVersionMessage(label: string): string {
  return (
    `[@narduk-enterprises/narduk-seo] Could not read the installed version of ${label}. ` +
    'The Unhead compatibility check refuses to continue, because a mismatch empties JSON-LD without failing the build (narduk-libs#1190).'
  )
}

/**
 * Read the `@unhead/vue`, `nuxt-schema-org` and `nuxt-seo-utils` copies Nuxt
 * will actually load. `probes` are filenames (a package.json path is enough);
 * the app root comes first so an app-level override wins over this package.
 */
export function readSeoUnheadStack(probes: readonly string[]): SeoUnheadStack {
  const startDirs = probes.map((probe) =>
    probe.endsWith(PACKAGE_MANIFEST) ? dirname(probe) : probe,
  )
  const unheadVersion = resolvedUnheadVersion(startDirs)
  const schemaOrgVersion = firstVersion(SCHEMA_ORG_PACKAGE, startDirs)
  const seoUtilsVersion = firstVersion(SEO_UTILS_PACKAGE, startDirs)
  if (!unheadVersion) throw new Error(missingVersionMessage(UNHEAD_PACKAGE))
  if (!schemaOrgVersion) throw new Error(missingVersionMessage(SCHEMA_ORG_PACKAGE))
  if (!seoUtilsVersion) throw new Error(missingVersionMessage(SEO_UTILS_PACKAGE))
  return { schemaOrgVersion, seoUtilsVersion, unheadVersion }
}

export function assertResolvedSeoUnheadCompatibility(options: {
  moduleUrl: string
  rootDir?: string
}): void {
  const moduleDir = dirname(fileURLToPath(options.moduleUrl))
  const probes = [options.rootDir, moduleDir]
    .filter((probe): probe is string => Boolean(probe))
    .map((probe) => (probe.endsWith(PACKAGE_MANIFEST) ? probe : join(probe, PACKAGE_MANIFEST)))
  assertSeoUnheadCompatible(readSeoUnheadStack(probes))
}
