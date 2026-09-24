import { rmSync } from 'node:fs'

import { afterEach, describe, expect, it } from 'vitest'

import {
  parseSecurityHeadersCheckArgs,
  runSecurityHeadersCheckCommand,
} from '../../src/commands/security-headers-check.js'
import {
  resolveProbeUrls,
  runSecurityHeadersCheck,
  type HeaderProbe,
} from '../../src/foundation/evaluate-security-headers.js'
import {
  assessCsp,
  evaluateItem10,
  evaluateProbedRoute,
  parseCspDirectives,
  type ProbedRoute,
} from '../../src/foundation/items/item-10-security-headers.js'
import type { FoundationStatus, FoundationSubCheck } from '../../src/foundation/types.js'
import { makeTempRepo, writeJson } from './helpers.js'

const tempDirs: string[] = []
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

function tempRepo(): string {
  const root = makeTempRepo()
  tempDirs.push(root)
  writeJson(root, 'package.json', { name: 'fixture-app' })
  return root
}

/**
 * The header set a fully adopted app serves: strict nonce CSP enforcing, HSTS,
 * and the rest. Each test mutates ONE header away from this so an assertion
 * reads as "this exact change flips this exact sub-check".
 */
const CONFORMANT: Record<string, string> = {
  'content-security-policy':
    "default-src 'self'; base-uri 'self'; object-src 'none'; form-action 'self'; " +
    "frame-ancestors 'none'; script-src 'self' 'nonce-Ab12' 'strict-dynamic'; " +
    "style-src 'self' 'unsafe-inline'",
  'strict-transport-security': 'max-age=15552000; includeSubDomains',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
}

function route(headers: Record<string, string> = CONFORMANT): ProbedRoute {
  return { url: 'https://app.example/', status: 200, headers }
}

function without(header: string): ProbedRoute {
  const headers = { ...CONFORMANT }
  delete headers[header]
  return route(headers)
}

function statusOf(checks: FoundationSubCheck[], id: string): FoundationStatus | undefined {
  return checks.find((sub) => sub.id === id)?.status
}

describe('CSP parsing', () => {
  it('splits a policy into lowercased directives', () => {
    expect(parseCspDirectives("default-src 'self'; Script-Src 'self' https://a.example")).toEqual({
      'default-src': ["'self'"],
      'script-src': ["'self'", 'https://a.example'],
    })
  })

  it('records a valueless directive as an empty source list', () => {
    expect(parseCspDirectives('upgrade-insecure-requests')).toEqual({
      'upgrade-insecure-requests': [],
    })
  })
})

describe('which policy is in force', () => {
  it('reports enforce when the enforcing header is present', () => {
    expect(assessCsp({ 'content-security-policy': "default-src 'self'" }).mode).toBe('enforce')
  })

  it('reports report-only when only the report-only header is present', () => {
    expect(assessCsp({ 'content-security-policy-report-only': "default-src 'self'" }).mode).toBe(
      'report-only',
    )
  })

  it('assesses the enforcing policy during a soak, not the stricter one being reported', () => {
    // This is the whole point: during the `security.headers` soak both headers
    // are served, and reading the report-only one would claim a strictness the
    // browser is not applying.
    const assessment = assessCsp({
      'content-security-policy': "script-src 'self' 'unsafe-inline'",
      'content-security-policy-report-only': "script-src 'self' 'nonce-x' 'strict-dynamic'",
    })
    expect(assessment.mode).toBe('enforce')
    expect(assessment.directives['script-src']).toEqual(["'self'", "'unsafe-inline'"])
  })

  it('reports absent when neither header is served', () => {
    expect(assessCsp({}).mode).toBe('absent')
  })
})

describe('a conformant deployment', () => {
  it('passes every sub-check', () => {
    const checks = evaluateProbedRoute(route(), '10')
    expect(checks.every((sub) => sub.status === 'pass')).toBe(true)
  })

  it('names the soak when a report-only policy sits beside the enforcing one', () => {
    const checks = evaluateProbedRoute(
      route({ ...CONFORMANT, 'content-security-policy-report-only': "default-src 'none'" }),
      '10',
    )
    expect(statusOf(checks, '10.1')).toBe('pass')
    expect(checks.find((sub) => sub.id === '10.1')?.detail).toContain('soak is in progress')
  })
})

describe('gaps a probe must catch', () => {
  it('fails when no CSP of either kind is served', () => {
    const checks = evaluateProbedRoute(without('content-security-policy'), '10')
    expect(statusOf(checks, '10.1')).toBe('fail')
    expect(statusOf(checks, '10.2')).toBe('fail')
  })

  it('fails when only a report-only policy is served, because nothing is enforced', () => {
    const headers = { ...CONFORMANT }
    delete headers['content-security-policy']
    headers['content-security-policy-report-only'] = CONFORMANT['content-security-policy']!
    const checks = evaluateProbedRoute(route(headers), '10')
    expect(statusOf(checks, '10.1')).toBe('fail')
    expect(checks.find((sub) => sub.id === '10.1')?.detail).toContain('enforce')
  })

  it("fails a nonce-less script-src -- the state Buoys' enforcing policy is in today", () => {
    const checks = evaluateProbedRoute(
      route({
        ...CONFORMANT,
        'content-security-policy':
          "default-src 'self'; frame-ancestors 'none'; " +
          "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.example",
      }),
      '10',
    )
    expect(statusOf(checks, '10.2')).toBe('fail')
    expect(checks.find((sub) => sub.id === '10.2')?.detail).toContain('no nonce source')
  })

  it("fails a nonce beside 'unsafe-inline' when strict-dynamic is not there to neutralise it", () => {
    const checks = evaluateProbedRoute(
      route({
        ...CONFORMANT,
        'content-security-policy':
          "frame-ancestors 'none'; script-src 'self' 'nonce-Ab12' 'unsafe-inline'",
      }),
      '10',
    )
    expect(statusOf(checks, '10.2')).toBe('fail')
  })

  it("passes a nonce beside 'unsafe-inline' when strict-dynamic makes it inert", () => {
    const checks = evaluateProbedRoute(
      route({
        ...CONFORMANT,
        'content-security-policy':
          "frame-ancestors 'none'; " +
          "script-src 'self' 'nonce-Ab12' 'strict-dynamic' 'unsafe-inline'",
      }),
      '10',
    )
    expect(statusOf(checks, '10.2')).toBe('pass')
    expect(checks.find((sub) => sub.id === '10.2')?.detail).toContain('ignored by a browser')
  })

  it('falls back to default-src exactly as a browser does', () => {
    const checks = evaluateProbedRoute(
      route({
        ...CONFORMANT,
        'content-security-policy': "default-src 'self' 'nonce-Ab12' 'strict-dynamic'",
      }),
      '10',
    )
    expect(statusOf(checks, '10.2')).toBe('pass')
  })

  it('fails an absent HSTS header', () => {
    expect(statusOf(evaluateProbedRoute(without('strict-transport-security'), '10'), '10.3')).toBe(
      'fail',
    )
  })

  it('fails an HSTS max-age below six months', () => {
    const checks = evaluateProbedRoute(
      route({ ...CONFORMANT, 'strict-transport-security': 'max-age=3600' }),
      '10',
    )
    expect(statusOf(checks, '10.3')).toBe('fail')
    expect(checks.find((sub) => sub.id === '10.3')?.detail).toContain('3600')
  })

  it('accepts frame-ancestors alone, with no X-Frame-Options fallback', () => {
    const checks = evaluateProbedRoute(without('x-frame-options'), '10')
    expect(statusOf(checks, '10.4')).toBe('pass')
  })

  it('accepts X-Frame-Options alone, for a policy with no frame-ancestors', () => {
    const checks = evaluateProbedRoute(
      route({ ...CONFORMANT, 'content-security-policy': "default-src 'self' 'nonce-a'" }),
      '10',
    )
    expect(statusOf(checks, '10.4')).toBe('pass')
  })

  it('fails when neither framing control is present', () => {
    const headers = { ...CONFORMANT }
    delete headers['x-frame-options']
    headers['content-security-policy'] = "default-src 'self' 'nonce-a'"
    expect(statusOf(evaluateProbedRoute(route(headers), '10'), '10.4')).toBe('fail')
  })

  it('fails an absent Referrer-Policy or Permissions-Policy', () => {
    expect(statusOf(evaluateProbedRoute(without('referrer-policy'), '10'), '10.5')).toBe('fail')
    expect(statusOf(evaluateProbedRoute(without('permissions-policy'), '10'), '10.6')).toBe('fail')
  })

  it('fails an X-Content-Type-Options that is present but not nosniff', () => {
    const checks = evaluateProbedRoute(
      route({ ...CONFORMANT, 'x-content-type-options': 'sniff' }),
      '10',
    )
    expect(statusOf(checks, '10.7')).toBe('fail')
  })
})

describe('unknown is never a pass and never a fail', () => {
  it('is unknown with no base URL at all', () => {
    const checks = evaluateItem10([])
    expect(checks).toHaveLength(1)
    expect(checks[0]?.status).toBe('unknown')
  })

  it('is unknown when the route could not be read', () => {
    const checks = evaluateItem10([{ url: 'https://app.example/', error: 'fetch failed' }])
    expect(checks).toHaveLength(1)
    expect(checks[0]?.status).toBe('unknown')
    expect(checks[0]?.detail).toContain('fetch failed')
  })

  it('does not let an unreadable route erase a decided failure on a sibling', () => {
    const checks = evaluateItem10([
      without('strict-transport-security'),
      { url: 'https://app.example/map', error: 'timeout' },
    ])
    // fail beats unknown -- the artefact runner applies rollUp over these.
    expect(checks.some((sub) => sub.status === 'fail')).toBe(true)
    expect(checks.some((sub) => sub.status === 'unknown')).toBe(true)
  })
})

describe('multi-route probes', () => {
  it('namespaces sub-check ids per route so two routes stay distinguishable', () => {
    const checks = evaluateItem10([route(), without('referrer-policy')])
    expect(checks.some((sub) => sub.id === '10.1.0')).toBe(true)
    expect(statusOf(checks, '10.2.5')).toBe('fail')
  })

  it('keeps the plain 10.N ids when only one route is probed', () => {
    expect(evaluateItem10([route()]).map((sub) => sub.id)).toEqual([
      '10.0',
      '10.1',
      '10.2',
      '10.3',
      '10.4',
      '10.5',
      '10.6',
      '10.7',
    ])
  })

  it('resolves paths against the base URL, defaulting to the root', () => {
    expect(resolveProbeUrls('https://app.example', [])).toEqual(['https://app.example/'])
    // With no paths the base URL is read AS GIVEN. Resolving '/' against it
    // discarded the path the caller asked for, so `--base-url .../login`
    // probed the root -- on an authenticated app, the one route that refuses
    // the request (narduk-libs#632, absorbing #638).
    expect(resolveProbeUrls('https://app.example/login', [])).toEqual(['https://app.example/login'])
    // An explicit path still resolves against the origin, so it means the
    // same route whatever path the base URL carried.
    expect(resolveProbeUrls('https://app.example/login', ['/map'])).toEqual([
      'https://app.example/map',
    ])
    expect(resolveProbeUrls('https://app.example', ['/', '/stations/41008', '/map'])).toEqual([
      'https://app.example/',
      'https://app.example/stations/41008',
      'https://app.example/map',
    ])
  })
})

describe('artefact', () => {
  const probeReturning = (routes: Record<string, ProbedRoute>): HeaderProbe => {
    return async (url) => {
      const stubbed = routes[url]
      return stubbed ? { ...stubbed, url } : { url, error: 'not stubbed' }
    }
  }

  it('is a one-item document that never claims the ratified 7-item shape', async () => {
    const artefact = await runSecurityHeadersCheck({
      root: tempRepo(),
      toolVersion: '9.9.9',
      baseUrl: 'https://app.example',
      probe: probeReturning({ 'https://app.example/': route() }),
      generated: '2026-09-17T00:00:00.000Z',
    })
    expect(artefact.tool).toBe('@narduk-enterprises/narduk-app-tools/security-headers')
    expect(artefact.contract.items).toBe(1)
    expect(artefact.item.id).toBe(10)
    expect(artefact).not.toHaveProperty('items')
    expect(artefact.result).toBe('PASS')
    expect(artefact.exitCode).toBe(0)
  })

  it('records every probed route so a report can be re-read without re-probing', async () => {
    const artefact = await runSecurityHeadersCheck({
      root: tempRepo(),
      toolVersion: '9.9.9',
      baseUrl: 'https://app.example',
      paths: ['/', '/map'],
      probe: probeReturning({
        'https://app.example/': route(),
        'https://app.example/map': route(),
      }),
    })
    expect(artefact.probed.map((entry) => entry.url)).toEqual([
      'https://app.example/',
      'https://app.example/map',
    ])
  })

  it('exits 1 on a gap and 2 when nothing could be decided', async () => {
    const failing = await runSecurityHeadersCheck({
      root: tempRepo(),
      toolVersion: '9.9.9',
      baseUrl: 'https://app.example',
      probe: probeReturning({
        'https://app.example/': without('strict-transport-security'),
      }),
    })
    expect(failing.result).toBe('FAIL')
    expect(failing.exitCode).toBe(1)

    const unknown = await runSecurityHeadersCheck({ root: tempRepo(), toolVersion: '9.9.9' })
    expect(unknown.result).toBe('UNKNOWN')
    expect(unknown.exitCode).toBe(2)
  })
})

describe('command arguments', () => {
  it('parses a base URL, repeated paths and a json destination', () => {
    const flags = parseSecurityHeadersCheckArgs(
      ['--base-url', 'https://app.example', '--path', '/', '--path', '/map', '--json', 'out.json'],
      '/tmp/app',
    )
    expect(flags.baseUrl).toBe('https://app.example')
    expect(flags.paths).toEqual(['/', '/map'])
    expect(flags.jsonPath).toBe('out.json')
    expect(flags.json).toBe(false)
  })

  it('treats a bare --json as stdout', () => {
    expect(parseSecurityHeadersCheckArgs(['--json'], '/tmp/app').json).toBe(true)
  })

  it('rejects a non-http base URL rather than reporting it as unreachable', () => {
    expect(() => parseSecurityHeadersCheckArgs(['--base-url', 'ftp://x'], '/tmp')).toThrow(
      /http\(s\) URL/,
    )
    expect(() => parseSecurityHeadersCheckArgs(['--base-url', 'not a url'], '/tmp')).toThrow(
      /http\(s\) URL/,
    )
  })

  it('rejects --path without --base-url, which would probe nothing', () => {
    expect(() => parseSecurityHeadersCheckArgs(['--path', '/map'], '/tmp')).toThrow(
      /--path requires --base-url/,
    )
  })

  it('rejects an unknown option instead of ignoring it', () => {
    expect(() => parseSecurityHeadersCheckArgs(['--live'], '/tmp')).toThrow(/Unknown/)
  })

  it('writes the artefact and returns the artefact exit code', async () => {
    const root = tempRepo()
    const { artefact, exitCode } = await runSecurityHeadersCheckCommand(
      parseSecurityHeadersCheckArgs(['--base-url', 'https://app.example'], root),
      async (url) => ({ ...route(), url }),
    )
    expect(artefact.item.status).toBe('pass')
    expect(exitCode).toBe(0)
  })
})
