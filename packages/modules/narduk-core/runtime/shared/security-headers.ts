/**
 * The shared `security.headers` preset: estate defaults for a strict,
 * nonce-based Content-Security-Policy plus the rest of the standard response
 * header set (company-hq#745, D-ORG-1 (g)).
 *
 * WHY THIS IS A WRAPPER, NOT A NEW IMPLEMENTATION
 * -----------------------------------------------
 * The estate rule is "no roll-your-own when a maintained package exists".
 * `nuxt-security` (MIT, 2.6.0, 2026-05-12) is maintained, targets Nuxt 4
 * (`@nuxt/kit ^4.2.1`), and its runtime code imports no Node builtin at all --
 * it uses `crypto.subtle`, `crypto.getRandomValues`, `btoa` and `TextEncoder`,
 * all of which workerd provides. So narduk-core installs it and supplies the
 * estate defaults, and this module is the pure function that computes those
 * defaults. Everything here is deliberately free of Nuxt and h3 imports so the
 * policy can be unit-tested without booting anything.
 *
 * WHY THE PRESET IS ADDITIVE RATHER THAN A REPLACEMENT
 * ----------------------------------------------------
 * narduk-core has shipped `runtime/server/middleware/securityHeaders.ts` for a
 * long time, and `addServerScanDir` registers it for every app that takes the
 * module's default `server: true`. Production Buoys was serving an ENFORCING
 * CSP, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` and
 * `X-Content-Type-Options` before a line of this was written (verified live on
 * 2026-09-17). That policy's weakness is that its `script-src` carries
 * `'unsafe-inline' 'unsafe-eval'`, which is close to decorative against an
 * injected inline script -- not that it is absent.
 *
 * So a literal "start in report-only" would DOWNGRADE a live enforcing policy,
 * and a literal "opt-in" would remove headers every fleet app already has.
 * Instead the two policies coexist during the soak:
 *
 *   mode 'off'          the legacy middleware alone, byte-for-byte as before.
 *                       This is the default, so upgrading narduk-core changes
 *                       no app's headers.
 *   mode 'report-only'  the legacy enforcing CSP keeps being served, and the
 *                       strict nonce policy is served BESIDE it as
 *                       `Content-Security-Policy-Report-Only`. A browser
 *                       enforces the first and only reports on the second, so
 *                       the soak cannot break a page.
 *   mode 'enforce'      the strict nonce policy becomes the enforcing
 *                       `Content-Security-Policy` and the legacy one is
 *                       retired. Two enforcing CSP headers would be
 *                       intersected by the browser, which is both confusing to
 *                       debug and pointless once the strict policy is proven.
 *
 * In the two `on` modes nuxt-security also takes ownership of the non-CSP
 * headers, so the legacy middleware stops emitting its copies and keeps only
 * the `X-App-Version` / `X-Build-Version` / `X-Build-Time` diagnostics, which
 * nuxt-security knows nothing about.
 */

/** Which CSP the strict policy is served as, and whether it is served at all. */
export type SecurityHeadersMode = 'off' | 'report-only' | 'enforce'

/** The directives an app may extend. Keys are the CSP directive minus `-src`. */
export interface SecurityHeadersAllowlist {
  connect?: readonly string[]
  font?: readonly string[]
  frame?: readonly string[]
  img?: readonly string[]
  media?: readonly string[]
  script?: readonly string[]
  style?: readonly string[]
  worker?: readonly string[]
}

export interface SecurityHeadersHstsOptions {
  includeSubdomains?: boolean
  /** Seconds. Default 15552000 (180 days) -- long enough to matter, short
   * enough that a mistake ages out inside two quarters. */
  maxAge?: number
  /** Submitting to the preload list is irreversible for practical purposes,
   * so it is never defaulted on. */
  preload?: boolean
}

export interface SecurityHeadersOptions {
  /** Extra origins per directive, merged onto the estate baseline. */
  allow?: SecurityHeadersAllowlist
  /** Serve the strict nonce policy. Off by default: an upgrade must not change
   * an app's headers without the app asking for it. */
  enabled?: boolean
  /** Promote the strict policy from report-only to enforcing, and retire the
   * legacy CSP. Only meaningful with `enabled`. */
  enforce?: boolean
  /** Who may frame this app. Default `["'none'"]`. */
  frameAncestors?: readonly string[]
  hsts?: SecurityHeadersHstsOptions | false
  /** Merged onto the baseline; a `false` value drops a baseline directive. */
  permissionsPolicy?: Record<string, readonly string[] | string | false>
  referrerPolicy?: string
  /** Where violations are POSTed. `false` serves no report route and emits no
   * `report-uri`. */
  reportRoute?: string | false
  /**
   * Keep `'strict-dynamic'` in `script-src`. Default true, because it is what
   * makes a nonce policy actually strong: a script the page's own nonced code
   * creates is trusted, and a host allowlist cannot be abused through an open
   * redirect or a JSONP endpoint on an allowed CDN.
   *
   * The cost is that a conforming browser then IGNORES every host in
   * `script-src`, including `'self'`. That matters for scripts injected into
   * the HTML after Nitro has responded and so never see a nonce -- Cloudflare's
   * Web Analytics beacon, injected by the edge HTML rewriter, is the one the
   * estate actually hits. An app that needs those and cannot nonce them sets
   * this to false and falls back to host allowlisting; the report-only soak is
   * where that decision gets made from evidence rather than from guessing.
   */
  strictDynamic?: boolean
}

export interface ResolvedSecurityHeaders {
  csp: Record<string, string[] | string | boolean>
  frameAncestors: string[]
  hsts: Required<SecurityHeadersHstsOptions> | false
  mode: SecurityHeadersMode
  permissionsPolicy: Record<string, readonly string[] | string | false>
  referrerPolicy: string
  reportRoute: string | false
  strictDynamic: boolean
}

export const DEFAULT_REPORT_ROUTE = '/api/_security/csp-report'
export const DEFAULT_HSTS_MAX_AGE = 15_552_000

/**
 * Third-party origins the estate's own shared modules load, so an app that
 * installs narduk-analytics or narduk-mapkit does not have to restate them.
 *
 * This is deliberately narrower than the legacy middleware's baseline. The
 * legacy list was written for an `'unsafe-inline'` policy where an extra host
 * changed little; under a nonce policy every entry here is real attack
 * surface, so an origin earns its place by being loaded by a shared module.
 * App-specific hosts -- tile servers, data APIs, icon CDNs -- belong in the
 * app's own `allow`, which is the whole point of the allowlist surface.
 */
export const BASELINE_ALLOWLIST: Required<SecurityHeadersAllowlist> = {
  // GTM and PostHog inject their own script tags; PostHog's asset host serves
  // the recorder and surveys bundles. Apple MapKit's loader is a script.
  script: [
    'https://*.googletagmanager.com',
    'https://us.i.posthog.com',
    'https://us-assets.i.posthog.com',
    'https://static.cloudflareinsights.com',
    'https://cdn.apple-mapkit.com',
  ],
  connect: [
    'https://*.google-analytics.com',
    'https://*.analytics.google.com',
    'https://*.googletagmanager.com',
    'https://us.i.posthog.com',
    'https://us-assets.i.posthog.com',
    'https://*.apple-mapkit.com',
    'https://*.apple.com',
  ],
  // MapKit serves raster tiles and the Nuxt image pipeline serves data: URIs.
  img: ['data:', 'https://*.apple-mapkit.com'],
  font: ['https://fonts.gstatic.com'],
  style: ['https://fonts.googleapis.com'],
  frame: [],
  // Map and chart libraries instantiate workers from blob: URLs.
  worker: ['blob:'],
  media: [],
}

export const BASELINE_PERMISSIONS_POLICY: Record<string, readonly string[] | string | false> = {
  camera: [],
  microphone: [],
  geolocation: [],
  payment: [],
  usb: [],
  'interest-cohort': [],
}

const DIRECTIVE_OF: Record<keyof SecurityHeadersAllowlist, string> = {
  connect: 'connect-src',
  font: 'font-src',
  frame: 'frame-src',
  img: 'img-src',
  media: 'media-src',
  script: 'script-src',
  style: 'style-src',
  worker: 'worker-src',
}

/** `'self'` plus, for the two directives that need it, the nonce placeholder
 * and the strict-dynamic / inline-style concessions explained below. */
function directiveSeed(
  key: keyof SecurityHeadersAllowlist,
  strictDynamic: boolean,
): readonly string[] {
  // `{{nonce}}` is nuxt-security's placeholder; its `50-updateCsp` plugin
  // substitutes the per-request nonce minted in `40-cspSsrNonce`.
  if (key === 'script') {
    return strictDynamic
      ? ["'self'", "'nonce-{{nonce}}'", "'strict-dynamic'"]
      : ["'self'", "'nonce-{{nonce}}'"]
  }
  // Vue's scoped-style runtime and @nuxt/ui both write style attributes and
  // inject <style> elements that a nonce cannot cover, because a nonce applies
  // to elements, never to `style="..."` attributes. `'unsafe-inline'` on
  // style-src is the accepted cost of a nonce policy on a Vue app; it does not
  // weaken script-src, which is where injection actually lands.
  if (key === 'style') return ["'self'", "'unsafe-inline'"]
  return ["'self'"]
}

function dedupe(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function sourcesFor(
  key: keyof SecurityHeadersAllowlist,
  allow: SecurityHeadersAllowlist | undefined,
  strictDynamic: boolean,
): string[] {
  return dedupe([
    ...directiveSeed(key, strictDynamic),
    ...BASELINE_ALLOWLIST[key],
    ...(allow?.[key] ?? []),
  ])
}

/**
 * Parse the legacy comma-separated `CSP_*_SRC` environment variables so an app
 * that configured its origins that way keeps them when it turns the preset on.
 * Dropping them silently would be the exact "fixed the library, broke the app"
 * failure the estate's library-first rule exists to prevent.
 */
export function parseLegacyCspSources(value: unknown): string[] {
  if (typeof value !== 'string') return []
  return value
    .split(',')
    .map((source) => source.trim())
    .filter(Boolean)
}

export interface LegacyCspEnvironment {
  cspConnectSrc?: unknown
  cspFrameSrc?: unknown
  cspMediaSrc?: unknown
  cspScriptSrc?: unknown
  cspWorkerSrc?: unknown
}

/** Fold the legacy env-var allowlist into the structured one. */
export function mergeLegacyAllowlist(
  allow: SecurityHeadersAllowlist | undefined,
  legacy: LegacyCspEnvironment,
): SecurityHeadersAllowlist {
  return {
    ...allow,
    connect: [...(allow?.connect ?? []), ...parseLegacyCspSources(legacy.cspConnectSrc)],
    frame: [...(allow?.frame ?? []), ...parseLegacyCspSources(legacy.cspFrameSrc)],
    media: [...(allow?.media ?? []), ...parseLegacyCspSources(legacy.cspMediaSrc)],
    script: [...(allow?.script ?? []), ...parseLegacyCspSources(legacy.cspScriptSrc)],
    worker: [...(allow?.worker ?? []), ...parseLegacyCspSources(legacy.cspWorkerSrc)],
  }
}

export function resolveSecurityHeadersMode(
  options: SecurityHeadersOptions | boolean | undefined,
): SecurityHeadersMode {
  if (options === true) return 'report-only'
  if (!options || !options.enabled) return 'off'
  return options.enforce ? 'enforce' : 'report-only'
}

function resolveHsts(
  hsts: SecurityHeadersHstsOptions | false | undefined,
): Required<SecurityHeadersHstsOptions> | false {
  if (hsts === false) return false
  return {
    maxAge: hsts?.maxAge ?? DEFAULT_HSTS_MAX_AGE,
    includeSubdomains: hsts?.includeSubdomains ?? true,
    preload: hsts?.preload ?? false,
  }
}

/**
 * Compute the whole resolved policy. `legacy` carries the app's existing
 * `CSP_*_SRC` values so they survive the switch.
 */
export function resolveSecurityHeaders(
  options: SecurityHeadersOptions | boolean | undefined,
  legacy: LegacyCspEnvironment = {},
): ResolvedSecurityHeaders {
  const mode = resolveSecurityHeadersMode(options)
  const settings: SecurityHeadersOptions = typeof options === 'object' && options ? options : {}
  const allow = mergeLegacyAllowlist(settings.allow, legacy)
  const frameAncestors = dedupe([...(settings.frameAncestors ?? ["'none'"])])
  const strictDynamic = settings.strictDynamic ?? true
  const reportRoute =
    settings.reportRoute === false ? false : (settings.reportRoute ?? DEFAULT_REPORT_ROUTE)

  const csp: Record<string, string[] | string | boolean> = {
    'default-src': ["'self'"],
    'base-uri': ["'self'"],
    'object-src': ["'none'"],
    // Neither directive was in the legacy policy. `form-action` is what stops
    // an injected <form> exfiltrating a session to an attacker's origin, and
    // an app that never posts cross-origin loses nothing by declaring it.
    'form-action': ["'self'"],
    'frame-ancestors': frameAncestors,
    'upgrade-insecure-requests': true,
  }
  for (const key of Object.keys(DIRECTIVE_OF) as Array<keyof SecurityHeadersAllowlist>) {
    csp[DIRECTIVE_OF[key]] = sourcesFor(key, allow, strictDynamic)
  }
  if (reportRoute) {
    // `report-uri` is deprecated but is the only form Safari implements, and
    // `report-to` needs a `Reporting-Endpoints` header Cloudflare already sets
    // for its own NEL group. Report-uri alone keeps this to one moving part.
    csp['report-uri'] = [reportRoute]
  }

  return {
    mode,
    csp,
    frameAncestors,
    hsts: resolveHsts(settings.hsts),
    permissionsPolicy: { ...BASELINE_PERMISSIONS_POLICY, ...(settings.permissionsPolicy ?? {}) },
    referrerPolicy: settings.referrerPolicy ?? 'strict-origin-when-cross-origin',
    reportRoute,
    strictDynamic,
  }
}

/**
 * The `nuxt-security` module options narduk-core installs it with.
 *
 * `contentSecurityPolicyReportOnly` is a SIBLING of `headers`, not one of
 * them: `dist/runtime/nitro/plugins/70-securityHeaders.js` reads it off the
 * resolved rules object and uses it only to pick the header NAME. Nesting it
 * under `headers` would make it an unknown header key that is stringified and
 * emitted, and the policy would silently stay enforcing.
 */
export interface NuxtSecurityPresetConfig {
  allowedMethodsRestricter: false
  // Every non-header capability nuxt-security ships is off. narduk-core owns
  // three of them already (`csrf.ts`, `cors.ts`, `rateLimit.ts`), and the rest
  // change request or build behaviour that nothing asked this preset for --
  // `removeLoggers` strips `console.*` from the production bundle and `sri`
  // adds integrity attributes, both defaulted ON upstream.
  basicAuth: false
  contentSecurityPolicyReportOnly: boolean
  corsHandler: false
  csrf: false
  enabled: true
  headers: Record<string, unknown>
  hidePoweredBy: false
  nonce: true
  rateLimiter: false
  removeLoggers: false
  requestSizeLimiter: false
  sri: false
  ssg: {
    exportToPresets: false
    hashScripts: false
    hashStyles: false
    meta: false
    nitroHeaders: false
  }
  xssValidator: false
}

export function buildNuxtSecurityConfig(
  resolved: ResolvedSecurityHeaders,
): NuxtSecurityPresetConfig {
  return {
    enabled: true,
    nonce: true,
    contentSecurityPolicyReportOnly: resolved.mode !== 'enforce',
    headers: {
      contentSecurityPolicy: resolved.csp,
      strictTransportSecurity: resolved.hsts === false ? false : resolved.hsts,
      referrerPolicy: resolved.referrerPolicy,
      permissionsPolicy: resolved.permissionsPolicy,
      xContentTypeOptions: 'nosniff',
      // `frame-ancestors` is the modern control; X-Frame-Options is the
      // fallback for a browser that predates it, and only DENY/SAMEORIGIN are
      // expressible, so an app allowing a specific framer gets no fallback.
      xFrameOptions: resolved.frameAncestors.includes("'none'")
        ? 'DENY'
        : resolved.frameAncestors.length === 1 && resolved.frameAncestors[0] === "'self'"
          ? 'SAMEORIGIN'
          : false,
      // An XSS auditor every current browser removed and that was itself
      // exploitable; `0` is the correct value, not absence of the header.
      xXSSProtection: '0',
      crossOriginOpenerPolicy: 'same-origin',
      crossOriginResourcePolicy: 'same-origin',
      // COEP would break every cross-origin image and script the allowlist
      // above deliberately permits, so it stays off.
      crossOriginEmbedderPolicy: false,
      originAgentCluster: false,
      xDNSPrefetchControl: false,
      xDownloadOptions: false,
      xPermittedCrossDomainPolicies: false,
    },
    basicAuth: false,
    csrf: false,
    corsHandler: false,
    rateLimiter: false,
    xssValidator: false,
    requestSizeLimiter: false,
    allowedMethodsRestricter: false,
    hidePoweredBy: false,
    removeLoggers: false,
    sri: false,
    ssg: {
      meta: false,
      hashScripts: false,
      hashStyles: false,
      nitroHeaders: false,
      exportToPresets: false,
    },
  }
}
