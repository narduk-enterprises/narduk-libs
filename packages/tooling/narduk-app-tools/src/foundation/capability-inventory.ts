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

import {
  SHARED_CAPABILITY_CATALOG,
  capabilityForPackage,
  type SharedCapability,
} from './capability-catalog.js'
import { APP_PREFIXES, SCAN_DIRECTORY_NAMES, SCAN_EXTENSIONS } from './reimplementation-signals.js'
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

/**
 * `absent`: no manifest pins the package. `adopted`: a manifest pins it and the
 * app carries no copy of its internals. `forked`: a manifest pins it AND the app
 * carries its own copy (narduk-libs#620). A fork keeps the dependency, so a
 * pin-only reading calls it adopted while the app runs private code that changes
 * on its own schedule. `forked` is reported, not failed: some forks are
 * deliberate and tracked, but none of them counts as adoption.
 */
export type CapabilityState = 'absent' | 'adopted' | 'forked'

/** The app-local copy behind a `forked` state, sized so the matrix shows it. */
export interface CapabilityFork {
  /** Repo-relative files, sorted. */
  files: string[]
  /** Total lines across `files`. */
  lines: number
}

export interface CapabilityRow {
  id: string
  package: string
  family: string
  description: string
  state: CapabilityState
  /** True only for `state: 'adopted'`: pinned, and not forked. */
  adopted: boolean
  /** The app-local copy when `state` is `forked`, otherwise `null`. */
  fork: CapabilityFork | null
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

const FORK_EXTENSIONS = [...SCAN_EXTENSIONS, '.css', '.scss'] as const

/** Does any directory segment of `rel`, or its file name without extension,
 * equal a stem? Exact and case-insensitive: `utils/mapkit/marks.ts` and
 * `app/assets/css/mapkit.css` match `mapkit`, `components/BuoyMapKitHost.vue`
 * does not. */
function underForkStem(rel: string, stems: readonly string[]): boolean {
  const segments = rel.toLowerCase().split('/')
  const file = segments.pop() ?? ''
  const names = [...segments, file.replace(/\.[^.]+$/u, '')]
  return stems.some((stem) => names.includes(stem.toLowerCase()))
}

/** A file that imports the owning package, or a sibling package named for the
 * same stem (`narduk-mapkit-nuxt`), adapts the shared code rather than
 * replacing it. */
function importsStemPackage(text: string, stems: readonly string[]): boolean {
  return stems.some((stem) =>
    new RegExp(
      `\\bfrom\\s*['"]@narduk-enterprises/narduk-${stem}[\\w-]*(?:/[^'"]*)?['"]`,
      'iu',
    ).test(text),
  )
}

/**
 * The app-local copy of a pinned capability's internals, or `null`.
 *
 * Reads the same bounded source directories item 9's reimplementation scan
 * reads, plus stylesheets. A file counts when its path names one of the
 * capability's `forkStems` and it imports no package named for that stem. It
 * under-counts rather than over-counts: a copied composable named `useMapkitX`
 * is not matched, because a stem inside a longer name also names wrappers that
 * only use the package.
 */
export function findCapabilityFork(
  repo: AppRepo,
  capability: Pick<SharedCapability, 'forkStems'>,
): CapabilityFork | null {
  const stems = capability.forkStems ?? []
  if (stems.length === 0) return null
  const files = new Set<string>()
  let lines = 0
  for (const prefix of APP_PREFIXES) {
    for (const name of SCAN_DIRECTORY_NAMES) {
      const dir = `${prefix}${name}`
      if (!repo.exists(dir)) continue
      for (const rel of repo.walk(dir, FORK_EXTENSIONS)) {
        if (files.has(rel) || !underForkStem(rel, stems)) continue
        const text = repo.read(rel)
        if (text === null || importsStemPackage(text, stems)) continue
        files.add(rel)
        lines += text.split('\n').length - (text.endsWith('\n') ? 1 : 0)
      }
    }
  }
  return files.size > 0 ? { files: [...files].sort(), lines } : null
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

  const capabilities: CapabilityRow[] = SHARED_CAPABILITY_CATALOG.map((capability) => {
    const pinned = pinnedManifests.has(capability.package)
    const fork = pinned ? findCapabilityFork(repo, capability) : null
    const state: CapabilityState = !pinned ? 'absent' : fork ? 'forked' : 'adopted'
    return {
      id: capability.id,
      package: capability.package,
      family: capability.family,
      description: capability.description,
      state,
      adopted: state === 'adopted',
      fork,
      version: pinnedVersion.get(capability.package) ?? null,
      manifests: pinnedManifests.get(capability.package) ?? [],
    }
  })

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
