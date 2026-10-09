/**
 * Item 15 -- public-reads-are-cached (narduk-libs#1717, follow-up to the
 * `withWorkerCache` helper of #1716 and the #1268 extraction).
 *
 * A public GET route that reads D1 and caches nothing re-runs its query on
 * every request. `setCacheProfile` fixes that for outside callers (the edge
 * stores the response before the Worker runs), but a page Nuxt renders on the
 * server calls the app's own API **in-process**: the call never reaches
 * Workers Cache, and the page HTML is `private, no-store` under the nonce CSP
 * (#435). Only a cache inside the handler (`withWorkerCache`) helps there.
 * soss-demo's station list was 52% of its database's daily rows read for
 * exactly this reason.
 *
 * ROLLOUT MODE
 * ------------
 * This item **warns**. Its sub-checks are `pass` or `not-applicable` and
 * never `fail`, the exit code is 0, and every finding is an *advisory*
 * beside the verdict, the way item 8 carries its `@nuxt/ui` pin warning
 * (`types.ts`: statuses have no warning tier). Publishing it therefore turns
 * no app's CI red. Ratcheting it is one change in `evaluateItem15`: report the
 * findings of each sub-check as `STATUS_FAIL` instead of putting them in
 * `advisories`, then add the command to the generated repository gate.
 *
 * THE HEURISTICS (source scan; nothing is built or run)
 * -----------------------------------------------------
 * 15.1 -- a route file under `server/api/` or `server/routes/` (any monorepo
 * prefix) that answers GET (a `.get.` file or no method suffix) is flagged
 * when ALL of these hold:
 *
 *   1. It reaches D1. Directly: `useDatabase(`, `useAppDatabase(`,
 *      `getD1CacheDB(`, `.prepare(`, `env.DB`, `drizzle(`, a Drizzle
 *      `.select(` with `.from(`, or `.query.<table>.findMany|findFirst(`. Or
 *      through ONE helper hop: a function the route calls that a
 *      `server/utils` file exports (Nitro auto-imports it) or that the route
 *      imports from a relative / `~~/` / `~/` path, when that helper file
 *      reads D1 directly and has no cache layer of its own. The hop is one
 *      file deep and file-granular: a helper file that mixes D1 and pure
 *      functions counts as reading D1 for any call into it.
 *   2. It has no cache layer: `withWorkerCache(`, `withKVCache(` or
 *      `withD1Cache(`.
 *   3. It sets no public cache profile: `setCacheProfile(` with anything but
 *      `'none'`, `defineCacheProfile(`, `definePublishedDataHandler(` with a
 *      profile other than `'none'`, or a `Cache-Control` header naming
 *      `public` or `s-maxage`.
 *
 * It is EXEMPT (listed in the report, not warned) when it is session-bound or
 * deliberately private: `setCacheProfile(event, 'none')` (and no public
 * profile), a `Cache-Control` of `no-store` or `private`, an auth guard in the
 * file (`requireAuth`, `requireUser`, `requireAdmin`, `requireSession`,
 * `requireRole`, `requireCronAuth`, `requireSharedSecret`, `requireAuthScopes`,
 * `requireAdminRouteScopes`, `getUserSession`), or a path under an `admin/` or
 * `auth/` directory. A guard in `server/middleware` is not visible to a
 * per-file scan; use the escape comment there.
 *
 * ESCAPE COMMENT. `// narduk-cache: intentionally-uncached <reason>` anywhere
 * in the route file (a `/* ... *\/` comment works too). The reason is
 * required: a bare marker is itself warned. A suppressed route is listed with
 * its reason in the artefact and the report.
 *
 * 15.2 -- a page, component or composable under `app/` (or `pages/`,
 * `components/`, `composables/`, `layouts/`) that fetches an app route during
 * SSR with a literal path -- `useFetch('/api/x')`, `useLazyFetch(...)`, or a
 * `$fetch('/api/x')` inside `useAsyncData(` / `useLazyAsyncData(` -- unless
 * its options say `server: false`. The path is matched against the GET route
 * files (`[id]` is one segment, `[...slug]` the rest, a `${...}` becomes one
 * segment). It is warned when that route reaches D1 (as in 15.1) and has no
 * `withWorkerCache(` / `withKVCache(` / `withD1Cache(` -- a `setCacheProfile`
 * does NOT satisfy it, because the profile is an edge header the in-process
 * call never reads. The same exemptions and escape comment as 15.1 apply.
 *
 * What it cannot see: a route that builds its handler from a factory in another
 * package, a fetch path held in a variable, a D1 read two helper hops away, and
 * whether the data actually changes. Cheap-by-construction routes (one
 * primary-key read) are warned too; the escape comment is the answer.
 */

import { check } from '../schema.js'
import { APP_PREFIXES } from '../reimplementation-signals.js'
import type { AppRepo } from '../source.js'
import { stripComments } from '../strip-comments.js'
import { STATUS_NA, STATUS_PASS, type FoundationSubCheck } from '../types.js'

export const DATA_CACHE_ITEM_ID = 15
export const DATA_CACHE_ITEM_NAME = 'public-reads-are-cached'

/** Where an app author reads what to do about a warning. */
export const DATA_CACHE_GUIDE =
  'narduk-core README, "Worker data cache: withWorkerCache" ' +
  '(https://github.com/narduk-enterprises/narduk-libs/blob/main/packages/modules/narduk-core/README.md' +
  '#worker-data-cache-withworkercache)'

export const ESCAPE_MARKER = 'narduk-cache: intentionally-uncached'

export type CacheFindingKind = 'uncached-route' | 'ssr-uncached-route' | 'escape-without-reason'

export interface CacheFinding {
  kind: CacheFindingKind
  /** The route file (repo-relative). */
  file: string
  /** The route's URL, e.g. `/api/stations/[id]` -> `/api/stations/:id`. */
  url: string
  /** `direct` D1 access, or the helper file it was reached through. */
  reaches: 'direct' | { helper: string }
  /** 15.2 only: the page, component or composable that fetches the route. */
  consumer?: string
  /** 15.2 only: the literal path the consumer fetches. */
  fetchPath?: string
  message: string
}

export type ExemptionReason = 'private-profile' | 'no-store' | 'auth-guard' | 'auth-path'

export interface CacheExemption {
  file: string
  reason: ExemptionReason
}

export interface CacheSuppression {
  file: string
  reason: string
}

export interface DataCacheScan {
  /** GET route files examined. */
  routes: number
  /** GET routes that reach D1. */
  readingRoutes: number
  /** Consumer files that fetch an app route during SSR. */
  ssrFetches: number
  uncachedRoutes: CacheFinding[]
  ssrFindings: CacheFinding[]
  exempt: CacheExemption[]
  suppressed: CacheSuppression[]
}

const ROUTE_ROOTS = APP_PREFIXES.flatMap((prefix) => [
  `${prefix}server/api`,
  `${prefix}server/routes`,
])
const CONSUMER_ROOTS = APP_PREFIXES.flatMap((prefix) => [
  `${prefix}app`,
  `${prefix}pages`,
  `${prefix}components`,
  `${prefix}composables`,
  `${prefix}layouts`,
])
const ROUTE_EXTENSIONS = ['.ts', '.js', '.mts', '.mjs'] as const
const CONSUMER_EXTENSIONS = ['.vue', '.ts', '.js', '.mts', '.mjs'] as const
const NON_GET_SUFFIX = /\.(?:post|put|patch|delete|head|options|connect|trace)\.[cm]?[jt]s$/
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]s$/

/* ------------------------------ D1 access ------------------------------ */

const D1_DIRECT: readonly RegExp[] = [
  /\b(?:useDatabase|useAppDatabase|getD1CacheDB)\s*\(/,
  /\.prepare\s*\(/,
  /\benv\??\.DB\b/,
  /\bdrizzle\s*\(/,
  /\.query\.[A-Za-z_$][\w$]*\.(?:findMany|findFirst)\s*\(/,
]
const DRIZZLE_SELECT = /\.select(?:Distinct)?\s*\(/
const DRIZZLE_FROM = /\.from\s*\(/

export function readsD1Directly(code: string): boolean {
  return (
    D1_DIRECT.some((pattern) => pattern.test(code)) ||
    (DRIZZLE_SELECT.test(code) && DRIZZLE_FROM.test(code))
  )
}

/* ------------------------------ cache layers --------------------------- */

const CACHE_LAYER = /\bwith(?:Worker|KV|D1)Cache\s*\(/
const SET_PROFILE_CALL = /\bsetCacheProfile\s*\(/g
const SET_PROFILE_NONE = /\bsetCacheProfile\s*\(\s*[^\s,()][^,()]*,\s*(['"`])none\1/g
const DEFINE_PROFILE = /\bdefineCacheProfile\s*\(/
const PUBLISHED_HANDLER = /\bdefinePublishedDataHandler\s*\(/
const PUBLISHED_HANDLER_NONE = /\bprofile\s*:\s*(['"`])none\1/
const CACHE_CONTROL_PUBLIC = /['"`]Cache-Control['"`]\s*,\s*['"`][^'"`]*\b(?:public|s-maxage)\b/i
const CACHE_CONTROL_PRIVATE = /['"`]Cache-Control['"`]\s*,\s*['"`][^'"`]*\b(?:no-store|private)\b/i
const AUTH_GUARD =
  /\b(?:require(?:Auth|User|Admin|Session|Role|CronAuth|SharedSecret|AuthScopes|AdminRouteScopes)|getUserSession)\s*\(/
const AUTH_PATH = /(?:^|\/)server\/(?:api|routes)\/(?:.*\/)?(?:admin|auth)\//

function count(code: string, pattern: RegExp): number {
  return code.match(pattern)?.length ?? 0
}

function hasCacheLayer(code: string): boolean {
  return CACHE_LAYER.test(code)
}

function hasPublicProfile(code: string): boolean {
  if (count(code, SET_PROFILE_CALL) > count(code, SET_PROFILE_NONE)) return true
  if (DEFINE_PROFILE.test(code)) return true
  if (PUBLISHED_HANDLER.test(code) && !PUBLISHED_HANDLER_NONE.test(code)) return true
  return CACHE_CONTROL_PUBLIC.test(code)
}

function exemptionOf(file: string, code: string): ExemptionReason | null {
  if (count(code, SET_PROFILE_NONE) > 0) return 'private-profile'
  if (CACHE_CONTROL_PRIVATE.test(code)) return 'no-store'
  if (AUTH_GUARD.test(code)) return 'auth-guard'
  if (AUTH_PATH.test(file)) return 'auth-path'
  return null
}

/** The marker's reason, `''` for a bare marker, `null` for no marker. */
function escapeReason(source: string): string | null {
  const at = source.indexOf(ESCAPE_MARKER)
  if (at === -1) return null
  const lineEnd = source.indexOf('\n', at)
  const tail = source.slice(at + ESCAPE_MARKER.length, lineEnd === -1 ? undefined : lineEnd)
  return tail
    .replace(/\*\/\s*$/, '')
    .replace(/^[\s:\u2013\u2014-]+/, '')
    .trim()
}

/* ------------------------------ helpers -------------------------------- */

interface HelperInfo {
  file: string
  /** Reads D1 directly and has no cache layer of its own. */
  readsUncached: boolean
}

const EXPORT_FUNCTION = /\bexport\s+(?:async\s+)?function\s+([a-z_$][\w$]*)/gi
const EXPORT_VALUE = /\bexport\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g
const EXPORT_LIST = /\bexport\s*\{([^}]*)\}/g
const IMPORT_FROM = /\bimport\b([^'";(]+?)\bfrom\s*(['"`])([^'"`]+)\2/g
const IMPORT_DYNAMIC = /\bimport\s*\(\s*(['"`])([^'"`]+)\1\s*\)/g
const RESOLVE_SUFFIXES = ['', '.ts', '.mts', '.js', '.mjs', '/index.ts', '/index.js'] as const

function exportedNames(code: string): string[] {
  const names = new Set<string>()
  for (const match of code.matchAll(EXPORT_FUNCTION)) names.add(match[1] as string)
  for (const match of code.matchAll(EXPORT_VALUE)) names.add(match[1] as string)
  for (const match of code.matchAll(EXPORT_LIST)) {
    for (const part of (match[1] as string).split(',')) {
      const name = part
        .trim()
        .split(/\s+as\s+/)
        .pop()
      if (name && /^[a-z_$][\w$]*$/i.test(name)) names.add(name)
    }
  }
  return [...names]
}

function normalizePath(path: string): string {
  const out: string[] = []
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') out.pop()
    else out.push(segment)
  }
  return out.join('/')
}

function dirnameOf(file: string): string {
  const at = file.lastIndexOf('/')
  return at === -1 ? '' : file.slice(0, at)
}

/** The app root a route file lives under: everything before `server/`. */
function appRootOf(file: string): string {
  const at = file.indexOf('server/')
  return at === -1 ? '' : file.slice(0, at)
}

function importCandidates(file: string, spec: string): string[] {
  const root = appRootOf(file)
  let bases: string[] = []
  if (spec.startsWith('.')) bases = [normalizePath(`${dirnameOf(file)}/${spec}`)]
  else if (spec.startsWith('~~/') || spec.startsWith('@@/'))
    bases = [normalizePath(`${root}${spec.slice(3)}`)]
  else if (spec.startsWith('~/') || spec.startsWith('@/'))
    bases = [normalizePath(`${root}app/${spec.slice(2)}`), normalizePath(`${root}${spec.slice(2)}`)]
  return bases.flatMap((base) => RESOLVE_SUFFIXES.map((suffix) => `${base}${suffix}`))
}

class HelperIndex {
  private readonly byFile = new Map<string, HelperInfo | null>()
  private readonly autoImports = new Map<string, Map<string, string>>()

  constructor(private readonly repo: AppRepo) {}

  private info(file: string): HelperInfo | null {
    if (this.byFile.has(file)) return this.byFile.get(file) ?? null
    const source = this.repo.read(file)
    const info: HelperInfo | null =
      source === null
        ? null
        : {
            file,
            readsUncached:
              readsD1Directly(stripComments(source)) && !hasCacheLayer(stripComments(source)),
          }
    this.byFile.set(file, info)
    return info
  }

  /** Export name -> file for the app's `server/utils` (Nitro auto-imports). */
  private autoImportsFor(root: string): Map<string, string> {
    const known = this.autoImports.get(root)
    if (known) return known
    const index = new Map<string, string>()
    for (const file of this.repo.walk(`${root}server/utils`, ROUTE_EXTENSIONS)) {
      const source = this.repo.read(file)
      if (source === null) continue
      for (const name of exportedNames(stripComments(source))) {
        if (!index.has(name)) index.set(name, file)
      }
    }
    this.autoImports.set(root, index)
    return index
  }

  /** The first helper this route calls that reads D1 with no cache layer. */
  uncachedHelperFor(file: string, code: string): string | null {
    const called = (name: string) => new RegExp(String.raw`\b${escapeRegExp(name)}\s*\(`).test(code)
    // A default or namespace import is used as `stations.list(` as well as `list(`.
    const referenced = (name: string) =>
      new RegExp(String.raw`\b${escapeRegExp(name)}\s*[.(]`).test(code)

    for (const [name, helperFile] of this.autoImportsFor(appRootOf(file))) {
      if (helperFile === file || !called(name)) continue
      if (this.info(helperFile)?.readsUncached) return helperFile
    }

    const specs: Array<{ clause: string | null; spec: string }> = []
    for (const match of code.matchAll(IMPORT_FROM)) {
      specs.push({ clause: match[1] as string, spec: match[3] as string })
    }
    for (const match of code.matchAll(IMPORT_DYNAMIC)) {
      specs.push({ clause: null, spec: match[2] as string })
    }
    for (const { clause, spec } of specs) {
      const helperFile = importCandidates(file, spec).find((candidate) => this.info(candidate))
      if (!helperFile || helperFile === file) continue
      if (clause !== null && !importedNamesUsed(clause, referenced)) continue
      if (this.info(helperFile)?.readsUncached) return helperFile
    }
    return null
  }
}

function escapeRegExp(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)
}

/** Whether an import clause brings in a name the route calls or reads a member of. */
function importedNamesUsed(clause: string, referenced: (name: string) => boolean): boolean {
  const names: string[] = []
  const braces = /\{([^}]*)\}/.exec(clause)
  if (braces) {
    for (const part of (braces[1] as string).split(',')) {
      const local = part
        .trim()
        .replace(/^type\s+/, '')
        .split(/\s+as\s+/)
        .pop()
      if (local) names.push(local)
    }
  }
  const outside = clause.replace(/\{[^}]*\}/, '').replaceAll(/\*\s*as\s*/g, '')
  for (const part of outside.split(',')) {
    const local = part.trim()
    if (/^[a-z_$][\w$]*$/i.test(local)) names.push(local)
  }
  return names.some((name) => referenced(name))
}

/* ------------------------------ routes --------------------------------- */

interface RouteInfo {
  file: string
  url: string
  pattern: RegExp
  /** Specificity: 0 static, +1 per `[param]`, +10 per catch-all. */
  weight: number
  code: string
  reaches: CacheFinding['reaches'] | null
  cacheLayer: boolean
  publicProfile: boolean
  exemption: ExemptionReason | null
  escape: string | null
}

function routeUrl(file: string): { url: string; pattern: RegExp; weight: number } | null {
  const match = /(?:^|\/)server\/(api|routes)\/(.+)$/.exec(file)
  if (!match) return null
  const base = match[1] === 'api' ? '/api' : ''
  const rest = (match[2] as string).replace(/\.(?:get\.)?[cm]?[jt]s$/, '')
  const segments = rest.split('/')
  if (segments[segments.length - 1] === 'index') segments.pop()
  let weight = 0
  const urlParts: string[] = []
  const regexParts: string[] = []
  for (const segment of segments) {
    const catchAll = /^\[\.\.\.([^\]]+)\]$/.exec(segment)
    const param = /^\[([^\]]+)\]$/.exec(segment)
    if (catchAll) {
      weight += 10
      urlParts.push(`*${catchAll[1]}`)
      regexParts.push('.+')
    } else if (param) {
      weight += 1
      urlParts.push(`:${param[1]}`)
      regexParts.push('[^/]+')
    } else {
      urlParts.push(segment)
      regexParts.push(escapeRegExp(segment))
    }
  }
  const url = `${base}/${urlParts.join('/')}`.replace(/\/+$/, '') || '/'
  const pattern = new RegExp(`^${base}/${regexParts.join('/')}$`.replace(/\/+\$$/, '/?$'))
  return { url, pattern, weight }
}

function analyseRoutes(repo: AppRepo, helpers: HelperIndex): RouteInfo[] {
  const files = ROUTE_ROOTS.flatMap((root) => repo.walk(root, ROUTE_EXTENSIONS)).filter(
    (file) => !NON_GET_SUFFIX.test(file) && !TEST_FILE.test(file),
  )
  const routes: RouteInfo[] = []
  for (const file of [...new Set(files)].sort()) {
    const source = repo.read(file)
    const target = routeUrl(file)
    if (source === null || target === null) continue
    const code = stripComments(source)
    const helper = readsD1Directly(code) ? null : helpers.uncachedHelperFor(file, code)
    routes.push({
      file,
      ...target,
      code,
      reaches: readsD1Directly(code) ? 'direct' : helper ? { helper } : null,
      cacheLayer: hasCacheLayer(code),
      publicProfile: hasPublicProfile(code),
      exemption: exemptionOf(file, code),
      escape: escapeReason(source),
    })
  }
  return routes
}

/* ------------------------------ SSR fetches ---------------------------- */

const FETCH_CALL = /\buse(?:Lazy)?Fetch(?:\s*<[^()]{0,300}>)?\s*\(/g
const ASYNC_DATA_CALL = /\buse(?:Lazy)?AsyncData(?:\s*<[^()]{0,300}>)?\s*\(/g
const INNER_FETCH = /\$fetch(?:\s*<[^()]{0,300}>)?\s*\(\s*(['"`])(\/[^'"`]*)\1/g
const FIRST_PATH = /(['"`])(\/[^'"`\s]*)\1/
const SERVER_FALSE = /\bserver\s*:\s*false\b/

/** The text between the parenthesis at `open` and its match, bounded. */
function argumentsOf(code: string, open: number): string {
  let depth = 0
  let quote: string | null = null
  const limit = Math.min(code.length, open + 4000)
  for (let index = open; index < limit; index += 1) {
    const char = code[index] as string
    if (quote) {
      if (char === '\\') index += 1
      else if (char === quote) quote = null
    } else if (char === '"' || char === "'" || char === '`') {
      quote = char
    } else if (char === '(') {
      depth += 1
    } else if (char === ')') {
      depth -= 1
      if (depth === 0) return code.slice(open + 1, index)
    }
  }
  return code.slice(open + 1, limit)
}

function stripHtmlComments(source: string): string {
  let out = ''
  let index = 0
  while (index < source.length) {
    const start = source.indexOf('<!--', index)
    if (start === -1) {
      out += source.slice(index)
      break
    }
    out += source.slice(index, start)
    const end = source.indexOf('-->', start + 4)
    if (end === -1) break
    index = end + 3
  }
  return out
}

/** Literal paths a file fetches during SSR, query and hash removed. */
export function ssrFetchPaths(source: string, isVue: boolean): string[] {
  const code = stripComments(isVue ? stripHtmlComments(source) : source)
  const found: string[] = []
  const clean = (raw: string): string =>
    raw
      .replaceAll(/\$\{[^}]*\}/g, 'x')
      .replace(/[?#].*$/, '')
      .replace(/\/+$/, '') || '/'

  for (const match of code.matchAll(FETCH_CALL)) {
    const args = argumentsOf(code, (match.index as number) + match[0].length - 1)
    if (SERVER_FALSE.test(args)) continue
    const path = FIRST_PATH.exec(args)
    if (path) found.push(clean(path[2] as string))
  }
  for (const match of code.matchAll(ASYNC_DATA_CALL)) {
    const args = argumentsOf(code, (match.index as number) + match[0].length - 1)
    if (SERVER_FALSE.test(args)) continue
    for (const inner of args.matchAll(INNER_FETCH)) found.push(clean(inner[2] as string))
  }
  return found
}

function routeFor(routes: RouteInfo[], path: string): RouteInfo | null {
  let best: RouteInfo | null = null
  for (const route of routes) {
    if (!route.pattern.test(path)) continue
    if (best === null || route.weight < best.weight) best = route
  }
  return best
}

/* ------------------------------ the scan ------------------------------- */

function describe(reaches: CacheFinding['reaches']): string {
  return reaches === 'direct' ? 'reads D1 directly' : `reads D1 through ${reaches.helper}`
}

export function scanDataCache(repo: AppRepo): DataCacheScan {
  const helpers = new HelperIndex(repo)
  const routes = analyseRoutes(repo, helpers)
  const scan: DataCacheScan = {
    routes: routes.length,
    readingRoutes: 0,
    ssrFetches: 0,
    uncachedRoutes: [],
    ssrFindings: [],
    exempt: [],
    suppressed: [],
  }

  for (const route of routes) {
    if (route.reaches === null) continue
    scan.readingRoutes += 1
    if (route.cacheLayer || route.publicProfile) continue
    if (route.exemption) {
      scan.exempt.push({ file: route.file, reason: route.exemption })
    } else if (route.escape) {
      scan.suppressed.push({ file: route.file, reason: route.escape })
    } else {
      const bare = route.escape === ''
      const finding: CacheFinding = {
        kind: bare ? 'escape-without-reason' : 'uncached-route',
        file: route.file,
        url: route.url,
        reaches: route.reaches,
        message: bare
          ? `${route.file} (GET ${route.url}) ${describe(route.reaches)} and carries the "${ESCAPE_MARKER}" ` +
            'marker with no reason; add the reason after the marker.'
          : `${route.file} (GET ${route.url}) ${describe(route.reaches)} with no public cache profile ` +
            'and no withWorkerCache / withKVCache / withD1Cache.',
      }
      scan.uncachedRoutes.push(finding)
    }
  }

  const seen = new Set<string>()
  const consumers = [
    ...new Set(
      [
        ...CONSUMER_ROOTS.flatMap((root) => repo.walk(root, CONSUMER_EXTENSIONS)),
        ...APP_PREFIXES.flatMap((prefix) =>
          ['app.vue', 'app/app.vue']
            .map((name) => `${prefix}${name}`)
            .filter((p) => repo.exists(p)),
        ),
      ].filter((file) => !TEST_FILE.test(file)),
    ),
  ].sort()
  for (const file of consumers) {
    const source = repo.read(file)
    if (source === null) continue
    for (const path of ssrFetchPaths(source, file.endsWith('.vue'))) {
      const route = routeFor(routes, path)
      if (route === null) continue
      scan.ssrFetches += 1
      if (route.reaches === null || route.cacheLayer) continue
      if (route.exemption || (route.escape !== null && route.escape !== '')) continue
      const key = `${file}\u0000${route.file}`
      if (seen.has(key)) continue
      seen.add(key)
      scan.ssrFindings.push({
        kind: 'ssr-uncached-route',
        file: route.file,
        url: route.url,
        reaches: route.reaches,
        consumer: file,
        fetchPath: path,
        message:
          `${file} fetches ${path} during SSR; ${route.file} ${describe(route.reaches)} and has no ` +
          'withWorkerCache / withKVCache / withD1Cache (a cache profile is an edge header and does ' +
          'not apply to an in-process call).',
      })
    }
  }
  return scan
}

export interface Item15Result {
  checks: FoundationSubCheck[]
  scan: DataCacheScan
}

export function evaluateItem15(repo: AppRepo): Item15Result {
  const scan = scanDataCache(repo)
  const id15_1 = '15.1'
  const name15_1 = 'public GET routes that read D1 are cached'
  const id15_2 = '15.2'
  const name15_2 = 'SSR fetches of D1-reading routes are cached in-process'

  if (scan.routes === 0) {
    const detail = 'no server/api or server/routes GET handlers'
    return {
      scan,
      checks: [
        check(id15_1, name15_1, STATUS_NA, detail),
        check(id15_2, name15_2, STATUS_NA, detail),
      ],
    }
  }

  const routeWarnings = scan.uncachedRoutes.length
  const ssrWarnings = scan.ssrFindings.length
  const first =
    `${scan.readingRoutes} of ${scan.routes} GET route(s) reach D1; ${routeWarnings} warned, ` +
    `${scan.exempt.length} exempt, ${scan.suppressed.length} suppressed with a reason` +
    (routeWarnings > 0 ? ' (rollout mode: a warning, not a failure)' : '')
  const second =
    scan.ssrFetches === 0
      ? 'no page or composable fetches an app route during SSR'
      : `${scan.ssrFetches} SSR fetch(es) of an app route; ${ssrWarnings} warned` +
        (ssrWarnings > 0 ? ' (rollout mode: a warning, not a failure)' : '')
  return {
    scan,
    checks: [
      check(id15_1, name15_1, STATUS_PASS, first),
      check(id15_2, name15_2, scan.ssrFetches === 0 ? STATUS_NA : STATUS_PASS, second),
    ],
  }
}

/** Every warning as one line, in the order a reader fixes them. */
export function dataCacheAdvisories(scan: DataCacheScan): string[] {
  return [...scan.uncachedRoutes, ...scan.ssrFindings].map((finding) => finding.message)
}
