import { describe, expect, it } from 'vitest'

import {
  FALLBACK_CSP,
  FALLBACK_PERMISSIONS_POLICY,
  nonDocumentSecurityHeaders,
} from '../runtime/server/non-document-security-headers'

// The shape narduk-core's preset hands nuxt-security (runtimeConfig.security.headers).
const presetHeaders = {
  contentSecurityPolicy: {
    'default-src': ["'self'"],
    'base-uri': ["'self'"],
    'object-src': ["'none'"],
    'frame-ancestors': ["'none'"],
    'upgrade-insecure-requests': true,
    'script-src': ["'self'", "'nonce-{{nonce}}'", "'strict-dynamic'", 'https://p.nard.uk'],
    'connect-src': ["'self'", 'https://p.nard.uk'],
    'media-src': false,
  },
  permissionsPolicy: {
    camera: [],
    microphone: [],
    geolocation: ['self'],
    payment: false,
  },
} as const

describe('non-document security headers', () => {
  it('serves the preset Permissions-Policy on responses the renderer never sees', () => {
    expect(nonDocumentSecurityHeaders(presetHeaders)['Permissions-Policy']).toBe(
      'camera=(), microphone=(), geolocation=(self)',
    )
  })

  it('keeps the preset CSP but drops the nonce only the renderer can mint', () => {
    const csp = nonDocumentSecurityHeaders(presetHeaders)['Content-Security-Policy']
    expect(csp).toBe(
      "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; " +
        "upgrade-insecure-requests; script-src 'self' 'strict-dynamic' https://p.nard.uk; " +
        "connect-src 'self' https://p.nard.uk;",
    )
    expect(csp).not.toContain('nonce')
  })

  it('accepts string values the way nuxt-security serialises them', () => {
    const headers = nonDocumentSecurityHeaders({
      contentSecurityPolicy: { 'default-src': "'self' 'nonce-{{nonce}}'" },
      permissionsPolicy: { camera: '()' },
    })
    expect(headers).toEqual({
      'Content-Security-Policy': "default-src 'self';",
      'Permissions-Policy': 'camera=()',
    })
  })

  it('sets nothing when the preset serves neither header', () => {
    expect(nonDocumentSecurityHeaders(undefined)).toEqual({})
    expect(nonDocumentSecurityHeaders(false)).toEqual({})
    expect(nonDocumentSecurityHeaders({})).toEqual({})
    expect(
      nonDocumentSecurityHeaders({ contentSecurityPolicy: false, permissionsPolicy: false }),
    ).toEqual({})
  })

  it('falls back to a restrictive header when the config shape changes', () => {
    const shapes: unknown[] = [
      { contentSecurityPolicy: 'default-src self', permissionsPolicy: 'camera=()' },
      { contentSecurityPolicy: ['default-src'], permissionsPolicy: [['camera', []]] },
      { contentSecurityPolicy: { 'default-src': 1 }, permissionsPolicy: { camera: true } },
      { contentSecurityPolicy: { 'default-src': [1] }, permissionsPolicy: { camera: [null] } },
      {
        contentSecurityPolicy: { 'default-src': { self: true } },
        permissionsPolicy: { camera: 0 },
      },
      { contentSecurityPolicy: new Map(), permissionsPolicy: new Map() },
      { contentSecurityPolicy: null, permissionsPolicy: null },
      { contentSecurityPolicy: true, permissionsPolicy: true },
      { contentSecurityPolicy: { 'media-src': false }, permissionsPolicy: { camera: false } },
    ]
    for (const shape of shapes) {
      expect(nonDocumentSecurityHeaders(shape), JSON.stringify(shape)).toEqual({
        'Content-Security-Policy': FALLBACK_CSP,
        'Permissions-Policy': FALLBACK_PERMISSIONS_POLICY,
      })
    }
    for (const shape of ['enforce', ['csp'], 1, true]) {
      expect(nonDocumentSecurityHeaders(shape), JSON.stringify(shape)).toEqual({
        'Content-Security-Policy': FALLBACK_CSP,
        'Permissions-Policy': FALLBACK_PERMISSIONS_POLICY,
      })
    }
  })

  it('falls back per header, keeping the one that still has a known shape', () => {
    expect(
      nonDocumentSecurityHeaders({
        contentSecurityPolicy: presetHeaders.contentSecurityPolicy,
        permissionsPolicy: { camera: 42 },
      })['Permissions-Policy'],
    ).toBe(FALLBACK_PERMISSIONS_POLICY)
    expect(
      nonDocumentSecurityHeaders({
        contentSecurityPolicy: { 'script-src': 42 },
        permissionsPolicy: presetHeaders.permissionsPolicy,
      }),
    ).toEqual({
      'Content-Security-Policy': FALLBACK_CSP,
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(self)',
    })
  })
})
