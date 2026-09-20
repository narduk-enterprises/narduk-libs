/**
 * Item 1 -- scaffold parity (spec §3 item 1, `[decided]` -- paved-paths web-cf).
 *
 * Sub-checks 1.2-1.4 mirror `check-web-foundation.py`'s static evaluator
 * exactly (same file candidates, same binding/flag rules) so the two never
 * disagree on a manifest-only question. Sub-check 1.1 is the one this tool
 * OWNS per spec §3: "Absent ⇒ unknown in the static evaluator;
 * `foundation:check` resolves the config for real and must decide it."
 */

import { check } from '../schema.js'
import {
  bindingNames,
  findWranglerConfig,
  isRecord,
  NITRO_OUTPUT_CANDIDATES,
  NUXT_CONFIG_CANDIDATES,
  parseJson,
  type AppRepo,
  collectPackages,
  wranglerScopes,
} from '../source.js'
import {
  STATUS_FAIL,
  STATUS_NA,
  STATUS_PASS,
  STATUS_UNKNOWN,
  type FoundationSubCheck,
} from '../types.js'

/** Resolve the REAL Nitro preset when no `Config/cloudflare-app.json` exists
 * to declare one. Three real signals, strongest first:
 *  1. A build already ran: `.output/nitro.json`'s own `preset` field is the
 *     preset Nitro actually used, no inference needed.
 *  2. `nuxt.config.*`'s `nitro.preset` literal, read from source. A regex
 *     scan rather than executing the config: `foundation:check` must not
 *     import arbitrary app code to answer a conformance question.
 *  3. A `NITRO_PRESET` environment variable, which Nitro itself honours as an
 *     override at build time.
 * Anything else is genuinely undecidable from a checkout that hasn't built. */
function resolveNitroPresetForReal(repo: AppRepo): { preset: string | null; evidence: string } {
  for (const rel of NITRO_OUTPUT_CANDIDATES) {
    const text = repo.read(rel)
    const parsed = parseJson(text)
    if (isRecord(parsed) && typeof parsed.preset === 'string') {
      return { preset: parsed.preset, evidence: rel }
    }
  }
  for (const rel of NUXT_CONFIG_CANDIDATES) {
    const text = repo.read(rel)
    if (!text) continue
    const match = /nitro\s*:\s*\{[^}]*preset\s*:\s*['"]([\w-]+)['"]/.exec(text)
    if (match) return { preset: match[1], evidence: rel }
  }
  if (process.env.NITRO_PRESET) {
    return { preset: process.env.NITRO_PRESET, evidence: 'NITRO_PRESET environment variable' }
  }
  return {
    preset: null,
    evidence: 'no built .output/nitro.json, no nitro.preset in nuxt.config, no NITRO_PRESET env',
  }
}

/** Nitro treats `-` and `_` as the same separator in a preset name, and the
 * two spellings reach this check from different places: `nuxt.config`'s
 * literal and `Config/cloudflare-app.json` say `cloudflare_module`, while a
 * completed build writes the canonical `cloudflare-module` into
 * `.output/nitro.json`. Comparing the raw string therefore failed item 1.1 on
 * every app whose preset was resolved from its own build output -- exactly
 * the not-yet-onboarded case the live-build fallback exists to serve
 * (narduk-libs#350). */
function samePreset(preset: string, expected: string): boolean {
  return preset.replaceAll('-', '_') === expected.replaceAll('-', '_')
}

function evaluate11(repo: AppRepo, cfApp: unknown): FoundationSubCheck {
  let preset: string | null = null
  let evidence = 'Config/cloudflare-app.json'
  let resolvedForReal = false
  if (isRecord(cfApp) && isRecord(cfApp.worker) && typeof cfApp.worker.nitroPreset === 'string') {
    preset = cfApp.worker.nitroPreset
  } else {
    const resolved = resolveNitroPresetForReal(repo)
    preset = resolved.preset
    evidence = resolved.evidence
    resolvedForReal = true
  }
  if (preset !== null && samePreset(preset, 'cloudflare_module')) {
    return check(
      '1.1',
      'nitro preset is cloudflare_module',
      STATUS_PASS,
      resolvedForReal
        ? `resolved for real from ${evidence} as ${JSON.stringify(preset)} (no Config/cloudflare-app.json)`
        : `Config/cloudflare-app.json worker.nitroPreset == ${JSON.stringify(preset)}`,
      evidence,
    )
  }
  if (typeof preset === 'string') {
    return check(
      '1.1',
      'nitro preset is cloudflare_module',
      STATUS_FAIL,
      `resolved preset is ${JSON.stringify(preset)}, not "cloudflare_module" (from ${evidence}); ` +
        'the comparison already treats "-" and "_" as the same separator',
      evidence,
    )
  }
  return check(
    '1.1',
    'nitro preset is cloudflare_module',
    STATUS_UNKNOWN,
    `no Config/cloudflare-app.json and the preset could not be resolved for real: ${evidence}`,
  )
}

function evaluate12(repo: AppRepo, cfApp: unknown, wranglerRel: string | null): FoundationSubCheck {
  if (!wranglerRel) {
    return check(
      '1.2',
      'bindings mirrored in Config/cloudflare-app.json',
      STATUS_UNKNOWN,
      'no wrangler config found at a known path',
    )
  }
  if (!isRecord(cfApp)) {
    return check(
      '1.2',
      'bindings mirrored in Config/cloudflare-app.json',
      STATUS_FAIL,
      `${wranglerRel} exists but Config/cloudflare-app.json does not`,
      wranglerRel,
    )
  }
  const declared = bindingNames(repo, wranglerRel)
  const mirror = JSON.stringify(cfApp)
  const missing = [...declared].filter((name) => !mirror.includes(JSON.stringify(name))).sort()
  if (declared.size === 0) {
    return check(
      '1.2',
      'bindings mirrored in Config/cloudflare-app.json',
      STATUS_NA,
      `${wranglerRel} declares no bindings`,
      wranglerRel,
    )
  }
  if (missing.length > 0) {
    return check(
      '1.2',
      'bindings mirrored in Config/cloudflare-app.json',
      STATUS_FAIL,
      `${missing.length} binding(s) in ${wranglerRel} appear nowhere in Config/cloudflare-app.json: ${JSON.stringify(missing)}`,
      wranglerRel,
    )
  }
  return check(
    '1.2',
    'bindings mirrored in Config/cloudflare-app.json',
    STATUS_PASS,
    `all ${declared.size} binding name(s) in ${wranglerRel} are mirrored`,
    wranglerRel,
  )
}

function evaluate13(repo: AppRepo): FoundationSubCheck {
  const packages = collectPackages(repo)
  if (packages.length === 0) {
    return check(
      '1.3',
      'manifests:validate script present',
      STATUS_UNKNOWN,
      'no package.json readable at a known path',
    )
  }
  const hasValidate = packages.some(
    (p) => isRecord(p.pkg.scripts) && typeof p.pkg.scripts['manifests:validate'] === 'string',
  )
  return hasValidate
    ? check(
        '1.3',
        'manifests:validate script present',
        STATUS_PASS,
        'package.json declares a manifests:validate script',
        packages[0].rel,
      )
    : check(
        '1.3',
        'manifests:validate script present',
        STATUS_FAIL,
        'no package.json in this app declares a manifests:validate script',
        packages[0].rel,
      )
}

function evaluate14(
  repo: AppRepo,
  exposureClass: string | null,
  wranglerRel: string | null,
): FoundationSubCheck {
  if (exposureClass === null) {
    return check(
      '1.4',
      'access hardening on authenticated-public apps',
      STATUS_UNKNOWN,
      'Config/cloudflare-app.json records no access.exposureClass, so applicability is undecided',
    )
  }
  if (exposureClass !== 'authenticated-public') {
    return check(
      '1.4',
      'access hardening on authenticated-public apps',
      STATUS_NA,
      `access.exposureClass is ${JSON.stringify(exposureClass)}; the two flags apply to authenticated-public apps only`,
    )
  }
  if (!wranglerRel || wranglerRel.endsWith('.toml')) {
    return check(
      '1.4',
      'access hardening on authenticated-public apps',
      STATUS_UNKNOWN,
      'no JSON wrangler config to read the flags from',
    )
  }
  const offenders: string[] = []
  const cfg = parseJson(repo.read(wranglerRel))
  for (const [prefix, scope] of wranglerScopes(cfg)) {
    for (const flag of ['workers_dev', 'preview_urls']) {
      const value = scope[flag]
      if (value !== false)
        offenders.push(`${wranglerRel}:${prefix}${flag}=${JSON.stringify(value)}`)
    }
  }
  if (offenders.length > 0) {
    return check(
      '1.4',
      'access hardening on authenticated-public apps',
      STATUS_FAIL,
      `an authenticated-public app sets workers_dev: false and preview_urls: false on every environment; not satisfied at ${offenders.sort().join(', ')}`,
      wranglerRel,
    )
  }
  return check(
    '1.4',
    'access hardening on authenticated-public apps',
    STATUS_PASS,
    'workers_dev and preview_urls are false on every environment',
    wranglerRel,
  )
}

export function evaluateItem1(repo: AppRepo): FoundationSubCheck[] {
  const cfApp = parseJson(repo.read('Config/cloudflare-app.json'))
  const wranglerRel = findWranglerConfig(repo)
  const exposureClass =
    isRecord(cfApp) && isRecord(cfApp.access) && typeof cfApp.access.exposureClass === 'string'
      ? cfApp.access.exposureClass
      : null
  return [
    evaluate11(repo, cfApp),
    evaluate12(repo, cfApp, wranglerRel),
    evaluate13(repo),
    evaluate14(repo, exposureClass, wranglerRel),
  ]
}

// re-exported so item-3 can reuse the same real signal without re-parsing.
export function readCloudflareAppExposureClass(repo: AppRepo): string | null {
  const cfApp = parseJson(repo.read('Config/cloudflare-app.json'))
  return isRecord(cfApp) && isRecord(cfApp.access) && typeof cfApp.access.exposureClass === 'string'
    ? cfApp.access.exposureClass
    : null
}

export function readCloudflareApp(repo: AppRepo): Record<string, unknown> | null {
  const cfApp = parseJson(repo.read('Config/cloudflare-app.json'))
  return isRecord(cfApp) ? cfApp : null
}
