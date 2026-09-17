/**
 * A published estate package's `peerDependencies` range must accept the
 * version the generator actually installs for that package.
 *
 * `packed-consumer-smoke` installs the generated app from packed tarballs with
 * `rejectWarnings`, so a single `✕ unmet peer` line is a hard CI failure — and
 * it only surfaces there, minutes into a job, because the workspace itself is
 * immune: root `pnpm.peerDependencyRules.allowAny` lists
 * `@cloudflare/workers-types`, and root `pnpm.overrides` pins it to the v4 the
 * monorepo develops against. The generated app is outside the workspace, gets
 * neither, and installs v5.
 *
 * narduk-libs#398 shipped `peerDependencies['@cloudflare/workers-types']:
 * '^4.20260511.1'` on narduk-testkit and broke that job exactly this way. This
 * derives the rule from the live manifests rather than naming a package, so a
 * peer added tomorrow against a major the generator does not pin fails here —
 * in a sub-second unit test — instead of in the packing job.
 *
 * Only a `^`/`~` range is judged: those pin a major (or minor), so a differing
 * major is an unmet peer in EVERY generated app, with no version resolution to
 * reason about. A `>=` range is deliberately left alone; whether it is
 * satisfied is a real semver question, and this file does not reimplement
 * semver to answer it.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { PACKAGE_VERSIONS } from '../src/manifest.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')
/** Mirrors pnpm-workspace.yaml's four families (D-WEBFOUND-2 Q2 (a)). */
const FAMILIES = ['modules', 'tooling', 'design', 'contracts'] as const

interface PeerDeclaration {
  owner: string
  peer: string
  range: string
}

function workspacePeerDeclarations(): PeerDeclaration[] {
  const declarations: PeerDeclaration[] = []
  for (const family of FAMILIES) {
    const familyDirectory = join(repoRoot, 'packages', family)
    if (!existsSync(familyDirectory)) continue
    for (const entry of readdirSync(familyDirectory)) {
      const manifestPath = join(familyDirectory, entry, 'package.json')
      if (!existsSync(manifestPath)) continue
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
        name?: string
        peerDependencies?: Record<string, string>
      }
      if (!manifest.name) continue
      for (const [peer, range] of Object.entries(manifest.peerDependencies ?? {})) {
        declarations.push({ owner: manifest.name, peer, range })
      }
    }
  }
  return declarations
}

const majorOf = (version: string): string => version.replace(/^\D*/u, '').split('.')[0] ?? ''

describe('published peer ranges vs the versions the generator installs', () => {
  it('finds peer declarations to check at all', () => {
    // Guards the derivation itself: a broken walk would otherwise make this
    // file pass by checking nothing.
    expect(workspacePeerDeclarations().length).toBeGreaterThan(0)
  })

  it('never pins a major the generated app does not install', () => {
    const offenders = workspacePeerDeclarations()
      .filter(({ peer, range }) => {
        const pinned = PACKAGE_VERSIONS[peer as keyof typeof PACKAGE_VERSIONS]
        if (!pinned) return false
        if (!/^[\^~]/u.test(range)) return false
        return majorOf(range) !== majorOf(pinned)
      })
      .map(
        ({ owner, peer, range }) =>
          `${owner} declares peer ${peer}@${range}, but the generator installs ` +
          `${PACKAGE_VERSIONS[peer as keyof typeof PACKAGE_VERSIONS]}`,
      )

    expect(offenders).toEqual([])
  })
})
