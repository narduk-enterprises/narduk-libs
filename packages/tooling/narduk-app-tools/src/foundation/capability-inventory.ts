/**
 * Part (a) of item 9: what the app actually pins, and which shared capability
 * each pin is.
 *
 * Item 2 asks whether the four mandatory packages are present and exactly
 * pinned; item 3 asks whether a demonstrated capability has its package. Neither
 * produces a *roster* -- the list of every `@narduk-enterprises/*` dependency
 * with its version and the manifest it came from, beside the catalog of shared
 * capabilities the estate publishes. That roster is what the estate-wide view
 * consumes, so it is built once here and carried verbatim in the artefact's
 * `inventory` block rather than being re-derived from sub-check prose.
 *
 * Every manifest in `PACKAGE_JSON_CANDIDATES` is read, not merged: an app that
 * pins `narduk-core` in `apps/web/package.json` and `narduk-app-tools` at the
 * root is two rows, each naming its own file, because "which manifest holds
 * this pin" is exactly the question a roster is asked next.
 */

import { SHARED_CAPABILITY_CATALOG, capabilityForPackage } from './capability-catalog.js'
import { allDeps, collectPackages, isRecord, type AppRepo, type FoundPackage } from './source.js'

export const ESTATE_SCOPE_PREFIX = '@narduk-enterprises/'

/** The four `package.json` blocks a pin can live in, in the order `allDeps()`
 * merges them. Recorded per row so a roster can tell a runtime dependency from
 * a dev-only tool. */
export const DEPENDENCY_BLOCKS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
] as const

export type DependencyBlock = (typeof DEPENDENCY_BLOCKS)[number]

export interface EstateDependencyRow {
  /** The pinned package name, e.g. `@narduk-enterprises/narduk-seo`. */
  package: string
  /** The specifier exactly as written, e.g. `2.2.0` or `workspace:*`. */
  version: string
  /** Repo-relative `package.json` the pin was read from. */
  manifest: string
  /** Which dependency block held it. */
  block: DependencyBlock
  /** Catalog capability id, or `null` for a package this workspace does not publish. */
  capability: string | null
}

export interface CapabilityRow {
  id: string
  package: string
  family: string
  description: string
  /** True when at least one manifest pins this capability's package. */
  adopted: boolean
  /** The specifier of the first manifest that pins it, or `null`. */
  version: string | null
  /** Every manifest that pins it, repo-relative. */
  manifests: string[]
}

export interface CapabilityInventory {
  /** Repo-relative `package.json` files that were readable, in candidate order. */
  manifests: string[]
  /** Every `@narduk-enterprises/*` pin, one row per (manifest, block, package). */
  dependencies: EstateDependencyRow[]
  /** The full shared-capability catalog, each marked adopted or not. */
  capabilities: CapabilityRow[]
  /** Estate pins with no catalog entry -- a retired, renamed, or externally
   * published `@narduk-enterprises/*` package. Sorted and de-duplicated. */
  unclassified: string[]
}

function estatePinsIn(found: FoundPackage): EstateDependencyRow[] {
  const rows: EstateDependencyRow[] = []
  for (const block of DEPENDENCY_BLOCKS) {
    const section = found.pkg[block]
    if (!isRecord(section)) continue
    for (const [name, spec] of Object.entries(section)) {
      if (!name.startsWith(ESTATE_SCOPE_PREFIX) || typeof spec !== 'string') continue
      rows.push({
        package: name,
        version: spec,
        manifest: found.rel,
        block,
        capability: capabilityForPackage(name)?.id ?? null,
      })
    }
  }
  return rows
}

/** The merged `name -> specifier` view the detectors use to ask "is this shared
 * package available to this app?". Re-exported from the same manifest list the
 * inventory was built from so the two can never disagree. */
export function mergedEstateDeps(packages: FoundPackage[]): Record<string, string> {
  const merged: Record<string, string> = {}
  for (const found of packages) Object.assign(merged, allDeps(found.pkg))
  return merged
}

export function collectCapabilityInventory(repo: AppRepo): {
  packages: FoundPackage[]
  inventory: CapabilityInventory
} {
  const packages = collectPackages(repo)
  const dependencies = packages
    .flatMap(estatePinsIn)
    .sort(
      (left, right) =>
        left.package.localeCompare(right.package) || left.manifest.localeCompare(right.manifest),
    )

  const pinnedManifests = new Map<string, string[]>()
  const pinnedVersion = new Map<string, string>()
  for (const row of dependencies) {
    const seen = pinnedManifests.get(row.package) ?? []
    if (!seen.includes(row.manifest)) seen.push(row.manifest)
    pinnedManifests.set(row.package, seen)
    if (!pinnedVersion.has(row.package)) pinnedVersion.set(row.package, row.version)
  }

  const capabilities: CapabilityRow[] = SHARED_CAPABILITY_CATALOG.map((capability) => ({
    id: capability.id,
    package: capability.package,
    family: capability.family,
    description: capability.description,
    adopted: pinnedManifests.has(capability.package),
    version: pinnedVersion.get(capability.package) ?? null,
    manifests: pinnedManifests.get(capability.package) ?? [],
  }))

  const unclassified = [
    ...new Set(dependencies.filter((row) => row.capability === null).map((row) => row.package)),
  ].sort()

  return {
    packages,
    inventory: {
      manifests: packages.map((found) => found.rel),
      dependencies,
      capabilities,
      unclassified,
    },
  }
}
