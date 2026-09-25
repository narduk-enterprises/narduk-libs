/**
 * Reads an app checkout the way `foundation:check` is entitled to: the WHOLE
 * repository, not just one manifest. Mirrors company-hq
 * `scripts/check-web-foundation.py`'s `CheckoutSource` monorepo-candidate list
 * (same relative paths) so the two mechanisms agree on where an app's files
 * live, but this one always has a real filesystem underneath it -- there is no
 * "contents API" half here.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import { parse as parseJsonc, type ParseError } from 'jsonc-parser'

export const PACKAGE_JSON_CANDIDATES = [
  'package.json',
  'apps/web/package.json',
  'apps/api/package.json',
  'web/package.json',
  'app/package.json',
] as const

export const WRANGLER_CANDIDATES = [
  'wrangler.json',
  'wrangler.jsonc',
  'wrangler.toml',
  'apps/web/wrangler.json',
  'apps/web/wrangler.jsonc',
  'apps/web/wrangler.toml',
  'web/wrangler.json',
  'web/wrangler.jsonc',
  'web/wrangler.toml',
] as const

export const NUXT_CONFIG_CANDIDATES = [
  'nuxt.config.ts',
  'nuxt.config.mts',
  'nuxt.config.mjs',
  'nuxt.config.js',
  'apps/web/nuxt.config.ts',
  'apps/web/nuxt.config.mts',
  'apps/web/nuxt.config.mjs',
  'apps/web/nuxt.config.js',
  'web/nuxt.config.ts',
] as const

/** Pages/components directories at the same monorepo prefixes as
 * `NUXT_CONFIG_CANDIDATES` (and the component paths item 3 / Wave-1 already
 * walk). A Nuxt app "has UI" only when one of these exists. */
export const NUXT_UI_SURFACE_CANDIDATES = [
  'app/pages',
  'app/components',
  'apps/web/app/pages',
  'apps/web/app/components',
  'apps/web/pages',
  'apps/web/components',
  'web/app/pages',
  'web/app/components',
  'web/pages',
  'web/components',
  'src/pages',
  'src/components',
  'pages',
  'components',
] as const

export const NITRO_OUTPUT_CANDIDATES = [
  '.output/nitro.json',
  'apps/web/.output/nitro.json',
  'web/.output/nitro.json',
] as const

/** Directories `walk()` never descends into. `.output` and `.nuxt` are build
 * trees: a built Nitro bundle inlines every dependency, so a conformant app's
 * `.output/server/chunks` contains the source text of narduk-core, narduk-seo
 * and posthog-js. Any content scan that reached them would report the whole
 * estate as forking itself. `.wrangler` and `coverage` are the same class of
 * generated tree. */
export const SKIPPED_WALK_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  'dist',
  '.output',
  '.nuxt',
  '.nitro',
  '.wrangler',
  '.turbo',
  'coverage',
])

export class AppRepo {
  readonly root: string

  constructor(root: string) {
    this.root = root
  }

  /** Read a repo-relative text file, or null if it does not exist / is not text. */
  read(rel: string): string | null {
    const path = join(this.root, rel)
    if (!existsSync(path) || !statSync(path).isFile()) return null
    try {
      return readFileSync(path, 'utf8')
    } catch {
      return null
    }
  }

  exists(rel: string): boolean {
    const path = join(this.root, rel)
    return existsSync(path)
  }

  listWorkflows(): string[] {
    const dir = join(this.root, '.github', 'workflows')
    if (!existsSync(dir) || !statSync(dir).isDirectory()) return []
    return readdirSync(dir)
      .filter((name) => /\.ya?ml$/.test(name))
      .sort()
  }

  /** Every file under `rel` (recursively, bounded) matching one of `extensions`. */
  walk(rel: string, extensions: readonly string[], maxDepth = 6): string[] {
    const start = join(this.root, rel)
    if (!existsSync(start) || !statSync(start).isDirectory()) return []
    const out: string[] = []
    const stack: Array<{ dir: string; depth: number }> = [{ dir: start, depth: 0 }]
    while (stack.length > 0) {
      const next = stack.pop()
      if (!next) break
      const { dir, depth } = next
      if (depth > maxDepth) continue
      let entries: string[]
      try {
        entries = readdirSync(dir)
      } catch {
        continue
      }
      for (const entry of entries) {
        if (SKIPPED_WALK_DIRECTORIES.has(entry)) continue
        const full = join(dir, entry)
        let entryStat
        try {
          entryStat = statSync(full)
        } catch {
          continue
        }
        if (entryStat.isDirectory()) {
          stack.push({ dir: full, depth: depth + 1 })
        } else if (extensions.some((ext) => entry.endsWith(ext))) {
          out.push(relative(this.root, full))
        }
      }
    }
    return out.sort()
  }
}

export function parseJson(text: string | null): unknown {
  if (!text) return null
  try {
    const errors: ParseError[] = []
    const value = parseJsonc(text, errors, { allowTrailingComma: true })
    return errors.length > 0 ? null : (value as unknown)
  } catch {
    return null
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Every `dependencies`/`devDependencies`/`optionalDependencies`/`peerDependencies`
 * entry across a `package.json`, merged (later blocks in the same file do not
 * override -- callers merge across candidate files themselves). */
export function allDeps(pkg: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!isRecord(pkg)) return out
  for (const key of [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'peerDependencies',
  ]) {
    const block = pkg[key]
    if (isRecord(block)) {
      for (const [name, spec] of Object.entries(block)) {
        if (typeof spec === 'string') out[name] = spec
      }
    }
  }
  return out
}

export interface FoundPackage {
  rel: string
  pkg: Record<string, unknown>
}

export function collectPackages(repo: AppRepo): FoundPackage[] {
  const found: FoundPackage[] = []
  for (const rel of PACKAGE_JSON_CANDIDATES) {
    const parsed = parseJson(repo.read(rel))
    if (isRecord(parsed)) found.push({ rel, pkg: parsed })
  }
  return found
}

export function mergedDeps(packages: FoundPackage[]): Record<string, string> {
  const merged: Record<string, string> = {}
  for (const { pkg } of packages) Object.assign(merged, allDeps(pkg))
  return merged
}

/** Locate the first wrangler config that exists at a known candidate path. */
export function findWranglerConfig(repo: AppRepo): string | null {
  return WRANGLER_CANDIDATES.find((rel) => repo.read(rel) !== null) ?? null
}

/** The three filenames Wrangler itself accepts. */
export const WRANGLER_FILENAMES = ['wrangler.json', 'wrangler.jsonc', 'wrangler.toml'] as const

/**
 * EVERY wrangler config in the checkout, not just the app's own.
 *
 * `findWranglerConfig` answers "which config is this app's Worker?", which is
 * the right question for anything describing the app. It is the wrong question
 * for a repository-wide safety rule: a repo with a second Worker under
 * `services/*` or `<name>-worker/` has that Worker's account and bindings
 * entirely unread, and that is the exact shape of the two committed
 * personal-account Workers the deployment standard was written to catch
 * (design §2.3). The candidate paths come first and in their own order so the
 * app's own config stays first in the list; the walk adds the rest.
 */
export function findWranglerConfigs(repo: AppRepo): string[] {
  const found = WRANGLER_CANDIDATES.filter((rel) => repo.read(rel) !== null) as string[]
  const seen = new Set(found)
  for (const rel of repo.walk('', WRANGLER_FILENAMES)) {
    const base = rel.split('/').pop() ?? ''
    if (!WRANGLER_FILENAMES.includes(base as (typeof WRANGLER_FILENAMES)[number])) continue
    if (seen.has(rel)) continue
    seen.add(rel)
    found.push(rel)
  }
  return found
}

/** True when this checkout is a Nuxt app with a pages or components
 * directory. Reuses `NUXT_CONFIG_CANDIDATES` (item 1.1) rather than a second
 * "is this Nuxt?" heuristic such as a `nuxt` dependency. API-only apps --
 * no Nuxt config, or Nuxt without pages/components -- return false. */
export function hasNuxtUiSurface(repo: AppRepo): boolean {
  if (!NUXT_CONFIG_CANDIDATES.some((rel) => repo.exists(rel))) return false
  return NUXT_UI_SURFACE_CANDIDATES.some((rel) => repo.exists(rel))
}

export interface NuxtPresence {
  nuxt: boolean
  /** The file or dependency that decided it, or what was looked for. */
  evidence: string
}

/**
 * Whether this checkout is a Nuxt app (narduk-libs#157). A `nuxt.config.*` at
 * a known path decides it; a `nuxt` dependency does too, so a Nuxt app whose
 * config lives somewhere unusual still counts as Nuxt. Only an app with
 * neither is non-Nuxt: the Nuxt-module packages (narduk-core, narduk-seo,
 * narduk-analytics, narduk-auth, narduk-uploads) are not-applicable there,
 * because an app without Nuxt can never register them.
 */
export function detectNuxt(repo: AppRepo): NuxtPresence {
  const config = NUXT_CONFIG_CANDIDATES.find((rel) => repo.exists(rel))
  if (config) return { evidence: config, nuxt: true }
  const packages = collectPackages(repo)
  const withNuxt = packages.find((pkg) => 'nuxt' in allDeps(pkg.pkg))
  if (withNuxt) return { evidence: `${withNuxt.rel} depends on nuxt`, nuxt: true }
  return {
    evidence: 'no nuxt.config.* at a known path and no nuxt dependency',
    nuxt: false,
  }
}

const BINDING_ARRAY_OR_MAP_KEYS = [
  'd1_databases',
  'kv_namespaces',
  'r2_buckets',
  'queues',
  'services',
  'durable_objects',
  'analytics_engine_datasets',
  'hyperdrive',
  'vectorize',
  'ai',
  'browser',
  'mtls_certificates',
  'send_email',
] as const

/** Every binding NAME a JSON/JSONC wrangler config declares, top level and per
 * `env.<name>`. Mirrors `check-web-foundation.py`'s `binding_names()` exactly
 * (same key list, same `version_metadata` and `vars` handling) so the two
 * mechanisms never disagree on what "a binding" means. */
export function bindingNamesFromJson(node: unknown, out: Set<string>): void {
  if (!isRecord(node)) return
  for (const key of BINDING_ARRAY_OR_MAP_KEYS) {
    const block = node[key]
    let entries: unknown[] = []
    if (Array.isArray(block)) entries = block
    else if (isRecord(block)) {
      const bindings = block.bindings
      entries = Array.isArray(bindings) ? bindings : [block]
    }
    for (const entry of entries) {
      if (isRecord(entry) && typeof entry.binding === 'string') out.add(entry.binding)
    }
  }
  const meta = node.version_metadata
  if (isRecord(meta) && typeof meta.binding === 'string') out.add(meta.binding)
  const vars = node.vars
  if (isRecord(vars)) for (const key of Object.keys(vars)) out.add(key)
  const envs = node.env
  if (isRecord(envs)) for (const child of Object.values(envs)) bindingNamesFromJson(child, out)
}

/** Every binding NAME a wrangler.toml declares. TOML tables are read by
 * regex rather than a full parser: `foundation:check` only needs binding
 * NAMES (never their values), and every wrangler.toml binding declares one on
 * a `binding = "..."` line regardless of which `[[...]]` array-table or
 * `[env.NAME...]` table it sits under, so a name-only scan is complete
 * without needing table nesting. `[vars]` / `[env.*.vars]` keys are read the
 * same way item 1.2's JSON half reads `vars`. */
export function bindingNamesFromToml(text: string): Set<string> {
  const out = new Set<string>()
  for (const match of text.matchAll(/^\s*binding\s*=\s*"([^"]+)"/gm)) {
    out.add(match[1])
  }
  const lines = text.split(/\r?\n/)
  let inVarsTable = false
  for (const line of lines) {
    const header = /^\s*\[(.+)\]\s*$/.exec(line)
    if (header) {
      inVarsTable = /(?:^|\.)vars$/.test(header[1].trim())
      continue
    }
    if (!inVarsTable) continue
    const kv = /^\s*(\w+)\s*=/.exec(line)
    if (kv) out.add(kv[1])
  }
  return out
}

export function bindingNames(repo: AppRepo, wranglerRel: string): Set<string> {
  const out = new Set<string>()
  const text = repo.read(wranglerRel)
  if (!text) return out
  if (wranglerRel.endsWith('.toml')) return bindingNamesFromToml(text)
  bindingNamesFromJson(parseJson(text), out)
  return out
}

/** Every `[env.<name>]` scope of a JSON/JSONC wrangler config, plus the top
 * level, as `(prefix, scope)` pairs -- used by item 1.4's access-hardening
 * flags, which must be `false` "everywhere". */
export function wranglerScopes(config: unknown): Array<[string, Record<string, unknown>]> {
  if (!isRecord(config)) return []
  const scopes: Array<[string, Record<string, unknown>]> = [['', config]]
  const envs = config.env
  if (isRecord(envs)) {
    for (const [name, scope] of Object.entries(envs)) {
      if (isRecord(scope)) scopes.push([`env.${name}.`, scope])
    }
  }
  return scopes
}
