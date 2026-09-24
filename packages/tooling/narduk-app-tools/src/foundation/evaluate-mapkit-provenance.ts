/**
 * Adoption requirement 9 -- *functional MapKit adoption*, repository half.
 *
 * MapKit used to live in its own repository. That repository is archived and
 * the package is published from narduk-libs, but "the app installed a package
 * called mapkit" is not the same claim as "the app consumes the maintained
 * one", and four different shapes of stale dependency all look identical from
 * a dependency list:
 *
 *   1. A standalone-era package name that is no longer published from here.
 *   2. A vendored copy checked into the repository, which a lockfile happily
 *      resolves and no registry check ever sees.
 *   3. A tarball or file: specifier pointing at a local build.
 *   4. The frozen `@narduk-enterprises/narduk-mapkit-nuxt` adapter, which is
 *      pinned at 2.0.x (narduk-libs#405, #421) and does not carry anything
 *      added since -- `./marks`, `useMapKitView()`, the vector-tile entry. A
 *      Nuxt app on the frozen adapter is on a supported package and an
 *      unsupported entry at the same time.
 *
 * This check decides the provenance and the entry point. It deliberately does
 * NOT claim the map works: that needs the real SDK in a browser, which is the
 * app's own E2E evidence, and an adoption report that inferred a working map
 * from a dependency line would be exactly the false capability claim the
 * standard forbids. `functional` is reported separately and always as
 * `evidence-required`.
 */

import { AppRepo, NUXT_CONFIG_CANDIDATES } from './source.js'
import { collectCapabilityInventory } from './capability-inventory.js'

export const MAPKIT_PACKAGE = '@narduk-enterprises/narduk-mapkit'

/** The frozen Nuxt adapter. Still published, still installable, and not the
 * entry a current app should use. */
export const FROZEN_NUXT_ADAPTER = '@narduk-enterprises/narduk-mapkit-nuxt'

/** The supported Nuxt entry, as it appears in a `modules` array. */
export const SUPPORTED_NUXT_ENTRY = '@narduk-enterprises/narduk-mapkit/nuxt'

/** Package names from before the move. None of these are published from
 * narduk-libs; a pin on one is a consumer that never migrated. */
export const STANDALONE_ERA_PACKAGES = [
  '@narduk-geo/mapkit',
  '@narduk-geo/mapkit-nuxt',
  '@narduk/mapkit',
  '@narduk/mapkit-nuxt',
  'narduk-mapkit',
] as const

/** A specifier that resolves to something other than the registry. */
const LOCAL_SPECIFIER_RE = /^(?:file:|link:|portal:|\.{1,2}\/|\/)|\.tgz$/

export type MapKitProvenance =
  /** Not a map app: nothing mapkit-shaped is depended on at all. */
  | 'not-applicable'
  /** The narduk-libs package, from the registry, on the supported entry. */
  | 'current'
  /** The narduk-libs package, but a Nuxt app using the frozen adapter. */
  | 'frozen-adapter'
  /** A standalone-era package name. */
  | 'standalone-era'
  /** A local path, tarball, or vendored copy. */
  | 'vendored'

export interface MapKitProvenanceReport {
  provenance: MapKitProvenance
  /** The mapkit-ish packages this app pins, with their specifiers. */
  pins: Array<{ package: string; version: string; manifest: string }>
  /** Nuxt module entries naming mapkit, as written in the config. */
  nuxtEntries: string[]
  /** Repo-relative paths of vendored copies found on disk. */
  vendored: string[]
  detail: string
  /** Always `evidence-required`. This check cannot prove a map renders; that
   * is real-SDK browser evidence the app supplies separately. */
  functional: 'evidence-required'
}

/** Directories a vendored copy realistically lands in. Bounded on purpose --
 * walking the whole tree to find a `node_modules` clone would be slow and
 * would report every transitive install. */
const VENDOR_ROOTS = ['vendor', 'vendored', 'third_party', 'packages'] as const

function findVendoredCopies(repo: AppRepo): string[] {
  const found: string[] = []
  for (const root of VENDOR_ROOTS) {
    for (const suffix of ['narduk-mapkit', 'mapkit']) {
      const rel = `${root}/${suffix}`
      if (repo.exists(`${rel}/package.json`)) found.push(rel)
    }
  }
  return found.sort()
}

function readNuxtModuleEntries(repo: AppRepo): string[] {
  const entries = new Set<string>()
  for (const candidate of NUXT_CONFIG_CANDIDATES) {
    const text = repo.read(candidate)
    if (text === null) continue
    // Quoted specifiers only. A computed module entry is not something this
    // check pretends to resolve; it simply will not appear, and a map app
    // whose entry cannot be read comes back without a supported entry rather
    // than with a fabricated one.
    for (const match of text.matchAll(/['"]([^'"]*mapkit[^'"]*)['"]/gi)) {
      const value = match[1]
      if (value.includes('/') || value.startsWith('@')) entries.add(value)
    }
  }
  return [...entries].sort()
}

export function runMapKitProvenanceCheck(root: string): MapKitProvenanceReport {
  const repo = new AppRepo(root)
  const { inventory } = collectCapabilityInventory(repo)

  const standalone = new Set<string>(STANDALONE_ERA_PACKAGES)
  const pins = inventory.dependencies
    .filter(
      (dep) =>
        dep.package === MAPKIT_PACKAGE ||
        dep.package === FROZEN_NUXT_ADAPTER ||
        standalone.has(dep.package),
    )
    .map((dep) => ({ manifest: dep.manifest, package: dep.package, version: dep.version }))

  // A standalone-era pin can live outside the estate scope, which the estate
  // inventory does not collect. Read the merged manifests directly for those.
  for (const candidate of ['package.json', 'apps/web/package.json', 'web/package.json']) {
    const text = repo.read(candidate)
    if (text === null) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      continue
    }
    if (typeof parsed !== 'object' || parsed === null) continue
    for (const block of ['dependencies', 'devDependencies', 'optionalDependencies'] as const) {
      const section = (parsed as Record<string, unknown>)[block]
      if (typeof section !== 'object' || section === null) continue
      for (const [name, spec] of Object.entries(section as Record<string, unknown>)) {
        if (!standalone.has(name) || typeof spec !== 'string') continue
        if (pins.some((pin) => pin.package === name && pin.manifest === candidate)) continue
        pins.push({ manifest: candidate, package: name, version: spec })
      }
    }
  }
  pins.sort((left, right) =>
    left.package === right.package
      ? left.manifest < right.manifest
        ? -1
        : 1
      : left.package < right.package
        ? -1
        : 1,
  )

  const vendored = findVendoredCopies(repo)
  const nuxtEntries = readNuxtModuleEntries(repo)
  const base = { functional: 'evidence-required' as const, nuxtEntries, pins, vendored }

  if (pins.length === 0 && vendored.length === 0) {
    return {
      ...base,
      detail: 'no MapKit dependency; this app does not draw maps',
      provenance: 'not-applicable',
    }
  }

  if (vendored.length > 0) {
    return {
      ...base,
      detail: `a vendored MapKit copy is checked in at ${vendored.join(', ')}`,
      provenance: 'vendored',
    }
  }

  const localPin = pins.find((pin) => LOCAL_SPECIFIER_RE.test(pin.version))
  if (localPin) {
    return {
      ...base,
      detail: `${localPin.package} resolves from "${localPin.version}", not the registry`,
      provenance: 'vendored',
    }
  }

  const standalonePin = pins.find((pin) => standalone.has(pin.package))
  if (standalonePin) {
    return {
      ...base,
      detail: `${standalonePin.package} is a standalone-era package, not published from narduk-libs`,
      provenance: 'standalone-era',
    }
  }

  const isNuxtApp = NUXT_CONFIG_CANDIDATES.some((candidate) => repo.exists(candidate))
  const usesFrozenAdapter =
    pins.some((pin) => pin.package === FROZEN_NUXT_ADAPTER) ||
    nuxtEntries.includes(FROZEN_NUXT_ADAPTER)

  if (usesFrozenAdapter) {
    return {
      ...base,
      detail: `${FROZEN_NUXT_ADAPTER} is frozen at 2.0.x; the supported entry is ${SUPPORTED_NUXT_ENTRY}`,
      provenance: 'frozen-adapter',
    }
  }

  if (isNuxtApp && !nuxtEntries.includes(SUPPORTED_NUXT_ENTRY)) {
    return {
      ...base,
      detail: `a Nuxt app depends on ${MAPKIT_PACKAGE} but its config does not register ${SUPPORTED_NUXT_ENTRY}`,
      provenance: 'frozen-adapter',
    }
  }

  return {
    ...base,
    detail: isNuxtApp
      ? `${MAPKIT_PACKAGE} from the registry, registered as ${SUPPORTED_NUXT_ENTRY}`
      : `${MAPKIT_PACKAGE} from the registry`,
    provenance: 'current',
  }
}
