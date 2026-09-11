/**
 * The duplicate-estate-copy guard (narduk-libs#282 review, task 5).
 *
 * pnpm replaces a `workspace:` specifier with the EXACT version of that
 * workspace package at publish time, so a published estate module carries a
 * hard pin on whatever its sibling's version was that day. If a generated app
 * pins that sibling directly at a DIFFERENT exact version -- which happens the
 * first time one of the two is released without the other, the ordinary case
 * -- pnpm satisfies both and installs two copies. For a Nuxt module that means
 * two `defineNuxtModule` registrations and two `useRuntimeConfig` namespaces.
 *
 * This file does not hard-code which packages are affected. It derives the set
 * from the live workspace manifests, so a module that newly starts shipping
 * `workspace:` on a generator-pinned sibling fails here instead of shipping a
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

/** Every generator-pinned estate package that ANOTHER generator-pinned estate
 * package depends on via `workspace:` -- exactly the set that needs an
 * override, with the module that forces it, for the failure message. */
function overridesRequiredBy(direct: Set<string>): Map<string, string[]> {
  const workspace = loadWorkspaceManifests()
  const required = new Map<string, string[]>()
  for (const name of direct) {
    const manifest = workspace.get(name)
    if (!manifest) continue
    for (const [dependency, spec] of Object.entries(manifest.dependencies ?? {})) {
      if (!dependency.startsWith(ESTATE_SCOPE)) continue
      if (!spec.startsWith('workspace:')) continue
      if (!direct.has(dependency)) continue
      required.set(dependency, [...(required.get(dependency) ?? []), `${name} (${spec})`])
    }
  }
  return required
}

describe('generated pnpm.overrides collapse every workspace-published estate pin', () => {
  it('the workspace actually exercises this hazard (the guard is not vacuous)', () => {
    const { directEstateDependencies } = generatedManifests([...SUPPORTED_CAPABILITIES])
    expect([...overridesRequiredBy(directEstateDependencies).keys()].sort()).toEqual([
      '@narduk-enterprises/narduk-core',
      '@narduk-enterprises/narduk-logging',
      '@narduk-enterprises/narduk-mapkit',
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
    for (const [dependency, forcedBy] of overridesRequiredBy(directEstateDependencies)) {
      expect(
        overrides[dependency],
        `${dependency} is pinned directly by the generated app AND published as an exact ` +
          `dependency of ${forcedBy.join(', ')}. Without a pnpm.overrides entry, the first ` +
          `release that moves one and not the other installs two copies of ${dependency}.`,
      ).toBeDefined()
    }
  })

  it('does not override an estate package nothing depends on via workspace:', () => {
    // narduk-auth's override (dropped in a5ed8e9) was inert: no estate package
    // depends on narduk-auth, so there was never a second copy to collapse.
    const { overrides, directEstateDependencies } = generatedManifests([...SUPPORTED_CAPABILITIES])
    const required = overridesRequiredBy(directEstateDependencies)
    for (const name of Object.keys(overrides)) {
      if (!name.startsWith(ESTATE_SCOPE)) continue
      expect(
        required.has(name),
        `${name} is overridden but no generator-pinned package depends on it via workspace:`,
      ).toBe(true)
    }
  })

  it('overrides the exact version the app pins directly, never a range', () => {
    const { overrides } = generatedManifests([...SUPPORTED_CAPABILITIES])
    for (const [name, version] of Object.entries(overrides)) {
      if (!name.startsWith(ESTATE_SCOPE)) continue
      expect(version).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Z.-]+)?$/i)
    }
  })
})
