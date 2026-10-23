import { describe, expect, it, vi } from 'vitest'

import {
  assertSecurityHeaders,
  assertStatusContract,
  checkSecurityHeaders,
  checkStatusContract,
  securityHeaderFindings,
} from '../src/http-contracts.js'

import type { FetchLike } from '../src/http-contracts.js'

const GOOD = {
  'Content-Security-Policy': "default-src 'self'; frame-ancestors 'none'",
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
}

const ids = (
  headers: Record<string, string>,
  options: { production: boolean; [k: string]: unknown },
) => securityHeaderFindings(headers, options).map((finding) => finding.id)

describe('securityHeaderFindings', () => {
  it('accepts a fully headed production response', () => {
    expect(securityHeaderFindings(GOOD, { production: true })).toEqual([])
  })

  it('reports every missing header at once', () => {
    expect(ids({}, { production: true })).toEqual([
      'hsts',
      'csp',
      'clickjacking',
      'nosniff',
      'referrer-policy',
    ])
  })

  it('reads record keys in any case and Headers objects alike', () => {
    const lower = Object.fromEntries(Object.entries(GOOD).map(([k, v]) => [k.toLowerCase(), v]))
    expect(securityHeaderFindings(lower, { production: true })).toEqual([])
    expect(securityHeaderFindings(new Headers(GOOD), { production: true })).toEqual([])
    const bare = { get: (name: string) => new Headers(GOOD).get(name) }
    expect(securityHeaderFindings(bare, { production: true })).toEqual([])
  })

  describe('HSTS', () => {
    it('requires the minimum max-age, 15552000 by default', () => {
      const weak = { ...GOOD, 'Strict-Transport-Security': 'max-age=15551999' }
      expect(ids(weak, { production: true })).toEqual(['hsts'])
      const exact = { ...GOOD, 'Strict-Transport-Security': 'max-age=15552000' }
      expect(ids(exact, { production: true })).toEqual([])
      expect(ids(weak, { minHstsMaxAge: 100, production: true })).toEqual([])
    })

    it('rejects a header with no max-age', () => {
      const bad = { ...GOOD, 'Strict-Transport-Security': 'includeSubDomains' }
      expect(securityHeaderFindings(bad, { production: true })[0]?.message).toContain('no max-age')
    })

    it('is skipped on a plain http URL and required on https or when the URL is unknown', () => {
      const { 'Strict-Transport-Security': _hsts, ...noHsts } = GOOD
      expect(ids(noHsts, { production: true, url: 'http://localhost:3000/' })).toEqual([])
      expect(ids(noHsts, { production: true, url: 'https://example.com/' })).toEqual(['hsts'])
      expect(ids(noHsts, { production: true })).toEqual(['hsts'])
    })
  })

  describe('CSP and clickjacking', () => {
    const { 'Content-Security-Policy': _csp, ...noCsp } = GOOD

    it('accepts a Report-Only CSP as present but not as framing protection', () => {
      const reportOnly = {
        ...noCsp,
        'Content-Security-Policy-Report-Only': "default-src 'self'; frame-ancestors 'none'",
      }
      expect(ids(reportOnly, { production: true })).toEqual(['clickjacking'])
      expect(ids({ ...reportOnly, 'X-Frame-Options': 'DENY' }, { production: true })).toEqual([])
    })

    it('can refuse a Report-Only CSP', () => {
      const reportOnly = { ...noCsp, 'Content-Security-Policy-Report-Only': "default-src 'self'" }
      expect(
        ids(
          { ...reportOnly, 'X-Frame-Options': 'DENY' },
          { allowReportOnlyCsp: false, production: true },
        ),
      ).toEqual(['csp'])
    })

    it('accepts X-Frame-Options DENY or SAMEORIGIN only', () => {
      const csp = { ...GOOD, 'Content-Security-Policy': "default-src 'self'" }
      expect(ids({ ...csp, 'X-Frame-Options': 'sameorigin' }, { production: true })).toEqual([])
      expect(
        ids({ ...csp, 'X-Frame-Options': 'ALLOW-FROM https://a.test' }, { production: true }),
      ).toEqual(['clickjacking'])
      expect(ids(csp, { production: true })).toEqual(['clickjacking'])
    })

    it('finds frame-ancestors in any policy of a joined header, case-insensitively', () => {
      const joined = {
        ...GOOD,
        'Content-Security-Policy': "default-src 'self', Frame-Ancestors 'self'",
      }
      expect(ids(joined, { production: true })).toEqual([])
    })

    it('does not count frame-ancestors with no sources or a wildcard', () => {
      expect(
        ids({ ...GOOD, 'Content-Security-Policy': 'frame-ancestors *' }, { production: true }),
      ).toEqual(['clickjacking'])
      expect(
        ids({ ...GOOD, 'Content-Security-Policy': 'frame-ancestors;' }, { production: true }),
      ).toEqual(['clickjacking'])
    })

    it('does not mistake a source value for a directive name', () => {
      const tricky = { ...GOOD, 'Content-Security-Policy': "script-src 'self' frame-ancestors" }
      expect(ids(tricky, { production: true })).toEqual(['clickjacking'])
    })
  })

  it('requires nosniff exactly', () => {
    expect(ids({ ...GOOD, 'X-Content-Type-Options': 'NoSniff' }, { production: true })).toEqual([])
    expect(ids({ ...GOOD, 'X-Content-Type-Options': 'sniff' }, { production: true })).toEqual([
      'nosniff',
    ])
  })

  it('rejects leaky referrer policies, judging the last value of a fallback list', () => {
    for (const policy of ['unsafe-url', 'no-referrer-when-downgrade', 'no-referrer, unsafe-url']) {
      expect(ids({ ...GOOD, 'Referrer-Policy': policy }, { production: true }), policy).toEqual([
        'referrer-policy',
      ])
    }
    expect(
      ids({ ...GOOD, 'Referrer-Policy': 'unsafe-url, same-origin' }, { production: true }),
    ).toEqual([])
    expect(ids({ ...GOOD, 'Referrer-Policy': 'no-referrer' }, { production: true })).toEqual([])
  })

  it('requires noindex on a non-production host and never on production', () => {
    expect(ids(GOOD, { production: false })).toEqual(['robots-noindex'])
    expect(ids({ ...GOOD, 'X-Robots-Tag': 'noindex, nofollow' }, { production: false })).toEqual([])
    expect(ids({ ...GOOD, 'X-Robots-Tag': 'none' }, { production: false })).toEqual([])
    expect(ids({ ...GOOD, 'X-Robots-Tag': 'index' }, { production: false })).toEqual([
      'robots-noindex',
    ])
    expect(ids(GOOD, { production: true })).toEqual([])
  })
})

describe('assertSecurityHeaders', () => {
  it('passes a clean response and throws once naming every finding', () => {
    expect(() => assertSecurityHeaders(GOOD, { production: true })).not.toThrow()
    expect(() => assertSecurityHeaders({}, { production: false })).toThrow(
      /\[hsts\][\s\S]*\[csp\][\s\S]*\[robots-noindex\]/u,
    )
  })
})

describe('checkSecurityHeaders', () => {
  it('fetches with redirect manual, judges the URL scheme, and releases the body', async () => {
    const cancel = vi.fn(() => Promise.resolve())
    const response = new Response('body', { headers: { 'X-Content-Type-Options': 'nosniff' } })
    Object.defineProperty(response, 'body', { value: { cancel } })
    const fetchStub = vi.fn<FetchLike>(() => Promise.resolve(response))

    const findings = await checkSecurityHeaders('http://localhost:3000/', {
      fetch: fetchStub,
      production: true,
    })

    expect(fetchStub).toHaveBeenCalledWith('http://localhost:3000/', { redirect: 'manual' })
    expect(cancel).toHaveBeenCalledOnce()
    // http: so no HSTS finding; the rest of the contract still applies.
    expect(findings.map((finding) => finding.id)).toEqual([
      'csp',
      'clickjacking',
      'referrer-policy',
    ])
  })
})

/** Route a stub fetch by pathname. */
function routed(handlers: Record<string, () => Response>) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const fetchStub: FetchLike = (input, init) => {
    calls.push({ init, url: input })
    const handler = handlers[new URL(input).pathname] ?? (() => new Response(null, { status: 404 }))
    return Promise.resolve(handler())
  }
  return { calls, fetch: fetchStub }
}

const json401 = () =>
  new Response('{"statusCode":401}', {
    headers: { 'content-type': 'application/json; charset=utf-8' },
    status: 401,
  })

describe('checkStatusContract', () => {
  it('passes a 401 JSON API and a 404 unknown path, requesting both with redirect manual', async () => {
    const { calls, fetch } = routed({ '/api/orders': json401 })
    const findings = await checkStatusContract('https://app.test', {
      fetch,
      protectedApiPath: '/api/orders',
    })

    expect(findings).toEqual([])
    expect(calls).toHaveLength(2)
    expect(calls.every((call) => call.init?.redirect === 'manual')).toBe(true)
    expect(calls[1]?.url).toMatch(/^https:\/\/app\.test\/__narduk-status-contract-[0-9a-f]{32}$/u)
  })

  it('accepts +json content types', async () => {
    const { fetch } = routed({
      '/api/x': () =>
        new Response('{}', {
          headers: { 'content-type': 'application/problem+json' },
          status: 401,
        }),
    })
    expect(
      await checkStatusContract('https://app.test', { fetch, protectedApiPath: '/api/x' }),
    ).toEqual([])
  })

  it('flags the sign-in redirect on both a protected API and an unknown path', async () => {
    const redirect = () => new Response(null, { headers: { location: '/sign-in' }, status: 302 })
    const { fetch } = routed({ '/api/orders': redirect, '/gone': redirect })
    const findings = await checkStatusContract('https://app.test', {
      fetch,
      protectedApiPath: '/api/orders',
      unknownPath: '/gone',
    })

    expect(findings.map((finding) => finding.id)).toEqual([
      'protected-api-redirect',
      'unknown-path-redirect',
    ])
    expect(findings[0]?.message).toContain('302 to /sign-in')
  })

  it('treats an opaque redirect as a redirect', async () => {
    const opaque = new Response(null, { status: 200 })
    Object.defineProperty(opaque, 'type', { value: 'opaqueredirect' })
    const fetch: FetchLike = () => Promise.resolve(opaque)
    const findings = await checkStatusContract('https://app.test', {
      fetch,
      protectedApiPath: '/api/orders',
    })
    expect(findings.map((finding) => finding.id)).toEqual([
      'protected-api-redirect',
      'unknown-path-redirect',
    ])
  })

  it('flags wrong statuses and a non-JSON 401', async () => {
    const { fetch } = routed({
      '/api/a': () => new Response('{}', { headers: { 'content-type': 'application/json' } }),
      '/soft': () => new Response('<html>', { status: 200 }),
    })
    expect(
      (
        await checkStatusContract('https://app.test', {
          fetch,
          protectedApiPath: '/api/a',
          unknownPath: '/soft',
        })
      ).map((finding) => finding.id),
    ).toEqual(['protected-api-status', 'unknown-path-status'])

    const html401 = routed({
      '/api/b': () =>
        new Response('<html>', { headers: { 'content-type': 'text/html' }, status: 401 }),
    })
    expect(
      (
        await checkStatusContract('https://app.test', {
          fetch: html401.fetch,
          protectedApiPath: '/api/b',
        })
      ).map((finding) => finding.id),
    ).toEqual(['protected-api-content-type'])
  })

  it('rejects a protected path outside /api/ and an unknown path without a slash', async () => {
    await expect(
      checkStatusContract('https://app.test', { protectedApiPath: '/orders' }),
    ).rejects.toThrow(/must start with \/api\//)
    await expect(
      checkStatusContract('https://app.test', { protectedApiPath: '/api/x', unknownPath: 'gone' }),
    ).rejects.toThrow(/must start with \//)
  })

  it('draws a different unknown path each call', async () => {
    const first = routed({ '/api/x': json401 })
    const second = routed({ '/api/x': json401 })
    await checkStatusContract('https://app.test', {
      fetch: first.fetch,
      protectedApiPath: '/api/x',
    })
    await checkStatusContract('https://app.test', {
      fetch: second.fetch,
      protectedApiPath: '/api/x',
    })
    expect(first.calls[1]?.url).not.toBe(second.calls[1]?.url)
  })
})

describe('assertStatusContract', () => {
  it('throws one error with every finding', async () => {
    const redirect = () => new Response(null, { headers: { location: '/sign-in' }, status: 302 })
    const { fetch } = routed({ '/api/orders': redirect })
    await expect(
      assertStatusContract('https://app.test', {
        fetch: (input, init) =>
          fetch(input, init).then((response) =>
            new URL(input).pathname === '/api/orders'
              ? response
              : new Response(null, { headers: { location: '/sign-in' }, status: 302 }),
          ),
        protectedApiPath: '/api/orders',
      }),
    ).rejects.toThrow(/protected-api-redirect[\s\S]*unknown-path-redirect/u)

    const ok = routed({ '/api/orders': json401 })
    await expect(
      assertStatusContract('https://app.test', {
        fetch: ok.fetch,
        protectedApiPath: '/api/orders',
      }),
    ).resolves.toBeUndefined()
  })
})
