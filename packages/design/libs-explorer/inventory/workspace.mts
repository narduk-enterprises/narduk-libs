/**
 * The workspace package inventory, read from `pnpm-workspace.yaml`.
 *
 * `pnpm-workspace.yaml` is the single source of truth for where a package
 * lives (AGENTS.md § Scope), so the Explorer derives its catalog from it
 * instead of keeping a list: a new `packages/<family>/<name>` appears here with
 * no edit, and `check.mts` then fails until it has a curated catalog entry.
 *
 * The parser reads only the `packages:` list this repository uses — quoted or
 * bare entries ending in a single `/*` — and throws on anything else rather
 * than silently skipping it.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'

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
  peerDependencies: string[]
  /** Other workspace packages this one depends on, in any dependency section. */
  workspaceDependencies: string[]
  /** Level-two README headings: the package's own table of contents. */
  readmeSections: string[]
}

export function readWorkspacePatterns(yaml: string): string[] {
  const patterns: string[] = []
  let inPackages = false
  for (const rawLine of yaml.split('\n')) {
    const line = rawLine.replace(/\s+#.*$/, '').trimEnd()
    if (/^\S/.test(line)) {
      inPackages = line === 'packages:'
      continue
    }
    if (!inPackages || line.trim() === '' || line.trim().startsWith('#')) continue
    const match = /^\s*-\s*["']?([^"']+?)["']?$/.exec(line)
    if (!match?.[1]) throw new Error(`pnpm-workspace.yaml: cannot read packages entry "${rawLine}"`)
    if (!match[1].endsWith('/*') || match[1].slice(0, -2).includes('*')) {
      throw new Error(
        `pnpm-workspace.yaml: only "<dir>/*" entries are supported, got "${match[1]}"`,
      )
    }
    patterns.push(match[1])
  }
  if (patterns.length === 0) throw new Error('pnpm-workspace.yaml lists no packages')
  return patterns
}

const DEPENDENCY_SECTIONS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const

interface Manifest {
  name?: string
  version?: string
  description?: string
  private?: boolean
  exports?: Record<string, unknown> | string
  peerDependencies?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
}

export function readWorkspacePackages(repoRoot: string): WorkspacePackage[] {
  const patterns = readWorkspacePatterns(
    readFileSync(join(repoRoot, 'pnpm-workspace.yaml'), 'utf8'),
  )
  const found: { directory: string; family: string; manifest: Manifest }[] = []
  for (const pattern of patterns) {
    const parent = pattern.slice(0, -2)
    const absoluteParent = join(repoRoot, parent)
    if (!existsSync(absoluteParent)) continue
    for (const entry of readdirSync(absoluteParent).sort()) {
      const absolute = join(absoluteParent, entry)
      if (!statSync(absolute).isDirectory() || !existsSync(join(absolute, 'package.json'))) continue
      found.push({
        directory: `${parent}/${entry}`,
        family: basename(parent),
        manifest: JSON.parse(readFileSync(join(absolute, 'package.json'), 'utf8')) as Manifest,
      })
    }
  }

  const names = new Set(found.map(({ manifest }) => manifest.name))
  return found
    .map(({ directory, family, manifest }) => {
      if (!manifest.name) throw new Error(`${directory}/package.json has no name`)
      const workspaceDependencies = new Set<string>()
      for (const section of DEPENDENCY_SECTIONS) {
        for (const dependency of Object.keys(manifest[section] ?? {})) {
          if (names.has(dependency) && dependency !== manifest.name) {
            workspaceDependencies.add(dependency)
          }
        }
      }
      const readmePath = join(repoRoot, directory, 'README.md')
      const readmeSections = existsSync(readmePath)
        ? [...readFileSync(readmePath, 'utf8').matchAll(/^## (.+)$/gm)].map((match) =>
            (match[1] ?? '').trim(),
          )
        : []
      return {
        name: manifest.name,
        slug: basename(directory),
        family,
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
        peerDependencies: Object.keys(manifest.peerDependencies ?? {}),
        workspaceDependencies: [...workspaceDependencies].sort(),
        readmeSections,
      }
    })
    .sort((left, right) => left.name.localeCompare(right.name))
}
