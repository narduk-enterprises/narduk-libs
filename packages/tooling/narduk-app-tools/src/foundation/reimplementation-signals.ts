/**
 * Part (b) of item 9: app-local reimplementations of behaviour a shared
 * `@narduk-enterprises/*` package already owns.
 *
 * This is the machine half of company-hq `docs/NARDUK-APP-COMPLIANCE.md` §3.9
 * ("shared behaviour is fixed upstream, never worked around in the app" --
 * Logan, 2026-09-16: "the rule is to fix the lib if there is a bug rather than
 * working around the issue in the app"). §3.9's own "Verified by" is an audit
 * review step with `enforcement: none yet`; this module does not replace that
 * judgement, it finds the candidates the reviewer then judges.
 *
 * TWO CONFIDENCE TIERS, AND WHY THEY DIFFER
 * -----------------------------------------
 * Item 4.2 already flags an EXACT copy of package-owned code by content hash.
 * A reimplementation is the harder case: same behaviour, different text. So
 * every detector here is a source signal plus one question --
 *
 *   is the owning shared package a dependency of this app?
 *
 *   - YES -> `confirmed`. The package is installed and the app wrote its own
 *     anyway. That is the §3.9 duplication finding, reported as a FAIL naming
 *     the exact file and the owning package.
 *   - NO  -> `heuristic`. There is app-local code doing a shared package's job,
 *     but nothing proves it is a fork rather than something the app genuinely
 *     owns and has never had the option to adopt. Reported as a WARN, which
 *     carries the foundation vocabulary's `unknown` -- never a pass, never a
 *     decided failure (`types.ts`: "`unknown` is never a pass, and a `fail` is
 *     never erased by an undecided sibling").
 *
 * That split is what keeps the false-positive rate at zero on a conformant app:
 * the confident tier requires the app to have BOTH the shared package and a
 * local twin, which a conformant app never does.
 *
 * WHAT IS NOT SCANNED
 * -------------------
 * Only tracked-source directories at the monorepo prefixes item 1 and item 3
 * already use. `AppRepo.walk()` skips `node_modules`, `.git`, `dist`, `.output`
 * and `.nuxt`, which matters more here than anywhere else in the checker: a
 * built Nitro bundle inlines every dependency, so `.output/server/chunks` in a
 * conformant app contains `createLogger`, `posthog`, and a health route, and a
 * scan that reached it would fail every app in the estate.
 */

import type { AppRepo } from './source.js'

export const NARDUK_LOGGING = '@narduk-enterprises/narduk-logging'
export const NARDUK_CORE = '@narduk-enterprises/narduk-core'
export const NARDUK_SEO = '@narduk-enterprises/narduk-seo'
export const NARDUK_ANALYTICS = '@narduk-enterprises/narduk-analytics'

/** Monorepo prefixes an app's own source can live under -- the same set
 * `PACKAGE_JSON_CANDIDATES` and `NUXT_CONFIG_CANDIDATES` already accept. */
export const APP_PREFIXES = ['', 'apps/web/', 'apps/api/', 'web/'] as const

/** Directory names walked under each prefix. Bounded on purpose: a full-repo
 * walk costs minutes on a large app and buys no signal these directories do not
 * already carry. */
export const SCAN_DIRECTORY_NAMES = [
  'app',
  'src',
  'server',
  'shared',
  'composables',
  'utils',
  'plugins',
  'components',
  'layers',
  'scripts',
] as const

export const SCAN_EXTENSIONS = ['.ts', '.mts', '.js', '.mjs', '.vue'] as const

/** Ceiling on files read in one run. A repository larger than this is reported
 * as `unknown` for the detectors rather than as a silently partial pass. */
export const SCAN_FILE_LIMIT = 2000

export interface ScannedFile {
  rel: string
  text: string
}

export interface SourceScan {
  files: ScannedFile[]
  /** Directories that existed and were walked, repo-relative. */
  directories: string[]
  /** True when `SCAN_FILE_LIMIT` was reached, so the scan is incomplete. */
  truncated: boolean
}

export function scanAppSource(repo: AppRepo): SourceScan {
  const directories: string[] = []
  const files: ScannedFile[] = []
  const seen = new Set<string>()
  let truncated = false
  for (const prefix of APP_PREFIXES) {
    for (const name of SCAN_DIRECTORY_NAMES) {
      const dir = `${prefix}${name}`
      if (!repo.exists(dir)) continue
      const found = repo.walk(dir, SCAN_EXTENSIONS)
      if (found.length === 0 && !repo.exists(dir)) continue
      directories.push(dir)
      for (const rel of found) {
        if (seen.has(rel)) continue
        if (files.length >= SCAN_FILE_LIMIT) {
          truncated = true
          break
        }
        seen.add(rel)
        const text = repo.read(rel)
        if (text !== null) files.push({ rel, text })
      }
    }
  }
  return { files, directories: directories.sort(), truncated }
}

/** A raw signal hit. The `confirmed` / `heuristic` tier is NOT decided here:
 * it depends on whether the owning shared package is a dependency of the app,
 * which is a manifest fact the item evaluator holds. A detector's job is to
 * find the code and say what it saw. */
export interface Detection {
  /** Repo-relative file the signal was found in. */
  path: string
  /** One sentence naming the signal, for the sub-check detail. */
  detail: string
}

/** Any import or re-export from an `@narduk-enterprises/*` package. A file that
 * has one is adapting the shared package, not replacing it. */
const ESTATE_IMPORT_RE = /\bfrom\s*['"]@narduk-enterprises\/[^'"]+['"]/

function importsEstatePackage(text: string, packageName?: string): boolean {
  if (packageName === undefined) return ESTATE_IMPORT_RE.test(text)
  return new RegExp(`\\bfrom\\s*['"]${packageName}(?:/[^'"]*)?['"]`).test(text)
}

// ── Detector 1: app-local logger ──────────────────────────────────────────

const CREATE_LOGGER_DECLARATION_RE =
  /(?:^|\n)\s*(?:export\s+)?(?:(?:async\s+)?function\s+createLogger\b|(?:const|let|var)\s+createLogger\s*=)/
const LOGGER_EXPORT_RE =
  /(?:^|\n)\s*export\s+(?:(?:async\s+)?function|const|let|class)\s+(?:logger|log|useLogger)\b/
const CONSOLE_TRANSPORT_RE = /\bconsole\s*\.\s*(?:log|info|warn|error|debug|trace)\s*\(/
const LOGGER_FILENAME_RE = /(?:^|\/)(?:logger|logging)\.(?:ts|mts|js|mjs)$/

/** A `createLogger`/`logger.ts` with a console transport, outside node_modules.
 *
 * Both halves are required. `createLogger` alone is satisfied by
 * `import { createLogger } from '@narduk-enterprises/narduk-logging'` in any
 * adopting app, and a bare `console.log` is not a logger -- it is a console
 * call, which the adoption guide treats separately. The console transport is
 * what makes the local code a logger *implementation*. */
export function detectAppLocalLogger(files: readonly ScannedFile[]): Detection[] {
  const hits: Detection[] = []
  for (const { rel, text } of files) {
    if (importsEstatePackage(text)) continue
    if (!CONSOLE_TRANSPORT_RE.test(text)) continue
    const declaresFactory = CREATE_LOGGER_DECLARATION_RE.test(text)
    const namedLoggerModule = LOGGER_FILENAME_RE.test(rel) && LOGGER_EXPORT_RE.test(text)
    if (!declaresFactory && !namedLoggerModule) continue
    hits.push({
      path: rel,
      detail: declaresFactory
        ? 'declares its own createLogger() with a console transport'
        : 'is a logger module exporting a logger with a console transport',
    })
  }
  return hits
}

// ── Detector 2: copied SEO helpers ────────────────────────────────────────

const SEO_TWIN_NAMES = ['useSeo', 'defaultSocialMeta'] as const
const SEO_DECLARATION_RE = new RegExp(
  `(?:^|\\n)\\s*(?:export\\s+)?(?:(?:async\\s+)?function|const|let|class)\\s+(?:${SEO_TWIN_NAMES.join('|')})\\b`,
)
const SEO_FILENAME_RE = new RegExp(`(?:^|/)(?:${SEO_TWIN_NAMES.join('|')})\\.(?:ts|mts|js|mjs)$`)

/** An app-local `useSeo` / `defaultSocialMeta` twin.
 *
 * narduk-seo ships these as layer auto-imports (`app/composables/useSeo.ts`,
 * `app/utils/defaultSocialMeta.ts`), so an app-local file of the same name
 * SHADOWS the shared one rather than sitting beside it -- which is why a twin
 * is worth naming even when it started as a copy-and-tweak. A file that imports
 * from narduk-seo is a wrapper and is not reported. */
export function detectCopiedSeoHelpers(files: readonly ScannedFile[]): Detection[] {
  const hits: Detection[] = []
  for (const { rel, text } of files) {
    if (importsEstatePackage(text, NARDUK_SEO)) continue
    const declares = SEO_DECLARATION_RE.test(text)
    if (!declares && !SEO_FILENAME_RE.test(rel)) continue
    hits.push({
      path: rel,
      detail: declares
        ? `declares a local ${SEO_TWIN_NAMES.join('/')} twin of narduk-seo's auto-imported helper`
        : "is named for narduk-seo's auto-imported helper and shadows it",
    })
  }
  return hits
}

// ── Detector 3: analytics wrapper importing posthog-js directly ───────────

const POSTHOG_IMPORT_RE =
  /\bfrom\s*['"]posthog-js(?:\/[^'"]*)?['"]|\b(?:require|import)\(\s*['"]posthog-js(?:\/[^'"]*)?['"]/

/** A direct `posthog-js` import in app source. narduk-analytics is the PostHog
 * surface for estate apps ("PostHog, GA, Search Console, and IndexNow Nuxt
 * module"), so an app reaching for the vendor SDK itself is wrapping what the
 * module already wraps. A `posthog` string in `nuxt.config.ts` runtime config
 * is NOT this signal -- configuring the shared module names PostHog constantly. */
export function detectDirectPosthogUse(files: readonly ScannedFile[]): Detection[] {
  const hits: Detection[] = []
  for (const { rel, text } of files) {
    if (!POSTHOG_IMPORT_RE.test(text)) continue
    hits.push({
      path: rel,
      detail: 'imports the posthog-js SDK directly instead of narduk-analytics',
    })
  }
  return hits
}

/** The manifest-level half: a direct `posthog-js` pin with no import found in
 * the scanned directories. Always heuristic -- the dependency is real, but the
 * code that uses it is somewhere this scan does not reach. */
export const POSTHOG_PACKAGE = 'posthog-js'

// ── Detector 4: app-owned health route ────────────────────────────────────

/**
 * Nitro mounts `server/api/health.get.ts` and `server/api/health/index.get.ts`
 * at `/api/health`. A nested file such as `server/api/v1/health.get.ts` mounts
 * `/api/v1/health` and is not a copy of the shared route.
 */
const HEALTH_ROUTE_RE = /(?:^|\/)server\/api\/health(?:\/index)?(?:\.[a-z]+)?\.(?:ts|mts|js|mjs)$/
const REGISTER_HEALTH_CHECK_RE = /\bregisterHealthCheck\b/

/** A route file that answers `/api/health` without using narduk-core's
 * `registerHealthCheck`.
 *
 * company-hq `NARDUK-APP-COMPLIANCE.md` §3.6 rule 1 (narduk-libs#313, Logan
 * 2026-09-16): "The app serves the shared narduk-core `/api/health` route; it
 * does not own a hand-rolled copy." Core's route is
 * `packages/modules/narduk-core/runtime/server/api/health.get.ts`; an app
 * registers its own probes with `registerHealthCheck` from a Nitro plugin
 * instead of writing a route. */
export function detectHandRolledHealthRoute(files: readonly ScannedFile[]): Detection[] {
  const hits: Detection[] = []
  for (const { rel, text } of files) {
    if (!HEALTH_ROUTE_RE.test(rel)) continue
    if (REGISTER_HEALTH_CHECK_RE.test(text)) continue
    hits.push({
      path: rel,
      detail: "answers /api/health without narduk-core's registerHealthCheck",
    })
  }
  return hits
}

export function hasServerApiSurface(repo: AppRepo): boolean {
  return APP_PREFIXES.some((prefix) => repo.exists(`${prefix}server/api`))
}

// ── Detector 5: duplicate error plugin / response finish listener ─────────

const NITRO_PLUGIN_RE = /\bdefineNitroPlugin\s*\(/
const NITRO_PLUGIN_PATH_RE = /(?:^|\/)server\/plugins\//
const ERROR_HOOK_RE = /\.hook\(\s*['"](?:error|afterResponse)['"]/
const RESPONSE_FINISH_RE = /\.\s*on\(\s*['"]finish['"]/
const LOG_CALL_RE =
  /\bconsole\s*\.\s*(?:log|info|warn|error|debug|trace)\s*\(|\b(?:logger|log)\s*\.\s*(?:info|warn|error|debug|trace)\s*\(/

/** narduk-logging adoption guide step 5: "Remove app-local copied logger
 * implementations, response `finish` listeners, and duplicate error plugins.
 * Core and the standalone logging module share one Nitro installation guard."
 *
 * The hook alone is not the finding -- the same guide says "Do not replace
 * product-specific error handling", and an app is allowed to hook `error` for
 * its own product behaviour. The finding is a hook that ALSO logs: that is a
 * second request-summary or error-log implementation running beside the shared
 * one, which is what the guide's "Keep only one request-summary implementation
 * active" forbids. */
export function detectDuplicateErrorPlugins(files: readonly ScannedFile[]): Detection[] {
  const hits: Detection[] = []
  for (const { rel, text } of files) {
    const isNitroPlugin = NITRO_PLUGIN_PATH_RE.test(rel) || NITRO_PLUGIN_RE.test(text)
    if (!isNitroPlugin) continue
    if (!LOG_CALL_RE.test(text)) continue
    const hooksError = ERROR_HOOK_RE.test(text)
    const listensFinish = RESPONSE_FINISH_RE.test(text)
    if (!hooksError && !listensFinish) continue
    hits.push({
      path: rel,
      detail: hooksError
        ? 'hooks the Nitro error/afterResponse hook and logs from it, duplicating the shared request summary'
        : 'attaches a response finish listener that logs, duplicating the shared request summary',
    })
  }
  return hits
}

export function hasNitroPluginSurface(repo: AppRepo, files: readonly ScannedFile[]): boolean {
  if (APP_PREFIXES.some((prefix) => repo.exists(`${prefix}server/plugins`))) return true
  return files.some(({ text }) => NITRO_PLUGIN_RE.test(text))
}

// ── Detector 6: hand-rolled narduk-data reader ────────────────────────────

const NARDUK_DATA_ORIGIN_RE = /['"`]https:\/\/data\.nard\.uk(?:[/'"`?#]|\$\{)/
const FETCH_CALL_RE = /(?:\bfetch|\$fetch|\bofetch|\bfetchJson)\s*[(<]/
const SHARED_DATA_CLIENT_RE = /\b(?:createNardukDataClient|fetchNardukDataJson)\b/

/** A file that fetches `https://data.nard.uk` itself instead of through
 * narduk-core's shared product client (narduk-libs#373).
 *
 * `createNardukDataClient` / `fetchNardukDataJson` carry the timeout, retry,
 * single-flight, stale-if-error, SHA-256 and freshness policy; the hand-rolled
 * readers found in the estate had each dropped some of it (no timeout, no
 * checksum, the release pin skipped). Both halves are required: the origin as a
 * string literal AND a fetch call in the same file. A file that names either
 * shared entry point -- they are Nitro auto-imports, so there may be no import
 * line -- is configuring the client, not replacing it, and is not reported. */
export function detectHandRolledNardukDataReader(files: readonly ScannedFile[]): Detection[] {
  const hits: Detection[] = []
  for (const { rel, text } of files) {
    if (!NARDUK_DATA_ORIGIN_RE.test(text)) continue
    if (SHARED_DATA_CLIENT_RE.test(text)) continue
    if (!FETCH_CALL_RE.test(text)) continue
    hits.push({
      path: rel,
      detail:
        "fetches https://data.nard.uk directly instead of through narduk-core's " +
        'createNardukDataClient / fetchNardukDataJson',
    })
  }
  return hits
}
