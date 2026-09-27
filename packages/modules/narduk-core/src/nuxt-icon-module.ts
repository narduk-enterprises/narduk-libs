import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { CORE_CLIENT_BUNDLE_ICONS } from './icon-order'

const require = createRequire(fileURLToPath(import.meta.url))

interface IconifyCollection {
  icons: Record<string, unknown>
  prefix: string
}

/**
 * `@nuxt/icon` loads `@iconify-json/lucide` from the Nuxt root, walking
 * parent `node_modules` only. A pnpm app that does not depend on the
 * collection directly cannot see narduk-core's copy, and a non-dev prepare
 * then throws while writing `nuxt-icon-client-bundle.mjs`.
 */
export function lucideCollectionVisible(rootDir: string): boolean {
  const segments = ['@iconify-json', 'lucide', 'package.json']
  let dir = rootDir
  for (;;) {
    if (existsSync(join(dir, 'node_modules', ...segments))) return true
    const parent = dirname(dir)
    if (parent === dir) return false
    dir = parent
  }
}

let cachedLucide: IconifyCollection | undefined

export function readLucideCollection(): IconifyCollection {
  if (!cachedLucide) {
    const path = require.resolve('@iconify-json/lucide/icons.json')
    cachedLucide = JSON.parse(readFileSync(path, 'utf8')) as IconifyCollection
  }
  return cachedLucide
}

/**
 * String `'lucide'` when the app can resolve the collection. Otherwise the
 * Iconify JSON this package depends on, which `@nuxt/icon` will inline.
 */
export function lucideServerCollection(rootDir: string | undefined): string | IconifyCollection {
  if (!rootDir || lucideCollectionVisible(rootDir)) return 'lucide'
  return readLucideCollection()
}

/** Defaults seeded before `@nuxt/icon` installs. The app object wins via defu. */
export function localIconDefaults(rootDir: string | undefined): Record<string, unknown> {
  const lucide = lucideServerCollection(rootDir)
  return {
    provider: 'server',
    fallbackToApi: false,
    clientBundle: {
      icons: [...CORE_CLIENT_BUNDLE_ICONS],
    },
    serverBundle: {
      collections: [lucide],
      remote: false,
    },
    ...(typeof lucide === 'string' ? {} : { customCollections: [lucide] }),
  }
}

interface IconPackageManifest {
  exports?: { '.'?: string | { import?: string } }
  main?: string
  module?: string
}

function entryFromManifest(manifestPath: string): string {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as IconPackageManifest
  const dot = manifest.exports?.['.']
  const relative = (typeof dot === 'string' ? dot : dot?.import) ?? manifest.module ?? manifest.main
  if (!relative) {
    throw new Error('@nuxt/icon package.json has no import entry')
  }
  return join(dirname(manifestPath), relative)
}

function resolveIconEntry(): string {
  try {
    return require.resolve('@nuxt/icon')
  } catch {
    return entryFromManifest(require.resolve('@nuxt/icon/package.json'))
  }
}

/**
 * Absolute `@nuxt/icon` entry, resolved from this package.
 *
 * `@nuxt/ui` 4.11.1 declares the icon module as a `moduleDependency`. Nuxt
 * resolves that name from the app root, and pnpm does not expose the
 * transitive package there, so the module never registers unless the app
 * lists `@nuxt/icon` itself. The build then fails loading
 * `.nuxt/nuxt-icon-client-bundle` (narduk-libs#1195).
 */
export function nuxtIconModuleEntry(): string {
  try {
    return resolveIconEntry()
  } catch (error) {
    throw new Error(
      '[@narduk-enterprises/narduk-core] Could not resolve @nuxt/icon from narduk-core. ' +
        'It is a direct dependency so a consumer build can register the icon module without ' +
        'listing it (narduk-libs#1195).',
      { cause: error },
    )
  }
}
