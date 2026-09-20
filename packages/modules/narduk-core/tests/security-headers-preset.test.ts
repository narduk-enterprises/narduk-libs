import { describe, expect, it } from 'vitest'

import {
  BASELINE_ALLOWLIST,
  buildNuxtSecurityConfig,
  DEFAULT_HSTS_MAX_AGE,
  DEFAULT_REPORT_ROUTE,
  mergeLegacyAllowlist,
  parseLegacyCspSources,
  resolveSecurityHeaders,
  resolveSecurityHeadersMode,
} from '../runtime/shared/security-headers'

function directive(name: string, options: Parameters<typeof resolveSecurityHeaders>[0] = true) {
  return resolveSecurityHeaders(options).csp[name] as string[]
}

describe('security.headers mode', () => {
  it('is off unless an app asks for it, so upgrading narduk-core changes no headers', () => {
    expect(resolveSecurityHeadersMode(undefined)).toBe('off')
    expect(resolveSecurityHeadersMode(false)).toBe('off')
    expect(resolveSecurityHeadersMode({})).toBe('off')
    expect(resolveSecurityHeadersMode({ enforce: true })).toBe('off')
  })

  it('soaks in report-only before it enforces', () => {
    expect(resolveSecurityHeadersMode(true)).toBe('report-only')
    expect(resolveSecurityHeadersMode({ enabled: true })).toBe('report-only')
    expect(resolveSecurityHeadersMode({ enabled: true, enforce: false })).toBe('report-only')
    expect(resolveSecurityHeadersMode({ enabled: true, enforce: true })).toBe('enforce')
  })
})

describe('strict policy', () => {
  it('carries the nonce placeholder and strict-dynamic on script-src', () => {
    expect(directive('script-src')).toContain("'nonce-{{nonce}}'")
    expect(directive('script-src')).toContain("'strict-dynamic'")
  })

  it('drops strict-dynamic on request, keeping the host allowlist meaningful', () => {
    const sources = directive('script-src', { enabled: true, strictDynamic: false })
    expect(sources).toContain("'nonce-{{nonce}}'")
    expect(sources).not.toContain("'strict-dynamic'")
    expect(sources).toContain('https://*.googletagmanager.com')
  })

  it('never allows unsafe-inline or unsafe-eval to execute script', () => {
    for (const strictDynamic of [true, false]) {
      const sources = directive('script-src', { enabled: true, strictDynamic })
      expect(sources).not.toContain("'unsafe-inline'")
      expect(sources).not.toContain("'unsafe-eval'")
    }
  })

  it('concedes unsafe-inline only on style-src, where a nonce cannot reach', () => {
    expect(directive('style-src')).toContain("'unsafe-inline'")
  })

  it('adds the form-action the legacy policy lacked', () => {
    const csp = resolveSecurityHeaders(true).csp
    expect(csp['form-action']).toEqual(["'self'"])
  })

  it('disables upgrade-insecure-requests in report-only and keeps it when enforcing', () => {
    const reportOnly = resolveSecurityHeaders({ enabled: true })
    const reportOnlyHeaders = buildNuxtSecurityConfig(reportOnly).headers
      .contentSecurityPolicy as Record<string, unknown>
    expect(reportOnly.mode).toBe('report-only')
    // Explicitly `false`, never absent: nuxt-security's default CSP turns this
    // directive on, and defu only overrides keys we actually declare. The
    // report-only merge in `nuxt-security-contract.test.ts` is what proves the
    // distinction end to end -- this assertion alone cannot see the default.
    expect(Object.hasOwn(reportOnly.csp, 'upgrade-insecure-requests')).toBe(true)
    expect(reportOnly.csp['upgrade-insecure-requests']).toBe(false)
    expect(reportOnlyHeaders['upgrade-insecure-requests']).toBe(false)

    const enforced = resolveSecurityHeaders({ enabled: true, enforce: true })
    const enforcedHeaders = buildNuxtSecurityConfig(enforced).headers
      .contentSecurityPolicy as Record<string, unknown>
    expect(enforced.mode).toBe('enforce')
    expect(enforced.csp['upgrade-insecure-requests']).toBe(true)
    expect(enforcedHeaders['upgrade-insecure-requests']).toBe(true)
  })

  it('defaults frame-ancestors to none and mirrors it into X-Frame-Options', () => {
    expect(directive('frame-ancestors')).toEqual(["'none'"])
    expect(buildNuxtSecurityConfig(resolveSecurityHeaders(true)).headers.xFrameOptions).toBe('DENY')
  })

  it('downgrades X-Frame-Options to SAMEORIGIN for a self-framing app', () => {
    const resolved = resolveSecurityHeaders({ enabled: true, frameAncestors: ["'self'"] })
    expect(buildNuxtSecurityConfig(resolved).headers.xFrameOptions).toBe('SAMEORIGIN')
  })

  it('omits X-Frame-Options when frame-ancestors names a specific origin it cannot express', () => {
    const resolved = resolveSecurityHeaders({
      enabled: true,
      frameAncestors: ['https://partner.example'],
    })
    expect(buildNuxtSecurityConfig(resolved).headers.xFrameOptions).toBe(false)
    expect(resolved.csp['frame-ancestors']).toEqual(['https://partner.example'])
  })
})

describe('allowlist surface', () => {
  it('merges app origins onto the estate baseline for every directive', () => {
    const resolved = resolveSecurityHeaders({
      enabled: true,
      allow: {
        connect: ['https://api.iconify.design'],
        font: ['https://fonts.example'],
        frame: ['https://embed.example'],
        img: ['https://tiles.example'],
        media: ['https://media.example'],
        script: ['https://p.nard.uk'],
        style: ['https://styles.example'],
        worker: ['https://worker.example'],
      },
    })
    expect(resolved.csp['connect-src']).toContain('https://api.iconify.design')
    expect(resolved.csp['font-src']).toContain('https://fonts.example')
    expect(resolved.csp['frame-src']).toContain('https://embed.example')
    expect(resolved.csp['img-src']).toContain('https://tiles.example')
    expect(resolved.csp['media-src']).toContain('https://media.example')
    expect(resolved.csp['script-src']).toContain('https://p.nard.uk')
    expect(resolved.csp['style-src']).toContain('https://styles.example')
    expect(resolved.csp['worker-src']).toContain('https://worker.example')
  })

  it("keeps each directive anchored to 'self' and the shared-module baseline", () => {
    const resolved = resolveSecurityHeaders({
      enabled: true,
      allow: { img: ['https://a.example'] },
    })
    expect(resolved.csp['img-src']).toEqual([
      "'self'",
      ...BASELINE_ALLOWLIST.img,
      'https://a.example',
    ])
  })

  it('does not inherit the legacy img-src https: wildcard', () => {
    expect(directive('img-src')).not.toContain('https:')
  })

  it('de-duplicates and trims, so a repeated origin appears once', () => {
    const resolved = resolveSecurityHeaders({
      enabled: true,
      allow: {
        connect: ['  https://us.i.posthog.com  ', 'https://x.example', 'https://x.example'],
      },
    })
    const connect = resolved.csp['connect-src'] as string[]
    expect(connect.filter((source) => source === 'https://us.i.posthog.com')).toHaveLength(1)
    expect(connect.filter((source) => source === 'https://x.example')).toHaveLength(1)
  })
})

describe("baseline: 'self' (issue #560)", () => {
  // An app that reaches no third party could not previously enforce the strict
  // nonce policy without WIDENING its CSP, because `allow` only adds to the
  // estate baseline. operator-portal is the consumer: taking 'unsafe-inline'
  // off script-src would have cost it eight third-party origins on
  // connect-src, which is the directive that governs exfiltration.

  it("defaults to the estate baseline, so an upgrade narrows nobody's policy", () => {
    expect(resolveSecurityHeaders({ enabled: true }).baseline).toBe('estate')
    expect(resolveSecurityHeaders(true).baseline).toBe('estate')
    expect(directive('connect-src')).toEqual(
      expect.arrayContaining([...BASELINE_ALLOWLIST.connect]),
    )
  })

  it("admits no third-party origin on any directive when set to 'self'", () => {
    const resolved = resolveSecurityHeaders({ enabled: true, baseline: 'self' })
    expect(resolved.baseline).toBe('self')
    for (const [key, directiveName] of [
      ['connect', 'connect-src'],
      ['font', 'font-src'],
      ['frame', 'frame-src'],
      ['img', 'img-src'],
      ['media', 'media-src'],
      ['script', 'script-src'],
      ['style', 'style-src'],
      ['worker', 'worker-src'],
    ] as const) {
      const sources = resolved.csp[directiveName] as string[]
      for (const origin of BASELINE_ALLOWLIST[key]) {
        expect(sources, `${directiveName} must not inherit ${origin}`).not.toContain(origin)
      }
    }
  })

  it('drops the scheme sources too, which is the part an adopter trips over', () => {
    // BASELINE_ALLOWLIST is not purely third-party hosts: img carries `data:`
    // (the Nuxt image pipeline) and worker carries `blob:` (map and chart
    // libraries). 'self' inherits nothing, so these go with the hosts. Pinned
    // because an app that flips `enforce` without noticing loses working
    // images or workers at runtime, not at build time.
    const resolved = resolveSecurityHeaders({ enabled: true, baseline: 'self' })
    expect(resolved.csp['img-src']).not.toContain('data:')
    expect(resolved.csp['worker-src']).not.toContain('blob:')

    const named = resolveSecurityHeaders({
      enabled: true,
      baseline: 'self',
      allow: { img: ['data:'], worker: ['blob:'] },
    })
    expect(named.csp['img-src']).toEqual(["'self'", 'data:'])
    expect(named.csp['worker-src']).toEqual(["'self'", 'blob:'])
  })

  it("reduces each directive to 'self' plus the app's own allow", () => {
    const resolved = resolveSecurityHeaders({
      enabled: true,
      baseline: 'self',
      allow: { connect: ['https://api.nard.uk'] },
    })
    expect(resolved.csp['connect-src']).toEqual(["'self'", 'https://api.nard.uk'])
    expect(resolved.csp['img-src']).toEqual(["'self'"])
    expect(resolved.csp['font-src']).toEqual(["'self'"])
  })

  it('keeps every concession the nonce policy depends on', () => {
    const resolved = resolveSecurityHeaders({ enabled: true, baseline: 'self' })
    const script = resolved.csp['script-src'] as string[]
    expect(script).toEqual(["'self'", "'nonce-{{nonce}}'", "'strict-dynamic'"])
    // style-src's unsafe-inline is Vue's scoped-style runtime, not a baseline
    // origin, so dropping the baseline must not drop it.
    expect(resolved.csp['style-src']).toEqual(["'self'", "'unsafe-inline'"])
    expect(resolved.csp['object-src']).toEqual(["'none'"])
    expect(resolved.csp['frame-ancestors']).toEqual(["'none'"])
    expect(resolved.csp['form-action']).toEqual(["'self'"])
  })

  it("still honours an app's legacy CSP_*_SRC values, which are its own, not the estate's", () => {
    const resolved = resolveSecurityHeaders(
      { enabled: true, baseline: 'self' },
      { cspConnectSrc: 'https://legacy.example' },
    )
    expect(resolved.csp['connect-src']).toEqual(["'self'", 'https://legacy.example'])
  })

  it('is the strictly narrower policy: every self source is also an estate source', () => {
    const estate = resolveSecurityHeaders({ enabled: true })
    const self = resolveSecurityHeaders({ enabled: true, baseline: 'self' })
    for (const name of Object.keys(self.csp)) {
      const selfSources = self.csp[name]
      if (!Array.isArray(selfSources)) continue
      expect(estate.csp[name], `${name} must be a superset`).toEqual(
        expect.arrayContaining(selfSources),
      )
    }
  })
})

describe('GA4 Google-signals beacon (issue #472)', () => {
  // Pins the exact GA host set so a later edit to either directive shows up
  // in review, per the issue's own request.
  const gaHosts = (sources: readonly string[]) =>
    sources.filter((source) => source.includes('google') || source.includes('doubleclick'))

  it('allows the Google-signals page_view beacon on connect-src', () => {
    expect(gaHosts(BASELINE_ALLOWLIST.connect)).toEqual([
      'https://*.google-analytics.com',
      'https://*.analytics.google.com',
      'https://*.googletagmanager.com',
      'https://www.google.com',
    ])
  })

  it('allows the Google-signals image-beacon fallback on img-src', () => {
    expect(gaHosts(BASELINE_ALLOWLIST.img)).toEqual(['https://www.google.com'])
  })
})

describe('legacy CSP_*_SRC environment variables', () => {
  it('parses the comma-separated form, ignoring blanks', () => {
    expect(parseLegacyCspSources('blob:, https://a.example ,,')).toEqual([
      'blob:',
      'https://a.example',
    ])
    expect(parseLegacyCspSources(undefined)).toEqual([])
    expect(parseLegacyCspSources(42)).toEqual([])
  })

  it('survives the switch to the preset, so an app configured that way is not broken', () => {
    const resolved = resolveSecurityHeaders(
      { enabled: true },
      {
        cspConnectSrc: 'https://data.nard.uk',
        cspFrameSrc: 'https://frame.example',
        cspMediaSrc: 'blob:',
        cspScriptSrc: 'https://p.nard.uk',
        cspWorkerSrc: 'https://worker.example',
      },
    )
    expect(resolved.csp['connect-src']).toContain('https://data.nard.uk')
    expect(resolved.csp['frame-src']).toContain('https://frame.example')
    expect(resolved.csp['media-src']).toContain('blob:')
    expect(resolved.csp['script-src']).toContain('https://p.nard.uk')
    expect(resolved.csp['worker-src']).toContain('https://worker.example')
  })

  it('keeps the structured allowlist alongside the legacy one rather than replacing it', () => {
    const merged = mergeLegacyAllowlist(
      { script: ['https://structured.example'], img: ['https://img.example'] },
      { cspScriptSrc: 'https://legacy.example' },
    )
    expect(merged.script).toEqual(['https://structured.example', 'https://legacy.example'])
    expect(merged.img).toEqual(['https://img.example'])
  })
})

describe('report route', () => {
  it('emits report-uri pointing at the default route', () => {
    expect(resolveSecurityHeaders(true).csp['report-uri']).toEqual([DEFAULT_REPORT_ROUTE])
  })

  it('honours a custom route', () => {
    const resolved = resolveSecurityHeaders({ enabled: true, reportRoute: '/csp' })
    expect(resolved.reportRoute).toBe('/csp')
    expect(resolved.csp['report-uri']).toEqual(['/csp'])
  })

  it('emits no report-uri when reporting is switched off', () => {
    const resolved = resolveSecurityHeaders({ enabled: true, reportRoute: false })
    expect(resolved.reportRoute).toBe(false)
    expect(resolved.csp['report-uri']).toBeUndefined()
  })
})

describe('nuxt-security configuration', () => {
  it('puts the report-only switch beside headers, not inside it', () => {
    const config = buildNuxtSecurityConfig(resolveSecurityHeaders(true))
    // 70-securityHeaders.js reads `rules.contentSecurityPolicyReportOnly` to
    // choose the header NAME. Nested under `headers` it would be stringified
    // as an unknown header and the policy would silently stay enforcing.
    expect(config.contentSecurityPolicyReportOnly).toBe(true)
    expect(config.headers).not.toHaveProperty('contentSecurityPolicyReportOnly')
  })

  it('flips to the enforcing header only at enforce', () => {
    const config = buildNuxtSecurityConfig(resolveSecurityHeaders({ enabled: true, enforce: true }))
    expect(config.contentSecurityPolicyReportOnly).toBe(false)
  })

  it('turns off every nuxt-security capability narduk-core already owns', () => {
    const config = buildNuxtSecurityConfig(resolveSecurityHeaders(true))
    expect(config.csrf).toBe(false)
    expect(config.corsHandler).toBe(false)
    expect(config.rateLimiter).toBe(false)
  })

  it('leaves request and build behaviour alone, against the upstream defaults', () => {
    const config = buildNuxtSecurityConfig(resolveSecurityHeaders(true))
    // Upstream defaults these ON: removeLoggers strips console.* from the
    // production bundle and sri rewrites script tags. Neither belongs in a
    // headers preset.
    expect(config.removeLoggers).toBe(false)
    expect(config.sri).toBe(false)
    expect(config.xssValidator).toBe(false)
    expect(config.requestSizeLimiter).toBe(false)
    expect(config.allowedMethodsRestricter).toBe(false)
    expect(config.basicAuth).toBe(false)
    expect(config.hidePoweredBy).toBe(false)
    expect(Object.values(config.ssg).every((value) => value === false)).toBe(true)
  })

  it('fills the HSTS gap with a 180-day policy that does not opt into preload', () => {
    const config = buildNuxtSecurityConfig(resolveSecurityHeaders(true))
    expect(config.headers.strictTransportSecurity).toEqual({
      maxAge: DEFAULT_HSTS_MAX_AGE,
      includeSubdomains: true,
      preload: false,
    })
  })

  it('lets an app widen or disable HSTS', () => {
    expect(
      buildNuxtSecurityConfig(
        resolveSecurityHeaders({ enabled: true, hsts: { maxAge: 63_072_000, preload: true } }),
      ).headers.strictTransportSecurity,
    ).toEqual({ maxAge: 63_072_000, includeSubdomains: true, preload: true })
    expect(
      buildNuxtSecurityConfig(resolveSecurityHeaders({ enabled: true, hsts: false })).headers
        .strictTransportSecurity,
    ).toBe(false)
  })

  it('keeps the rest of the standard header set', () => {
    const headers = buildNuxtSecurityConfig(resolveSecurityHeaders(true)).headers
    expect(headers.xContentTypeOptions).toBe('nosniff')
    expect(headers.referrerPolicy).toBe('strict-origin-when-cross-origin')
    expect(headers.xXSSProtection).toBe('0')
    expect(headers.crossOriginOpenerPolicy).toBe('same-origin')
    // COEP would break the cross-origin images and scripts the allowlist
    // deliberately permits.
    expect(headers.crossOriginEmbedderPolicy).toBe(false)
  })

  it('locks down the camera, microphone and geolocation by default', () => {
    const policy = buildNuxtSecurityConfig(resolveSecurityHeaders(true)).headers
      .permissionsPolicy as Record<string, unknown>
    expect(policy.camera).toEqual([])
    expect(policy.microphone).toEqual([])
    expect(policy.geolocation).toEqual([])
  })

  it('lets an app that needs geolocation grant it without restating the rest', () => {
    const policy = buildNuxtSecurityConfig(
      resolveSecurityHeaders({ enabled: true, permissionsPolicy: { geolocation: ['self'] } }),
    ).headers.permissionsPolicy as Record<string, unknown>
    expect(policy.geolocation).toEqual(['self'])
    expect(policy.camera).toEqual([])
  })
})
