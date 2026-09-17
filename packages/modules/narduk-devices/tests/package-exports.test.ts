import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const packageRoot = fileURLToPath(new URL('..', import.meta.url))

interface PackageManifest {
  dependencies: Record<string, string>
  exports: Record<string, string | { import?: string; types?: string }>
  files: string[]
  name: string
  private: boolean
  publishConfig: { access: string; registry: string }
  version: string
}

const manifest = JSON.parse(
  readFileSync(join(packageRoot, 'package.json'), 'utf8'),
) as PackageManifest

function listFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    return statSync(path).isDirectory() ? listFiles(path) : [path]
  })
}

function exportTargets(): string[] {
  return Object.values(manifest.exports).flatMap((value) =>
    typeof value === 'string' ? [value] : Object.values(value).filter(Boolean),
  )
}

describe('narduk-devices package boundary', () => {
  it('publishes as a public GitHub Package', () => {
    expect(manifest.name).toBe('@narduk-enterprises/narduk-devices')
    expect(manifest.private).toBe(false)
    expect(manifest.publishConfig).toEqual({
      access: 'public',
      registry: 'https://npm.pkg.github.com',
    })
  })

  it('resolves every export path to real files', () => {
    for (const target of exportTargets()) {
      if (!target.includes('*')) {
        expect(existsSync(join(packageRoot, target)), `missing export target ${target}`).toBe(true)
        continue
      }

      // A wildcard export must have a directory behind it that actually holds
      // matching files, or the subpath resolves to nothing for a consumer.
      const [prefix, suffix] = target.split('*')
      const directory = join(packageRoot, (prefix ?? '').replace(/\/$/u, ''))
      expect(existsSync(directory), `missing export directory for ${target}`).toBe(true)
      const matches = listFiles(directory).filter((path) => path.endsWith(suffix ?? ''))
      expect(matches.length, `no files match ${target}`).toBeGreaterThan(0)
    }
  })

  it('reaches every published source file through an export pattern', () => {
    const patterns = exportTargets().map((target) => {
      const escaped = target
        .replace(/^\.\//u, '')
        .replaceAll(/[.+?^${}()|[\]\\]/gu, String.raw`\$&`)
        .replace('*', '.+')
      return new RegExp(`^${escaped}$`, 'u')
    })

    const publishedDirectories = ['drizzle', 'server', 'shared', 'src']
    const published = publishedDirectories
      .flatMap((directory) => listFiles(join(packageRoot, directory)))
      .map((path) => relative(packageRoot, path))

    expect(published.length).toBeGreaterThan(0)
    for (const path of published) {
      expect(
        patterns.some((pattern) => pattern.test(path)),
        `${path} is shipped but reachable through no export`,
      ).toBe(true)
    }
  })

  it('ships the migration directory and no compiled output', () => {
    expect(manifest.files).toContain('drizzle/')
    expect(existsSync(join(packageRoot, 'drizzle/0001_devices.sql'))).toBe(true)
    expect(manifest.files.some((entry) => entry.startsWith('dist'))).toBe(false)
  })

  it('keeps runtime dependencies minimal and independent of narduk-auth', () => {
    expect(Object.keys(manifest.dependencies).sort()).toEqual(['@nuxt/kit', 'drizzle-orm', 'h3'])

    const sources = ['server', 'shared', 'src'].flatMap((directory) =>
      listFiles(join(packageRoot, directory)),
    )
    // Prose may name narduk-auth (the comments explain the boundary); an
    // import specifier may not.
    const specifiers = /from\s+'([^']+)'|import\('([^']+)'\)/gu
    for (const path of sources) {
      const contents = readFileSync(path, 'utf8')
      const imported = [...contents.matchAll(specifiers)].map((match) => match[1] ?? match[2] ?? '')
      expect(imported, `${path} imports another narduk package`).toEqual(
        imported.filter((specifier) => !specifier.startsWith('@narduk-enterprises/')),
      )
      expect(contents, `${path} uses a Nuxt layer alias`).not.toContain(
        `${String.fromCharCode(35)}layer`,
      )
    }
  })
})
