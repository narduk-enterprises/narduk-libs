import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

interface Manifest {
  exports: Record<string, unknown>
  files: string[]
  peerDependencies?: Record<string, string>
}

const manifest = JSON.parse(
  readFileSync(join(packageRoot, 'package.json'), 'utf8'),
) as unknown as Manifest

const repoRoot = join(packageRoot, '..', '..', '..')
const coreManifest = JSON.parse(
  readFileSync(join(repoRoot, 'packages', 'modules', 'narduk-core', 'package.json'), 'utf8'),
) as { dependencies?: Record<string, string> }

/**
 * The subpaths item 1 reserves. Adding one is a deliberate act: the release
 * pipeline's consumer fixture resolves every declared subpath of every packed
 * package from an external install, so a new entry here is a new thing that
 * has to resolve there too.
 */
const RESERVED_SUBPATHS = ['.', './format', './theme.css']

/** Every file an exports entry points at, flattened out of its conditions. */
function exportTargets(entry: unknown): string[] {
  if (typeof entry === 'string') return [entry]
  if (entry && typeof entry === 'object') {
    return Object.values(entry as Record<string, unknown>).flatMap((value) => exportTargets(value))
  }
  return []
}

function packedFiles(): string[] {
  const output = execFileSync('pnpm', ['pack', '--dry-run', '--json'], {
    cwd: packageRoot,
    encoding: 'utf8',
    env: { ...process.env, npm_config_ignore_scripts: 'true' },
  })
  const report = JSON.parse(output) as { files: Array<{ path: string }> }
  return report.files.map(({ path }) => path)
}

describe('narduk-shell package shape', () => {
  it('declares exactly the three reserved subpaths, none of them a pattern', () => {
    expect(Object.keys(manifest.exports)).toEqual(RESERVED_SUBPATHS)
    for (const subpath of Object.keys(manifest.exports)) {
      expect(subpath).not.toContain('*')
    }
  })

  it('declares the files allowlist the packed-file test enforces', () => {
    expect(manifest.files).toEqual(['src', 'theme.css', 'README.md', 'CHANGELOG.md'])
  })

  it('pins peers to nuxt 4, vue 3.5 and narduk-core exact @nuxt/ui version', () => {
    const nuxtUiPin = coreManifest.dependencies?.['@nuxt/ui']
    expect(nuxtUiPin, 'narduk-core must pin @nuxt/ui so this suite can match it').toMatch(
      /^\d+\.\d+\.\d+$/,
    )
    expect(manifest.peerDependencies).toEqual({
      '@nuxt/ui': nuxtUiPin,
      nuxt: '>=4.0.0',
      vue: '>=3.5.0',
      // `useCollection({ syncQuery: true })` calls `useRoute()`/`useRouter()`
      // and `NePager`'s `:to` resolves through the router, so vue-router is a
      // real peer rather than something reached only through Nuxt. The range
      // matches @nuxt/ui's own so a consumer cannot end up with two copies.
      'vue-router': '^4.5.0 || ^5.0.0',
    })
  })

  it('ships every declared subpath target in the packed file list', () => {
    const files = new Set(packedFiles())

    for (const subpath of RESERVED_SUBPATHS) {
      const targets = exportTargets(manifest.exports[subpath])
      expect(targets.length, `${subpath} declares no target`).toBeGreaterThan(0)
      for (const target of targets) {
        expect(target.startsWith('./'), `${subpath} -> ${target} is not package-relative`).toBe(
          true,
        )
        expect(files, `${subpath} -> ${target} is missing from the tarball`).toContain(
          target.slice(2),
        )
      }
    }

    // The allowlist is an allowlist: nothing outside it leaks in. Stated as a
    // rule rather than an exact file list so a later backlog item adding a
    // component under src/ does not have to edit this test -- but tests/,
    // configs and scratch files still fail it.
    const allowed = new Set(['package.json', 'README.md', 'CHANGELOG.md', 'theme.css'])
    for (const file of files) {
      expect(
        allowed.has(file) || file.startsWith('src/'),
        `${file} is packed but is outside the files allowlist`,
      ).toBe(true)
    }
  }, 120_000)
})
