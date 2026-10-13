/**
 * Item 3 -- capability packages (spec §3 item 3).
 *
 * Spec §3: "Applicability is a property of the running app, not of its
 * manifests, so the rollup's static half reports item 3 `unknown` in full and
 * `foundation:check` owns it." This tool has the whole checkout, so it reads
 * the same in-app signal item 1.4 already uses --
 * `access.exposureClass` on `Config/cloudflare-app.json` or, for a
 * Coolify-only app, `Config/coolify-app.json` -- plus real bindings
 * and a bounded source-import scan, instead of the cross-repo
 * `APP_REGISTRY.yaml` fields an app's own CI cannot read.
 *
 * Every sub-check below is a heuristic over real, in-repo signals, not a
 * decree from a registry this checkout cannot see. Where the signal is
 * genuinely absent, the sub-check is `not-applicable` (the condition plainly
 * does not hold) rather than a guessed pass -- guessing a pass on a
 * capability the app never demonstrated would be exactly the "check that
 * cannot see" the whole contract exists to forbid.
 */

import { check } from '../schema.js'
import {
  bindingNames,
  findWranglerConfig,
  mergedDeps,
  collectPackages,
  detectNuxt,
  type AppRepo,
  type NuxtPresence,
} from '../source.js'
import { isR2BucketRole, manifestR2Buckets, type ManifestR2Bucket } from '../../r2-roles.js'
import { readCloudflareApp, readCloudflareAppExposureClass } from './item-1-scaffold-parity.js'
import {
  STATUS_FAIL,
  STATUS_NA,
  STATUS_PASS,
  STATUS_UNKNOWN,
  type FoundationSubCheck,
} from '../types.js'

const ESTATE_CHART_MAP_PACKAGES = [
  '@narduk-enterprises/narduk-charts',
  '@narduk-enterprises/narduk-mapkit',
  '@narduk-enterprises/narduk-maps',
]
const CHART_MAP_IMPORT_RE =
  /\b(?:leaflet|mapbox-gl|maplibre-gl|chart\.js|echarts|d3-[a-z]+|@narduk-geo\/(?:narduk-charts|narduk-mapkit))\b/

const SOURCE_SCAN_DIRS = [
  'app',
  'apps/web/app',
  'src',
  'components',
  'apps/web/app/components',
] as const
const SOURCE_SCAN_EXTENSIONS = ['.vue', '.ts', '.tsx'] as const
const SOURCE_SCAN_FILE_LIMIT = 400

function scanSourceForPattern(repo: AppRepo, pattern: RegExp): string | null {
  let scanned = 0
  for (const dir of SOURCE_SCAN_DIRS) {
    for (const rel of repo.walk(dir, SOURCE_SCAN_EXTENSIONS)) {
      if (scanned >= SOURCE_SCAN_FILE_LIMIT) return null
      scanned += 1
      const text = repo.read(rel)
      if (text && pattern.test(text)) return rel
    }
  }
  return null
}

function evaluate31And32(
  repo: AppRepo,
  exposureClass: string | null,
  merged: Record<string, string>,
): FoundationSubCheck[] {
  const hasAuth = '@narduk-enterprises/narduk-auth' in merged
  const hasSeo = '@narduk-enterprises/narduk-seo' in merged
  const hasAnalytics = '@narduk-enterprises/narduk-analytics' in merged

  if (exposureClass === null) {
    return [
      check(
        '3.1',
        'public site: narduk-seo + narduk-analytics',
        STATUS_UNKNOWN,
        'Config/cloudflare-app.json and Config/coolify-app.json record no access.exposureClass, so whether this app is public is undecided',
      ),
      check(
        '3.2',
        'has a login: narduk-auth',
        STATUS_UNKNOWN,
        'Config/cloudflare-app.json and Config/coolify-app.json record no access.exposureClass, so whether this app has a login is undecided',
      ),
    ]
  }
  const isAuthenticated = exposureClass === 'authenticated-public' || exposureClass === 'private'
  const publicCheck: FoundationSubCheck = isAuthenticated
    ? check(
        '3.1',
        'public site: narduk-seo + narduk-analytics',
        STATUS_NA,
        `access.exposureClass is ${JSON.stringify(exposureClass)}; not a public-indexed site`,
      )
    : check(
        '3.1',
        'public site: narduk-seo + narduk-analytics',
        hasSeo && hasAnalytics ? STATUS_PASS : STATUS_FAIL,
        hasSeo && hasAnalytics
          ? 'narduk-seo and narduk-analytics are both dependencies'
          : `access.exposureClass is ${JSON.stringify(exposureClass)} (public); missing ${JSON.stringify(
              [
                !hasSeo && '@narduk-enterprises/narduk-seo',
                !hasAnalytics && '@narduk-enterprises/narduk-analytics',
              ].filter(Boolean),
            )}`,
      )
  const loginCheck: FoundationSubCheck = isAuthenticated
    ? check(
        '3.2',
        'has a login: narduk-auth',
        hasAuth ? STATUS_PASS : STATUS_FAIL,
        hasAuth
          ? 'narduk-auth is a dependency'
          : `access.exposureClass is ${JSON.stringify(exposureClass)} (authenticated); @narduk-enterprises/narduk-auth is not a dependency`,
      )
    : check(
        '3.2',
        'has a login: narduk-auth',
        STATUS_NA,
        `access.exposureClass is ${JSON.stringify(exposureClass)}; no login boundary declared`,
      )
  return [publicCheck, loginCheck]
}

const R2_CHECK_NAME = 'writes R2: narduk-uploads'
const SERVER_SCAN_DIRS = ['server', 'apps/web/server'] as const

/**
 * A read-only bucket must not be written (narduk-libs#1285): returns the first
 * server file that calls `<BINDING>.put(` or `<BINDING>.delete(` on one of the
 * given binding names, so the role cannot hide a writer.
 */
function findR2Writer(
  repo: AppRepo,
  bindings: readonly string[],
): { binding: string; file: string } | null {
  if (bindings.length === 0) return null
  const escaped = bindings.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const writeRe = new RegExp(`\\b(${escaped.join('|')})\\s*\\??\\.\\s*(?:put|delete)\\s*\\(`)
  let scanned = 0
  for (const dir of SERVER_SCAN_DIRS) {
    for (const rel of repo.walk(dir, ['.ts', '.mts', '.js', '.mjs'])) {
      if (scanned >= SOURCE_SCAN_FILE_LIMIT) return null
      scanned += 1
      const match = writeRe.exec(repo.read(rel) ?? '')
      if (match) return { binding: match[1]!, file: rel }
    }
  }
  return null
}

function evaluate33(repo: AppRepo, merged: Record<string, string>): FoundationSubCheck {
  const hasUploads = '@narduk-enterprises/narduk-uploads' in merged
  const buckets = manifestR2Buckets(readCloudflareApp(repo))
  const label = (bucket: ManifestR2Bucket) => bucket.binding ?? '(unnamed binding)'
  let evidence = 'Config/cloudflare-app.json bindings.r2'
  // An unrecognised role is rejected by `manifests validate`; here it counts as
  // an upload bucket, so a typo can never turn 3.3 off.
  let uploadBuckets = buckets.filter(
    (bucket) => bucket.role === 'uploads' || !isR2BucketRole(bucket.role),
  )
  let writesR2 = buckets.length > 0
  if (!writesR2) {
    const wranglerRel = findWranglerConfig(repo)
    if (wranglerRel) {
      const names = bindingNames(repo, wranglerRel)
      const cfg = repo.read(wranglerRel)
      // r2_buckets is a distinct key from the generic binding-name set; check
      // the raw config text for the key's presence with at least one entry. The
      // wrangler config carries no role, so such a bucket counts as uploads.
      writesR2 = names.size > 0 && !!cfg && /"r2_buckets"\s*:\s*\[\s*\{/.test(cfg)
      evidence = wranglerRel
      uploadBuckets = writesR2 ? [{ binding: null, role: 'uploads', defaulted: true }] : []
    }
  }
  if (!writesR2) {
    return check(
      '3.3',
      R2_CHECK_NAME,
      STATUS_NA,
      'no r2 binding declared in Config/cloudflare-app.json or the wrangler config',
    )
  }
  const readOnly = buckets.filter((bucket) => bucket.role === 'read-only-assets' && bucket.binding)
  const writer = findR2Writer(
    repo,
    readOnly.map((bucket) => bucket.binding!),
  )
  if (writer) {
    return check(
      '3.3',
      R2_CHECK_NAME,
      STATUS_FAIL,
      `R2 binding ${writer.binding} is declared role "read-only-assets" but ${writer.file} calls .put( or .delete( on it`,
      writer.file,
    )
  }
  if (uploadBuckets.length === 0) {
    return check(
      '3.3',
      R2_CHECK_NAME,
      STATUS_NA,
      `every declared R2 bucket has a role other than "uploads" (${buckets.map((bucket) => `${label(bucket)}: ${bucket.role}`).join(', ')}); narduk-uploads serves user uploads only`,
      evidence,
    )
  }
  const named = uploadBuckets.filter((bucket) => bucket.binding !== null).map(label)
  const which =
    named.length > 0 ? ` (${named.join(', ')}: role "uploads", declared or defaulted)` : ''
  return check(
    '3.3',
    R2_CHECK_NAME,
    hasUploads ? STATUS_PASS : STATUS_FAIL,
    hasUploads
      ? 'narduk-uploads is a dependency and an R2 binding is declared'
      : `an R2 binding is declared${which} but narduk-uploads is not a dependency; give a bucket that is not user uploads a role in Config/cloudflare-app.json bindings.r2[].role (read-only-assets, archive or app-data)`,
    evidence,
  )
}

function evaluate34(): FoundationSubCheck {
  // Preserve the artifact ID; product branding no longer creates a capability.
  // company-hq D-WEBFOUND-2 amendment, 2026-09-16.
  return check(
    '3.4',
    'retired status-app category',
    STATUS_NA,
    'status-app classification is retired; actual capabilities use the normal web-app checks, and status-runtime remains optional for legacy consumers',
  )
}

function evaluate35(repo: AppRepo, merged: Record<string, string>): FoundationSubCheck {
  const geoScoped = Object.keys(merged).filter((name) =>
    /^@narduk-geo\/(?:narduk-charts|narduk-mapkit)/.test(name),
  )
  if (geoScoped.length > 0) {
    return check(
      '3.5',
      'charts/maps: narduk-charts / narduk-mapkit under @narduk-enterprises',
      STATUS_FAIL,
      `depends on ${JSON.stringify(geoScoped)} -- charts/mapkit must be under @narduk-enterprises, never @narduk-geo`,
    )
  }
  // narduk-maps owns MapLibre: maplibre-gl is its optional peer, so an app on narduk-maps/gl
  // imports maplibre-gl itself (for setWorkerUrl) and that import is the package's own engine.
  const estatePackages = ESTATE_CHART_MAP_PACKAGES.filter((name) => name in merged)
  if (estatePackages.length > 0) {
    return check(
      '3.5',
      'charts/maps: narduk-charts / narduk-mapkit under @narduk-enterprises',
      STATUS_PASS,
      `depends on ${estatePackages.join(', ')}`,
    )
  }
  const evidence = scanSourceForPattern(repo, CHART_MAP_IMPORT_RE)
  if (!evidence) {
    return check(
      '3.5',
      'charts/maps: narduk-charts / narduk-mapkit under @narduk-enterprises',
      STATUS_NA,
      'no chart/map dependency and no chart/map library import found in the bounded source scan',
    )
  }
  return check(
    '3.5',
    'charts/maps: narduk-charts / narduk-mapkit under @narduk-enterprises',
    STATUS_FAIL,
    `${evidence} imports a chart/map library directly, with no @narduk-enterprises/narduk-charts, narduk-mapkit or narduk-maps dependency`,
    evidence,
  )
}

/**
 * narduk-seo, narduk-analytics, narduk-auth and narduk-uploads are Nuxt
 * modules. In an app with no Nuxt they can never be registered, so 3.1-3.3 are
 * not-applicable there, with the reason, never pass (narduk-libs#157, Logan
 * 2026-09-25: "Not-applicable (Recommended)").
 */
function nonNuxtCapabilityChecks(nuxt: NuxtPresence): FoundationSubCheck[] {
  const reason = (pkgs: string, plural: boolean) =>
    `not a Nuxt app (${nuxt.evidence}); ${pkgs} ${plural ? 'are Nuxt modules' : 'is a Nuxt module'} this app cannot register`
  return [
    check(
      '3.1',
      'public site: narduk-seo + narduk-analytics',
      STATUS_NA,
      reason('narduk-seo and narduk-analytics', true),
    ),
    check('3.2', 'has a login: narduk-auth', STATUS_NA, reason('narduk-auth', false)),
    check('3.3', R2_CHECK_NAME, STATUS_NA, reason('narduk-uploads', false)),
  ]
}

export function evaluateItem3(repo: AppRepo): FoundationSubCheck[] {
  const packages = collectPackages(repo)
  const merged = mergedDeps(packages)
  const nuxt = detectNuxt(repo)
  if (!nuxt.nuxt) {
    return [...nonNuxtCapabilityChecks(nuxt), evaluate34(), evaluate35(repo, merged)]
  }
  const exposureClass = readCloudflareAppExposureClass(repo)
  return [
    ...evaluate31And32(repo, exposureClass, merged),
    evaluate33(repo, merged),
    evaluate34(),
    evaluate35(repo, merged),
  ]
}
