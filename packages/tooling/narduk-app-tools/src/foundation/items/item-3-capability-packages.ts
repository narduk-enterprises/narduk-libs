/**
 * Item 3 -- capability packages (spec §3 item 3).
 *
 * Spec §3: "Applicability is a property of the running app, not of its
 * manifests, so the rollup's static half reports item 3 `unknown` in full and
 * `foundation:check` owns it." This tool has the whole checkout, so it reads
 * the same in-app signal item 1.4 already uses --
 * `Config/cloudflare-app.json` `access.exposureClass` -- plus real bindings
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
  isRecord,
  mergedDeps,
  collectPackages,
  type AppRepo,
} from '../source.js'
import { readCloudflareApp, readCloudflareAppExposureClass } from './item-1-scaffold-parity.js'
import {
  STATUS_FAIL,
  STATUS_NA,
  STATUS_PASS,
  STATUS_UNKNOWN,
  type FoundationSubCheck,
} from '../types.js'

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
        'Config/cloudflare-app.json records no access.exposureClass, so whether this app is public is undecided',
      ),
      check(
        '3.2',
        'has a login: narduk-auth',
        STATUS_UNKNOWN,
        'Config/cloudflare-app.json records no access.exposureClass, so whether this app has a login is undecided',
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

function evaluate33(repo: AppRepo, merged: Record<string, string>): FoundationSubCheck {
  const hasUploads = '@narduk-enterprises/narduk-uploads' in merged
  const cfApp = readCloudflareApp(repo)
  const declaredR2 =
    isRecord(cfApp?.bindings) && Array.isArray((cfApp!.bindings as Record<string, unknown>).r2)
      ? ((cfApp!.bindings as Record<string, unknown>).r2 as unknown[])
      : []
  let writesR2 = declaredR2.length > 0
  let evidence = 'Config/cloudflare-app.json bindings.r2'
  if (!writesR2) {
    const wranglerRel = findWranglerConfig(repo)
    if (wranglerRel) {
      const names = bindingNames(repo, wranglerRel)
      const cfg = repo.read(wranglerRel)
      // r2_buckets is a distinct key from the generic binding-name set; check
      // the raw config text for the key's presence with at least one entry.
      writesR2 = names.size > 0 && !!cfg && /"r2_buckets"\s*:\s*\[\s*\{/.test(cfg)
      evidence = wranglerRel
    }
  }
  if (!writesR2) {
    return check(
      '3.3',
      'writes R2: narduk-uploads',
      STATUS_NA,
      'no r2 binding declared in Config/cloudflare-app.json or the wrangler config',
    )
  }
  return check(
    '3.3',
    'writes R2: narduk-uploads',
    hasUploads ? STATUS_PASS : STATUS_FAIL,
    hasUploads
      ? 'narduk-uploads is a dependency and an R2 binding is declared'
      : 'an R2 binding is declared but narduk-uploads is not a dependency',
    evidence,
  )
}

function evaluate34(repo: AppRepo, merged: Record<string, string>): FoundationSubCheck {
  const cfApp = readCloudflareApp(repo)
  const productName = isRecord(cfApp?.product)
    ? String((cfApp!.product as Record<string, unknown>).name ?? '')
    : ''
  const looksLikeStatusApp =
    /status/i.test(productName) || /status/i.test(repo.read('package.json') ?? '')
  if (!looksLikeStatusApp) {
    return check(
      '3.4',
      'status app: narduk-ui + status-runtime',
      STATUS_NA,
      'nothing in product.name or package.json name suggests this is a status app',
    )
  }
  const hasUi = '@narduk-enterprises/narduk-ui' in merged
  const hasStatusRuntime =
    'status-runtime' in merged || '@narduk-enterprises/status-runtime' in merged
  return check(
    '3.4',
    'status app: narduk-ui + status-runtime',
    hasUi && hasStatusRuntime ? STATUS_PASS : STATUS_FAIL,
    hasUi && hasStatusRuntime
      ? 'narduk-ui and status-runtime are both dependencies'
      : `looks like a status app (product.name/package name); missing ${JSON.stringify(
          [!hasUi && '@narduk-enterprises/narduk-ui', !hasStatusRuntime && 'status-runtime'].filter(
            Boolean,
          ),
        )}`,
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
  const hasEstateChartsOrMaps =
    '@narduk-enterprises/narduk-charts' in merged || '@narduk-enterprises/narduk-mapkit' in merged
  if (hasEstateChartsOrMaps) {
    return check(
      '3.5',
      'charts/maps: narduk-charts / narduk-mapkit under @narduk-enterprises',
      STATUS_PASS,
      'depends on an @narduk-enterprises charts/mapkit package',
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
    `${evidence} imports a chart/map library directly, with no @narduk-enterprises/narduk-charts or narduk-mapkit dependency`,
    evidence,
  )
}

export function evaluateItem3(repo: AppRepo): FoundationSubCheck[] {
  const packages = collectPackages(repo)
  const merged = mergedDeps(packages)
  const exposureClass = readCloudflareAppExposureClass(repo)
  return [
    ...evaluate31And32(repo, exposureClass, merged),
    evaluate33(repo, merged),
    evaluate34(repo, merged),
    evaluate35(repo, merged),
  ]
}
