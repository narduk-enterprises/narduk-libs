/**
 * The duplicate-estate-copy guard (narduk-libs#282 review, task 5).
 *
 * pnpm replaces a `workspace:` specifier with the EXACT version of that
 * workspace package at publish time, so a published estate package carries a
 * hard pin on whatever its sibling's version was that day. Two DIFFERENT exact
 * pins on one package in one tree is two installed copies -- for a Nuxt module
 * two `defineNuxtModule` registrations and two `useRuntimeConfig` namespaces,
 * for a contracts package two copies of the zod schemas its consumers are
 * supposed to share.
 *
 * Two shapes produce that second pin, and this file derives both:
 *
 *  1. ONE publisher plus the app's own direct pin -- the app and the publisher
 *     diverge the first time one is released without the other.
 *  2. TWO OR MORE publishers, with no direct pin at all. The app may not name
 *     the package anywhere; the publishers still diverge from each other. An
 *     earlier version of this file intersected with the app's own manifests
 *     and so could not see this shape at all.
 *
 * One publisher and no direct pin needs no override: one exact spec, one copy.
 *
 * Nothing here is hard-coded to a package name. The set is derived from the
 * live workspace manifests, so a package that newly starts shipping
 * `workspace:` on an installed sibling fails here instead of shipping a
 * duplicate into the fleet.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { buildGeneratedFiles, SUPPORTED_CAPABILITIES, type Capability } from '../src/index.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')
/** Mirrors pnpm-workspace.yaml's four families (D-WEBFOUND-2 Q2 (a)). */
const FAMILIES = ['modules', 'tooling', 'design', 'contracts'] as const
const ESTATE_SCOPE = '@narduk-enterprises/'

interface WorkspaceManifest {
  name?: string
  version?: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

function loadWorkspaceManifests(): Map<string, WorkspaceManifest> {
  const byName = new Map<string, WorkspaceManifest>()
  for (const family of FAMILIES) {
    const familyDirectory = join(repoRoot, 'packages', family)
    if (!existsSync(familyDirectory)) continue
    for (const entry of readdirSync(familyDirectory)) {
      const manifestPath = join(familyDirectory, entry, 'package.json')
      if (!existsSync(manifestPath)) continue
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as WorkspaceManifest
      if (manifest.name) byName.set(manifest.name, manifest)
    }
  }
  return byName
}

function generatedManifests(capabilities: readonly Capability[]): {
  overrides: Record<string, string>
  directEstateDependencies: Set<string>
} {
  const files = new Map(
    buildGeneratedFiles({
      appName: 'override-fixture',
      capabilities: [...capabilities],
      visibility: 'private',
      targetDir: '/tmp/override-fixture',
    }).map((file) => [file.path, file.contents]),
  )

  const read = (path: string) => {
    const contents = files.get(path)
    if (!contents) throw new Error(`generator emitted no ${path}`)
    return JSON.parse(contents) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
      pnpm?: { overrides?: Record<string, string> }
    }
  }

  const root = read('package.json')
  const web = read('apps/web/package.json')
  // devDependencies count here: the generated app is not published, so its own
  // devDependencies really are installed.
  const directEstateDependencies = new Set(
    [
      ...Object.keys(root.dependencies ?? {}),
      ...Object.keys(root.devDependencies ?? {}),
      ...Object.keys(web.dependencies ?? {}),
      ...Object.keys(web.devDependencies ?? {}),
    ].filter((name) => name.startsWith(ESTATE_SCOPE)),
  )
  return { overrides: root.pnpm?.overrides ?? {}, directEstateDependencies }
}

/**
 * Every estate package the generated app ends up with on disk: its own direct
 * dependencies, plus everything reachable from those along published RUNTIME
 * `dependencies` edges.
 *
 * devDependency edges are deliberately not followed. A published package's
 * devDependencies are never installed by its consumers, which is why
 * `@narduk-enterprises/eslint-config` -- `workspace:*` in fourteen manifests,
 * more than any other estate package -- never enters this closure and never
 * needs an override.
 */
function installedEstateClosure(
  direct: ReadonlySet<string>,
  workspace: Map<string, WorkspaceManifest>,
): Set<string> {
  const installed = new Set(direct)
  const queue = [...direct]
  while (queue.length > 0) {
    const name = queue.shift() as string
    for (const dependency of Object.keys(workspace.get(name)?.dependencies ?? {})) {
      if (!dependency.startsWith(ESTATE_SCOPE)) continue
      if (installed.has(dependency)) continue
      installed.add(dependency)
      queue.push(dependency)
    }
  }
  return installed
}

/**
 * Every estate package that can end up installed twice, with the reason -- for
 * the failure message, and so the expected set below can be read without
 * re-deriving it by hand.
 */
function duplicableEstatePackages(direct: ReadonlySet<string>): Map<string, string[]> {
  const workspace = loadWorkspaceManifests()
  const installed = installedEstateClosure(direct, workspace)

  const publishers = new Map<string, string[]>()
  for (const name of installed) {
    for (const [dependency, spec] of Object.entries(workspace.get(name)?.dependencies ?? {})) {
      if (!dependency.startsWith(ESTATE_SCOPE)) continue
      if (!spec.startsWith('workspace:')) continue
      publishers.set(dependency, [...(publishers.get(dependency) ?? []), `${name} (${spec})`])
    }
  }

  const required = new Map<string, string[]>()
  for (const [dependency, sources] of publishers) {
    const reasons = [`published as an exact dependency of ${sources.join(', ')}`]
    if (direct.has(dependency)) reasons.push('pinned directly by the generated app')
    // Two or more publishers diverge from each other; one publisher diverges
    // only from a direct pin. One publisher and no direct pin is one copy.
    if (sources.length >= 2 || direct.has(dependency)) required.set(dependency, reasons)
  }
  return required
}

describe('generated pnpm.overrides collapse every workspace-published estate pin', () => {
  it('the workspace actually exercises both hazard shapes (the guard is not vacuous)', () => {
    const { directEstateDependencies } = generatedManifests([...SUPPORTED_CAPABILITIES])
    const required = duplicableEstatePackages(directEstateDependencies)
    expect([...required.keys()].sort()).toEqual([
      // four publishers AND a direct pin
      '@narduk-enterprises/narduk-core',
      // one publisher (narduk-core) plus a direct pin
      '@narduk-enterprises/narduk-logging',
      // one publisher (narduk-mapkit-nuxt) plus a direct pin
      '@narduk-enterprises/narduk-mapkit',
      // three publishers (narduk-core, narduk-ai, narduk-auth), never pinned
      // directly -- invisible to a guard that reads only the app's manifests
      '@narduk-enterprises/narduk-platform',
    ])
  })

  it.each([
    { label: 'every capability', capabilities: [...SUPPORTED_CAPABILITIES] },
    { label: 'no capability', capabilities: [] as Capability[] },
    { label: 'auth only', capabilities: ['auth'] as Capability[] },
    { label: 'mapkit only', capabilities: ['mapkit'] as Capability[] },
    { label: 'seo + analytics', capabilities: ['seo', 'analytics'] as Capability[] },
  ])('$label', ({ capabilities }) => {
    const { overrides, directEstateDependencies } = generatedManifests(capabilities)
    for (const [dependency, reasons] of duplicableEstatePackages(directEstateDependencies)) {
      expect(
        overrides[dependency],
        `${dependency} is ${reasons.join(' and ')}. Without a pnpm.overrides entry, the ` +
          `first release that moves one of those and not the others installs two copies ` +
          `of ${dependency}.`,
      ).toBeDefined()
    }
  })

  it('a package with one publisher and no direct pin is deliberately NOT overridden', () => {
    // @narduk-enterprises/narduk-app is `workspace:*` in narduk-auth alone and
    // named nowhere in a generated app: one exact spec, so one copy, so an
    // override would be inert. Derived, not asserted by name.
    const { overrides, directEstateDependencies } = generatedManifests([...SUPPORTED_CAPABILITIES])
    const workspace = loadWorkspaceManifests()
    const installed = installedEstateClosure(directEstateDependencies, workspace)
    const required = duplicableEstatePackages(directEstateDependencies)

    const singlePublisherOnly = [...installed].filter((name) => {
      if (directEstateDependencies.has(name)) return false
      const publishers = [...installed].filter((other) =>
        (workspace.get(other)?.dependencies ?? {})[name]?.startsWith('workspace:'),
      )
      return publishers.length === 1
    })

    expect(singlePublisherOnly.length).toBeGreaterThan(0)
    for (const name of singlePublisherOnly) {
      expect(required.has(name)).toBe(false)
      expect(
        overrides[name],
        `${name} has a single publisher and no direct pin, so its override would be inert`,
      ).toBeUndefined()
    }
  })

  it('a devDependency-only workspace: edge never requires an override', () => {
    // The largest `workspace:` fan-in in the repo is eslint-config, and it is
    // a devDependency everywhere. A published package's devDependencies are
    // not installed by its consumers, so there is no second copy to collapse.
    const { overrides, directEstateDependencies } = generatedManifests([...SUPPORTED_CAPABILITIES])
    const workspace = loadWorkspaceManifests()
    const required = duplicableEstatePackages(directEstateDependencies)

    const devOnly = new Set<string>()
    for (const manifest of workspace.values()) {
      for (const [dependency, spec] of Object.entries(manifest.devDependencies ?? {})) {
        if (!dependency.startsWith(ESTATE_SCOPE)) continue
        if (!spec.startsWith('workspace:')) continue
        const shippedAtRuntime = [...workspace.values()].some((other) =>
          (other.dependencies ?? {})[dependency]?.startsWith('workspace:'),
        )
        if (!shippedAtRuntime) devOnly.add(dependency)
      }
    }

    expect(devOnly.size).toBeGreaterThan(0)
    for (const name of devOnly) {
      expect(required.has(name), `${name} is only ever a devDependency edge`).toBe(false)
      expect(overrides[name], `${name} is only ever a devDependency edge`).toBeUndefined()
    }
  })

  it('does not override an estate package nothing can duplicate', () => {
    // Checked at full capability, where every publisher is installed. The
    // override list is deliberately capability-invariant apart from
    // narduk-mapkit, whose only publisher (narduk-mapkit-nuxt) is itself
    // capability-gated: an override for a package a narrower app does not
    // install is inert, not wrong.
    const { overrides, directEstateDependencies } = generatedManifests([...SUPPORTED_CAPABILITIES])
    const required = duplicableEstatePackages(directEstateDependencies)
    for (const name of Object.keys(overrides)) {
      if (!name.startsWith(ESTATE_SCOPE)) continue
      expect(
        required.has(name),
        `${name} is overridden but cannot be installed twice: no two installed packages ` +
          `publish it via workspace:, and the app does not pin it directly`,
      ).toBe(true)
    }
  })

  it('overrides the exact version the estate is built and tested at, never a range', () => {
    const { overrides } = generatedManifests([...SUPPORTED_CAPABILITIES])
    for (const [name, version] of Object.entries(overrides)) {
      if (!name.startsWith(ESTATE_SCOPE)) continue
      expect(version).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Z.-]+)?$/i)
    }
  })
})
