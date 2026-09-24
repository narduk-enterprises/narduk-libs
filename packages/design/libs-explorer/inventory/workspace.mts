/**
 * The workspace package inventory.
 *
 * Discovery is the repository's own: `loadWorkspace` from
 * `scripts/compute-affected-packages.mjs`, the same function CI uses to pick
 * affected packages. It reads `pnpm-workspace.yaml`, rejects negated and
 * unsupported glob patterns, fails when a declared root is missing, and fails
 * when a directory under a root has no `package.json`. Sharing it means the
 * Explorer's catalog and CI's package set cannot disagree about what the
 * workspace contains, and a new `packages/<family>/<name>` appears here with
 * no edit (`check.mts` then fails until it has a curated catalog entry).
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { loadWorkspace } from '../../../../scripts/compute-affected-packages.mjs'

export interface WorkspacePackage {
  /** `@narduk-enterprises/narduk-shell`. */
  name: string
  /** The directory basename, unique across the workspace; the URL slug. */
  slug: string
  /** `modules`, `tooling`, `design` or `contracts`. */
  family: string
  /** Repository-relative, POSIX. */
  directory: string
  version: string
  description: string
  private: boolean
  /** Subpath keys of `exports`, in manifest order. */
  exports: string[]
  /** Command names from `bin`. */
  bin: string[]
  /** `scripts` names: how a private workspace tool is run. */
  scripts: string[]
  peerDependencies: string[]
  /** Other workspace packages this one depends on, in any dependency section. */
  workspaceDependencies: string[]
  /** Level-two README headings outside fenced code: the package's own table of contents. */
  readmeSections: string[]
}

const DEPENDENCY_SECTIONS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const

interface Manifest {
  name: string
  version?: string
  description?: string
  private?: boolean
  exports?: Record<string, unknown> | string
  bin?: Record<string, string> | string
  scripts?: Record<string, string>
  peerDependencies?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
}

/** `## ` headings, skipping any inside a fenced code block. */
export function readmeSections(markdown: string): string[] {
  const sections: string[] = []
  let fence: string | null = null
  for (const line of markdown.split(/\r?\n/)) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1]
    if (marker) {
      if (fence === null) fence = marker
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null
      continue
    }
    if (fence !== null) continue
    const heading = /^## (.+?)\s*#*\s*$/.exec(line)?.[1]
    if (heading) sections.push(heading.trim())
  }
  return sections
}

export function readWorkspacePackages(repoRoot: string): WorkspacePackage[] {
  const workspace = loadWorkspace(repoRoot) as {
    packages: { relativeDirectory: string; manifest: Manifest; name: string }[]
  }
  const names = new Set(workspace.packages.map(({ name }) => name))
  return workspace.packages
    .map(({ relativeDirectory: directory, manifest }) => {
      const segments = directory.split('/')
      const workspaceDependencies = new Set<string>()
      for (const section of DEPENDENCY_SECTIONS) {
        for (const dependency of Object.keys(manifest[section] ?? {})) {
          if (names.has(dependency) && dependency !== manifest.name) {
            workspaceDependencies.add(dependency)
          }
        }
      }
      const readmePath = join(repoRoot, directory, 'README.md')
      return {
        name: manifest.name,
        slug: segments.at(-1) ?? directory,
        family: segments.at(-2) ?? '',
        directory,
        version: manifest.version ?? '0.0.0',
        description: manifest.description ?? '',
        private: manifest.private === true,
        exports:
          typeof manifest.exports === 'object' && manifest.exports !== null
            ? Object.keys(manifest.exports)
            : manifest.exports
              ? ['.']
              : [],
        bin:
          typeof manifest.bin === 'string'
            ? [segments.at(-1) ?? manifest.name]
            : Object.keys(manifest.bin ?? {}),
        scripts: Object.keys(manifest.scripts ?? {}),
        peerDependencies: Object.keys(manifest.peerDependencies ?? {}),
        workspaceDependencies: [...workspaceDependencies].sort(),
        readmeSections: existsSync(readmePath)
          ? readmeSections(readFileSync(readmePath, 'utf8'))
          : [],
      }
    })
    .sort((left, right) => left.name.localeCompare(right.name))
}
