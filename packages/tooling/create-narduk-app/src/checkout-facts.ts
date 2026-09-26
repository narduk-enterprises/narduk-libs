import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { parseJsoncObject } from './jsonc.js'
import type { GeneratedDatabaseBackend } from './types.js'

/**
 * What `upgrade` can see in an existing checkout. New scaffolds stay
 * `apps/web`; these facts only change how an already-written app is read.
 */

export type AppLayout = 'apps-web' | 'root'

export interface CheckoutFacts {
  layout: AppLayout
  /** Nuxt config that was actually read. Empty when the checkout has neither. */
  nuxtConfig: string
  nuxtConfigPath: string | null
  rootManifest: Record<string, unknown> | null
  webManifest: Record<string, unknown> | null
  webScripts: Record<string, string>
  /** Wrangler file that exists, relative to the checkout. */
  wranglerPath: string | null
  /** Path reported when no wrangler file exists. Never created. */
  wranglerReportPath: string
  databaseBackend: GeneratedDatabaseBackend
  /** `d1_databases[0].database_name` or `bindings.d1[0].databaseName`. */
  databaseName: string | null
  /** Literal `devServer.port`, when the config states one. */
  devServerPort: number | null
}

const WRANGLER_CANDIDATES = [
  'apps/web/wrangler.jsonc',
  'apps/web/wrangler.json',
  'wrangler.jsonc',
  'wrangler.json',
] as const

const SAFE_DATABASE_NAME = /^[\w-]+$/

async function readIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

function parseJsonOrNull(contents: string | null): Record<string, unknown> | null {
  if (contents === null) return null
  try {
    const parsed: unknown = JSON.parse(contents)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function scriptsOf(manifest: Record<string, unknown> | null): Record<string, string> {
  const scripts = manifest?.scripts
  if (!scripts || typeof scripts !== 'object' || Array.isArray(scripts)) return {}
  return Object.fromEntries(
    Object.entries(scripts as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  )
}

/** A relative path inside the checkout. Rejects absolute paths and `..`. */
function relativePath(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.startsWith('/') || trimmed.split('/').includes('..')) return null
  return trimmed
}

function bindingList(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : []
}

function databaseNameFromList(list: readonly unknown[], key: string): string | null {
  const first = list[0]
  if (!first || typeof first !== 'object') return null
  const name = (first as Record<string, unknown>)[key]
  return typeof name === 'string' && SAFE_DATABASE_NAME.test(name) ? name : null
}

/**
 * Literal `devServer.port` only. `port: resolvedLocalNuxtPort` is not a
 * number this can read, and Playwright's port is a different server.
 */
export function readDevServerPort(nuxtConfig: string): number | null {
  const block = /devServer\s*:\s*\{([^{}]*)\}/u.exec(nuxtConfig)
  if (!block?.[1]) return null
  const port = /\bport\s*:\s*(\d{1,5})\b/u.exec(block[1])
  if (!port?.[1]) return null
  const value = Number(port[1])
  return Number.isInteger(value) && value >= 1024 && value <= 65535 ? value : null
}

function declaredDatabase(nuxtConfig: string): GeneratedDatabaseBackend | null {
  const match = /databaseBackend:\s*'(none|d1)'/u.exec(nuxtConfig)
  const value = match?.[1]
  return value === 'none' || value === 'd1' ? value : null
}

export async function readCheckoutFacts(targetDir: string): Promise<CheckoutFacts> {
  const rootManifest = parseJsonOrNull(await readIfExists(resolve(targetDir, 'package.json')))
  const appsWebNuxt = await readIfExists(resolve(targetDir, 'apps/web/nuxt.config.ts'))
  const rootNuxt = await readIfExists(resolve(targetDir, 'nuxt.config.ts'))
  const webManifest = parseJsonOrNull(
    await readIfExists(resolve(targetDir, 'apps/web/package.json')),
  )
  const lifecycle = parseJsonOrNull(
    await readIfExists(resolve(targetDir, 'Config/project-lifecycle.json')),
  )
  const namedWrangler = relativePath(
    (lifecycle?.nativeManifests as { wrangler?: unknown } | undefined)?.wrangler,
  )
  let wranglerPath: string | null = null
  if (namedWrangler && (await readIfExists(resolve(targetDir, namedWrangler))) !== null) {
    wranglerPath = namedWrangler
  } else {
    for (const candidate of WRANGLER_CANDIDATES) {
      if ((await readIfExists(resolve(targetDir, candidate))) !== null) {
        wranglerPath = candidate
        break
      }
    }
  }

  const nuxtConfig = appsWebNuxt ?? rootNuxt ?? ''
  const nuxtConfigPath =
    appsWebNuxt !== null ? 'apps/web/nuxt.config.ts' : rootNuxt !== null ? 'nuxt.config.ts' : null
  const layout: AppLayout =
    appsWebNuxt !== null || webManifest !== null || wranglerPath?.startsWith('apps/web/')
      ? 'apps-web'
      : rootNuxt !== null || wranglerPath === 'wrangler.json' || wranglerPath === 'wrangler.jsonc'
        ? 'root'
        : 'apps-web'

  const cloudflareApp = parseJsonOrNull(
    await readIfExists(resolve(targetDir, 'Config/cloudflare-app.json')),
  )
  const wrangler = parseJsoncObject(
    wranglerPath ? await readIfExists(resolve(targetDir, wranglerPath)) : null,
  )
  const cloudflareD1 = bindingList((cloudflareApp?.bindings as { d1?: unknown } | undefined)?.d1)
  const wranglerD1 = bindingList(wrangler?.d1_databases)
  const declared = declaredDatabase(nuxtConfig)
  const databaseBackend: GeneratedDatabaseBackend =
    declared ?? (cloudflareD1.length > 0 || wranglerD1.length > 0 ? 'd1' : 'none')

  return {
    databaseBackend,
    databaseName:
      databaseNameFromList(wranglerD1, 'database_name') ??
      databaseNameFromList(cloudflareD1, 'databaseName'),
    devServerPort: readDevServerPort(nuxtConfig),
    layout,
    nuxtConfig,
    nuxtConfigPath,
    rootManifest,
    webManifest,
    webScripts: scriptsOf(webManifest),
    wranglerPath,
    wranglerReportPath: layout === 'root' ? 'wrangler.jsonc' : 'apps/web/wrangler.jsonc',
  }
}

/**
 * The generator's root migrate scripts call `pnpm --filter web`. That package
 * does not exist on a root app, and on an `apps/web` app it is only safe when
 * `apps/web/package.json` already defines the script. Otherwise the key is
 * dropped from the desired manifest so `upgrade` leaves the app's command alone.
 */
export function adaptManagedPackageJson(
  packageJson: string,
  facts: CheckoutFacts,
  appName: string,
): string {
  let manifest: { scripts?: Record<string, string> }
  try {
    manifest = JSON.parse(packageJson) as { scripts?: Record<string, string> }
  } catch {
    return packageJson
  }
  const scripts = manifest.scripts
  if (!scripts) return packageJson

  const rootLayout = facts.layout === 'root'
  for (const key of ['db:migrate:local', 'db:migrate:remote'] as const) {
    if (typeof scripts[key] !== 'string') continue
    if (facts.databaseBackend === 'none') {
      delete scripts[key]
      continue
    }
    if (!rootLayout) {
      const callee = facts.webScripts[key]
      if (typeof callee !== 'string' || !callee.trim()) delete scripts[key]
      continue
    }
    const database =
      facts.databaseName ?? (SAFE_DATABASE_NAME.test(appName) ? appName + '-db' : null)
    if (!database) {
      delete scripts[key]
      continue
    }
    const flag = key === 'db:migrate:local' ? '--local' : '--remote'
    scripts[key] = 'wrangler d1 migrations apply ' + database + ' ' + flag
  }
  if (rootLayout && typeof scripts['manifests:validate'] === 'string') {
    // The scaffold body calls `pnpm --filter web`. A root app has no web
    // package; leave the key unmanaged unless this checkout has the script.
    delete scripts['manifests:validate']
  }

  return JSON.stringify(manifest, null, 2) + '\n'
}
