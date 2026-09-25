/**
 * Nuxt's `#` aliases for plain Vitest (narduk-libs#998).
 *
 * Every narduk-app runs its unit tests under plain Vitest, without
 * `@nuxt/test-utils`, so each app re-created `#server`, `#shared`, `~`,
 * `#layer`, `#narduk-core/schema` and `#narduk-core/postgres-runtime` by hand
 * -- three different ways, and only one of them followed narduk-core's
 * `module.ts` when a target moved or `databaseBackend` switched to postgres.
 * This reads the table Nuxt itself writes (`.nuxt/tsconfig.json`), so an alias
 * a module adds or repoints is picked up rather than discovered as a
 * resolution failure (narduk-farm's approach).
 *
 * Loaded from a `vitest.config.ts`: Node built-ins only, no Vitest import.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface VitestAlias {
  find: string | RegExp
  replacement: string
}

export interface NuxtVitestAliasOptions {
  /** The directory that contains `.nuxt/` (the Nuxt app root, e.g. `apps/web`). */
  appRoot: string
  /** Nuxt's generated tsconfig, relative to `appRoot`. Default `.nuxt/tsconfig.json`. */
  tsconfig?: string
  /**
   * Alias prefixes taken from the table. Default `['#', '~']`. A bare package
   * name is never taken, whatever the prefix: aliasing one would shadow the
   * resolution the runtime actually performs.
   */
  namespaces?: readonly string[]
  /**
   * Point `nitropack/runtime` (anchored: `nitropack/runtime/internal/...` is
   * left alone) and `#imports` at this package's `server/kit/nitro-runtime-stub`.
   * Default true for both. Both share one settable runtime config.
   */
  stubs?: { imports?: boolean; nitroRuntime?: boolean }
}

export const DEFAULT_NUXT_TSCONFIG = '.nuxt/tsconfig.json'
export const DEFAULT_NUXT_ALIAS_NAMESPACES = ['#', '~'] as const

const BARE_PACKAGE = /^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*(?:\/|$)/i

/** The stub module's own file: `.js` once built, `.ts` when loaded from source. */
export function nitroRuntimeStubPath(): string {
  const candidates = ['./nitro-runtime-stub.js', './nitro-runtime-stub.ts'].map((file) =>
    fileURLToPath(new URL(file, import.meta.url)),
  )
  return candidates.find((path) => existsSync(path)) ?? candidates[0]
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function readPaths(tsconfigPath: string): { baseDir: string; paths: Record<string, string[]> } {
  let parsed: { compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> } }
  try {
    parsed = JSON.parse(readFileSync(tsconfigPath, 'utf8')) as typeof parsed
  } catch (error) {
    const reason =
      (error as NodeJS.ErrnoException).code === 'ENOENT'
        ? 'is missing'
        : `cannot be read (${error instanceof Error ? error.message : String(error)})`
    throw new Error(
      `${tsconfigPath} ${reason}. Run \`nuxt prepare\` before the unit tests ` +
        '(e.g. "test:unit": "nuxt prepare && vitest run").',
    )
  }
  const tsconfigDir = dirname(tsconfigPath)
  const baseUrl = parsed.compilerOptions?.baseUrl
  return {
    baseDir: baseUrl === undefined ? tsconfigDir : resolve(tsconfigDir, baseUrl),
    paths: parsed.compilerOptions?.paths ?? {},
  }
}

/**
 * Vite `resolve.alias` entries for Nuxt's `#` / `~` aliases, read from
 * `.nuxt/tsconfig.json`. Exact keys become `^key$`; `key/*` becomes a prefix
 * match. Most specific first. Append app-only aliases after the result.
 *
 * Throws, naming `nuxt prepare`, when the tsconfig is missing.
 */
export function nuxtVitestAliases(options: NuxtVitestAliasOptions): VitestAlias[] {
  const namespaces = options.namespaces ?? DEFAULT_NUXT_ALIAS_NAMESPACES
  for (const namespace of namespaces) {
    if (namespace === '' || BARE_PACKAGE.test(namespace)) {
      throw new Error(
        `nuxtVitestAliases: "${namespace}" is not an alias namespace (bare package names are never aliased)`,
      )
    }
  }
  const stubImports = options.stubs?.imports !== false
  const stubNitroRuntime = options.stubs?.nitroRuntime !== false

  const tsconfigPath = resolve(options.appRoot, options.tsconfig ?? DEFAULT_NUXT_TSCONFIG)
  const { baseDir, paths } = readPaths(tsconfigPath)

  const entries: Array<VitestAlias & { specificity: number }> = []
  for (const [key, targets] of Object.entries(paths)) {
    const target = targets[0]
    if (target === undefined) continue
    if (!namespaces.some((namespace) => key.startsWith(namespace))) continue
    if (BARE_PACKAGE.test(key)) continue
    if (stubImports && (key === '#imports' || key.startsWith('#imports/'))) continue

    const absolute = isAbsolute(target) ? target : resolve(baseDir, target)
    if (key.endsWith('/*')) {
      const prefix = key.slice(0, -2)
      entries.push({
        find: new RegExp(`^${escapeRegExp(prefix)}/(.*)$`),
        replacement: `${absolute.replace(/[/\\]\*$/, '')}/$1`,
        specificity: prefix.length,
      })
    } else {
      entries.push({
        find: new RegExp(`^${escapeRegExp(key)}$`),
        replacement: absolute,
        specificity: key.length,
      })
    }
  }

  // Most specific first: `#layer/server/database/schema` before `#layer/*`.
  entries.sort((a, b) => b.specificity - a.specificity)
  const aliases: VitestAlias[] = entries.map(({ find, replacement }) => ({ find, replacement }))

  const stub = nitroRuntimeStubPath()
  if (stubImports) aliases.push({ find: /^#imports$/, replacement: stub })
  if (stubNitroRuntime) aliases.push({ find: /^nitropack\/runtime$/, replacement: stub })
  return aliases
}
