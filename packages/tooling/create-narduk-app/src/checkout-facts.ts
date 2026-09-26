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

const WRANGLER_JSON_CANDIDATES = [
  'apps/web/wrangler.jsonc',
  'apps/web/wrangler.json',
  'wrangler.jsonc',
  'wrangler.json',
] as const

const WRANGLER_TOML_CANDIDATES = ['apps/web/wrangler.toml', 'wrangler.toml'] as const

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

function rootScript(facts: CheckoutFacts, key: string): string | null {
  const scripts = facts.rootManifest?.scripts
  if (!scripts || typeof scripts !== 'object' || Array.isArray(scripts)) return null
  const value = (scripts as Record<string, unknown>)[key]
  return typeof value === 'string' && value.trim() ? value : null
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

function isIdentStart(character: string): boolean {
  return /[A-Za-z_$]/u.test(character)
}

function isIdentPart(character: string): boolean {
  return /[\w$]/u.test(character)
}

function skipLineComment(source: string, index: number): number {
  const newline = source.indexOf('\n', index)
  return newline === -1 ? source.length : newline + 1
}

function skipBlockComment(source: string, index: number): number {
  const end = source.indexOf('*/', index + 2)
  return end === -1 ? source.length : end + 2
}

function skipQuoted(source: string, index: number, quote: string): number {
  let cursor = index + 1
  while (cursor < source.length) {
    const character = source[cursor]
    if (character === '\\') {
      cursor += 2
      continue
    }
    if (character === quote) return cursor + 1
    if (quote !== '`' && character === '\n') return cursor
    cursor += 1
  }
  return source.length
}

function skipWhitespaceAndComments(source: string, index: number): number {
  let cursor = index
  while (cursor < source.length) {
    const character = source[cursor]
    if (character === ' ' || character === '\t' || character === '\n' || character === '\r') {
      cursor += 1
      continue
    }
    if (character === '/' && source[cursor + 1] === '/') {
      cursor = skipLineComment(source, cursor)
      continue
    }
    if (character === '/' && source[cursor + 1] === '*') {
      cursor = skipBlockComment(source, cursor)
      continue
    }
    break
  }
  return cursor
}

function readIdentifier(source: string, index: number): string {
  let cursor = index + 1
  while (cursor < source.length && isIdentPart(source[cursor] ?? '')) cursor += 1
  return source.slice(index, cursor)
}

/**
 * Literal top-level `devServer.port`. A comment, a string, and a nested
 * object do not supply it: `// devServer: { port: 4000 }` is ignored, and
 * `devServer: { https: { port: 1 }, port: 4000 }` is 4000.
 * `port: resolvedLocalNuxtPort` is not a number this can read.
 */
export function readDevServerPort(nuxtConfig: string): number | null {
  let index = 0
  let depth = 0
  let devServerDepth: number | null = null
  while (index < nuxtConfig.length) {
    const character = nuxtConfig[index] ?? ''
    if (character === '/' && nuxtConfig[index + 1] === '/') {
      index = skipLineComment(nuxtConfig, index)
      continue
    }
    if (character === '/' && nuxtConfig[index + 1] === '*') {
      index = skipBlockComment(nuxtConfig, index)
      continue
    }
    if (character === "'" || character === '"' || character === '`') {
      index = skipQuoted(nuxtConfig, index, character)
      continue
    }
    if (character === '{') {
      depth += 1
      index += 1
      continue
    }
    if (character === '}') {
      if (devServerDepth !== null && depth === devServerDepth) devServerDepth = null
      depth -= 1
      index += 1
      continue
    }
    if (isIdentStart(character)) {
      const identifier = readIdentifier(nuxtConfig, index)
      const after = skipWhitespaceAndComments(nuxtConfig, index + identifier.length)
      if (identifier === 'devServer' && devServerDepth === null && nuxtConfig[after] === ':') {
        const value = skipWhitespaceAndComments(nuxtConfig, after + 1)
        if (nuxtConfig[value] === '{') {
          devServerDepth = depth + 1
          depth += 1
          index = value + 1
          continue
        }
      }
      if (
        identifier === 'port' &&
        devServerDepth !== null &&
        depth === devServerDepth &&
        nuxtConfig[after] === ':'
      ) {
        const valueAt = skipWhitespaceAndComments(nuxtConfig, after + 1)
        const match = /^(\d{1,5})(?!\d)/u.exec(nuxtConfig.slice(valueAt))
        if (!match?.[1]) return null
        const value = Number(match[1])
        return Number.isInteger(value) && value >= 1024 && value <= 65535 ? value : null
      }
      index += identifier.length
      continue
    }
    index += 1
  }
  return null
}

function stripTomlComment(line: string): string {
  let quote: string | null = null
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    if (quote) {
      if (character === '\\') {
        index += 1
        continue
      }
      if (character === quote) quote = null
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      continue
    }
    if (character === '#') return line.slice(0, index)
  }
  return line
}

/** `[[d1_databases]]` or an inline `d1_databases` array. Comments do not count. */
function d1FromToml(contents: string | null): { present: boolean; databaseName: string | null } {
  if (!contents) return { databaseName: null, present: false }
  let present = false
  let databaseName: string | null = null
  let inTable = false
  for (const raw of contents.split('\n')) {
    const line = stripTomlComment(raw).trim()
    if (!line) continue
    if (/^\[\[?\s*d1_databases\s*\]\]?$/u.test(line)) {
      present = true
      inTable = true
      continue
    }
    if (/^\[[^\]]+\]$/u.test(line)) {
      inTable = false
      continue
    }
    const named = /\bdatabase_name\s*=\s*["']([\w-]+)["']/u.exec(line)
    if (named?.[1] && (inTable || line.includes('d1_databases'))) {
      present = true
      if (!databaseName) databaseName = named[1]
    }
  }
  return { databaseName, present }
}

async function firstExisting(
  targetDir: string,
  candidates: readonly string[],
): Promise<string | null> {
  for (const candidate of candidates) {
    if ((await readIfExists(resolve(targetDir, candidate))) !== null) return candidate
  }
  return null
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
  const namedExists =
    namedWrangler !== null && (await readIfExists(resolve(targetDir, namedWrangler))) !== null
  const namedIsToml = namedWrangler?.endsWith('.toml') === true
  const jsonWrangler =
    namedExists && namedWrangler && !namedIsToml
      ? namedWrangler
      : await firstExisting(targetDir, WRANGLER_JSON_CANDIDATES)
  const tomlWrangler =
    namedExists && namedWrangler && namedIsToml
      ? namedWrangler
      : await firstExisting(targetDir, WRANGLER_TOML_CANDIDATES)
  // JSONC is the file upgrade can edit. Toml is read for D1 only; when it is
  // the only wrangler file, reporting it leaves the JSONC editor unresolved
  // instead of rewriting Toml as JSON.
  const wranglerPath = jsonWrangler ?? tomlWrangler

  const nuxtConfig = appsWebNuxt ?? rootNuxt ?? ''
  const nuxtConfigPath =
    appsWebNuxt !== null ? 'apps/web/nuxt.config.ts' : rootNuxt !== null ? 'nuxt.config.ts' : null
  const layout: AppLayout =
    appsWebNuxt !== null || webManifest !== null || wranglerPath?.startsWith('apps/web/')
      ? 'apps-web'
      : rootNuxt !== null ||
          wranglerPath === 'wrangler.json' ||
          wranglerPath === 'wrangler.jsonc' ||
          wranglerPath === 'wrangler.toml'
        ? 'root'
        : 'apps-web'

  const cloudflareApp = parseJsonOrNull(
    await readIfExists(resolve(targetDir, 'Config/cloudflare-app.json')),
  )
  const wrangler = parseJsoncObject(
    jsonWrangler ? await readIfExists(resolve(targetDir, jsonWrangler)) : null,
  )
  const tomlD1 = d1FromToml(
    tomlWrangler ? await readIfExists(resolve(targetDir, tomlWrangler)) : null,
  )
  const cloudflareD1 = bindingList((cloudflareApp?.bindings as { d1?: unknown } | undefined)?.d1)
  const wranglerD1 = bindingList(wrangler?.d1_databases)
  const declared = declaredDatabase(nuxtConfig)
  const databaseBackend: GeneratedDatabaseBackend =
    declared ?? (cloudflareD1.length > 0 || wranglerD1.length > 0 || tomlD1.present ? 'd1' : 'none')

  return {
    databaseBackend,
    databaseName:
      databaseNameFromList(wranglerD1, 'database_name') ??
      databaseNameFromList(cloudflareD1, 'databaseName') ??
      tomlD1.databaseName,
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
    // Same rule as apps/web: a command the checkout already has is left
    // alone. Wrangler is only proposed when the key is missing.
    if (rootScript(facts, key)) {
      delete scripts[key]
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
