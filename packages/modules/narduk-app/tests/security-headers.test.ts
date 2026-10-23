import { createApp, eventHandler, toWebHandler } from 'h3'
import { describe, expect, it } from 'vitest'

import {
  applySecurityHeaders,
  buildSecurityHeaders,
  serializeCsp,
  serializePermissionsPolicy,
} from '../src/server/security-headers'

describe('serializers', () => {
  it('joins directives and sources', () => {
    expect(serializeCsp({ 'default-src': ["'self'"], 'upgrade-insecure-requests': [] })).toBe(
      "default-src 'self'; upgrade-insecure-requests",
    )
  })

  it('writes empty and populated Permissions-Policy allowlists', () => {
    expect(
      serializePermissionsPolicy({ camera: ['self'], microphone: [], geolocation: ['self'] }),
    ).toBe('camera=(self), microphone=(), geolocation=(self)')
  })
})

describe('buildSecurityHeaders', () => {
  it('sends the baseline with no CSP, policy or robots unless asked', () => {
    expect(buildSecurityHeaders({}, { https: false })).toEqual({
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'referrer-policy': 'strict-origin-when-cross-origin',
    })
  })

  it('adds HSTS on https only, and honors an override or opt-out', () => {
    expect(buildSecurityHeaders({}, { https: true })['strict-transport-security']).toBe(
      'max-age=31536000; includeSubDomains',
    )
    expect(
      buildSecurityHeaders(
        { hsts: { maxAgeSeconds: 60, includeSubDomains: false } },
        { https: true },
      )['strict-transport-security'],
    ).toBe('max-age=60')
    expect(buildSecurityHeaders({ hsts: false }, { https: true })).not.toHaveProperty(
      'strict-transport-security',
    )
  })

  it('serves the CSP as report-only and never as an enforced header', () => {
    const headers = buildSecurityHeaders(
      { reportOnlyCsp: { 'default-src': ["'self'"] }, robots: 'noindex, nofollow' },
      { https: true },
    )
    expect(headers['content-security-policy-report-only']).toBe("default-src 'self'")
    expect(headers).not.toHaveProperty('content-security-policy')
    expect(headers['x-robots-tag']).toBe('noindex, nofollow')
  })
})

describe('applySecurityHeaders', () => {
  const respond = async (proto: 'http' | 'https') => {
    const app = createApp()
    app.use(
      eventHandler((event) => {
        applySecurityHeaders(event, { permissionsPolicy: { camera: ['self'] } })
        return 'ok'
      }),
    )
    return toWebHandler(app)(
      new Request('http://example.test/', { headers: { 'x-forwarded-proto': proto } }),
    )
  }

  it('sets the headers on the response and reads https from the request', async () => {
    const secure = await respond('https')
    expect(secure.headers.get('permissions-policy')).toBe('camera=(self)')
    expect(secure.headers.get('strict-transport-security')).toContain('max-age=31536000')
    const plain = await respond('http')
    expect(plain.headers.get('strict-transport-security')).toBeNull()
  })
})
