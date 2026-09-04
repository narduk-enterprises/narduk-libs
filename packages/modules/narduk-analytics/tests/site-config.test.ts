import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  assertAnalyticsWriteAllowed,
  isPreviewSafeMode,
  resolveAnalyticsAppUrl,
  resolveDeploymentTarget,
  resolveGscSiteUrl,
  resolvePosthogApiHost,
  resolvePosthogDomain,
} from '../server/utils/siteConfig'

beforeEach(() => {
  vi.stubGlobal(
    'createError',
    (input: { statusCode: number; statusMessage: string }) => new Error(input.statusMessage),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function makeConfig(
  publicOverrides: Record<string, unknown> = {},
  rootOverrides: Record<string, unknown> = {},
) {
  return {
    gscSiteUrl: '',
    posthogApiHost: '',
    posthogDomain: '',
    public: {
      appUrl: '',
      deploymentTarget: undefined,
      previewSafeMode: false,
      ...publicOverrides,
    },
    ...rootOverrides,
  } as unknown as Parameters<typeof resolveAnalyticsAppUrl>[0]
}

describe('resolveAnalyticsAppUrl', () => {
  it('trims and returns the configured public app URL when no event is given', () => {
    const config = makeConfig({ appUrl: '  https://example.com  ' })

    expect(resolveAnalyticsAppUrl(config)).toBe('https://example.com')
  })

  it('returns an empty string when no app URL is configured', () => {
    expect(resolveAnalyticsAppUrl(makeConfig())).toBe('')
  })
})

describe('resolveDeploymentTarget', () => {
  it('defaults to production for an unrecognized or missing value', () => {
    expect(resolveDeploymentTarget(makeConfig())).toBe('production')
    expect(resolveDeploymentTarget(makeConfig({ deploymentTarget: 'workers.dev' }))).toBe(
      'production',
    )
  })

  it('passes through staging and preview', () => {
    expect(resolveDeploymentTarget(makeConfig({ deploymentTarget: 'staging' }))).toBe('staging')
    expect(resolveDeploymentTarget(makeConfig({ deploymentTarget: 'preview' }))).toBe('preview')
  })
})

describe('isPreviewSafeMode', () => {
  it('is true when previewSafeMode is explicitly set', () => {
    expect(isPreviewSafeMode(makeConfig({ previewSafeMode: true }))).toBe(true)
  })

  it('is true when the deployment target resolves to preview, even without the flag', () => {
    expect(
      isPreviewSafeMode(makeConfig({ deploymentTarget: 'preview', previewSafeMode: false })),
    ).toBe(true)
  })

  it('is false for production without the flag', () => {
    expect(isPreviewSafeMode(makeConfig())).toBe(false)
  })
})

describe('assertAnalyticsWriteAllowed', () => {
  it('does not throw when writes are allowed', () => {
    expect(() => assertAnalyticsWriteAllowed(makeConfig())).not.toThrow()
  })

  it('throws a 403 when preview-safe mode is active', () => {
    expect(() => assertAnalyticsWriteAllowed(makeConfig({ previewSafeMode: true }))).toThrow(
      /disables analytics/,
    )
  })
})

describe('resolveGscSiteUrl', () => {
  it('prefers an explicitly configured GSC site URL', () => {
    const config = makeConfig({}, { gscSiteUrl: 'sc-domain:configured.com' })

    expect(resolveGscSiteUrl(config)).toBe('sc-domain:configured.com')
  })

  it('derives sc-domain: from the app URL hostname when unset', () => {
    const config = makeConfig({ appUrl: 'https://myapp.example.com/path' })

    expect(resolveGscSiteUrl(config)).toBe('sc-domain:myapp.example.com')
  })

  it('returns an empty string when neither is configured', () => {
    expect(resolveGscSiteUrl(makeConfig())).toBe('')
  })
})

describe('resolvePosthogApiHost', () => {
  it('falls back to the default PostHog API host', () => {
    expect(resolvePosthogApiHost(makeConfig())).toBe('https://p.nard.uk')
  })

  it('uses the configured host when present', () => {
    const config = makeConfig({}, { posthogApiHost: ' https://p.example.com ' })

    expect(resolvePosthogApiHost(config)).toBe('https://p.example.com')
  })
})

describe('resolvePosthogDomain', () => {
  it('prefers an explicitly configured domain', () => {
    const config = makeConfig({}, { posthogDomain: 'configured.example.com' })

    expect(resolvePosthogDomain(config)).toBe('configured.example.com')
  })

  it('derives the domain from the app URL when unset', () => {
    const config = makeConfig({ appUrl: 'https://myapp.example.com' })

    expect(resolvePosthogDomain(config)).toBe('myapp.example.com')
  })

  it('returns an empty string when neither is configured', () => {
    expect(resolvePosthogDomain(makeConfig())).toBe('')
  })
})
