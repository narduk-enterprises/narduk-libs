import { describe, expect, it } from 'vitest'

import { createLiveProbe, type LiveProbe, type LiveResponse } from '../src/live-probe.js'
import {
  assessHealth,
  assessOrigin,
  buildVersionMatches,
  cacheBustedUrl,
  formatVerifyReport,
  identityProofPath,
  parseVerifyArgs,
  resolveAccessHeaders,
  resolveExitCode,
  runVerifyLive,
  VERIFY_EXIT,
} from '../src/verify-live.js'

const SHA = 'f736b07d7f49a1b2c3d4e5f60718293a4b5c6d7e'
const SHORT = 'f736b07d7f49'

/** The narduk-core `/api/health` envelope; see `runtime/server/api/health.get.ts`. */
function healthBody(
  status: string,
  checks: Array<{ name: string; required: boolean; result: string }> = [],
): string {
  return JSON.stringify({
    success: true,
    data: {
      status,
      timestamp: '2026-09-17T00:00:00Z',
      database: 'ok',
      missingAuthTables: [],
      checks,
    },
  })
}

interface Scripted {
  [path: string]: LiveResponse | LiveResponse[]
}

/** A probe scripted per path. An array is consumed one entry per attempt. */
function scriptedProbe(script: Scripted): { probe: LiveProbe; requests: string[] } {
  const requests: string[] = []
  const cursors = new Map<string, number>()
  const probe: LiveProbe = async (url) => {
    requests.push(url)
    const path = new URL(url).pathname
    const entry = script[path]
    if (!entry) return { url, error: 'no script entry' }
    if (!Array.isArray(entry)) return { ...entry, url }
    const index = Math.min(cursors.get(path) ?? 0, entry.length - 1)
    cursors.set(path, index + 1)
    return { ...entry[index], url }
  }
  return { probe, requests }
}

const noSleep = async (): Promise<void> => {}

describe('local build identity and overall proof deadline', () => {
  it('compares the complete build ID without SHA prefix or case normalization', async () => {
    const buildId = 'dev-20260922-AbC123'
    const parsed = parseVerifyArgs([
      '--live',
      'https://a.test',
      '--expect-build-id',
      buildId,
      '--no-health',
      '--no-smoke',
      '--attempts',
      '1',
    ])
    for (const actual of [buildId, buildId.toLowerCase(), 'dev-20260922', `${buildId}-other`]) {
      const report = await runVerifyLive(parsed, {
        probe: async (url) => ({
          url,
          status: 200,
          headers: { 'x-build-version': actual },
        }),
      })
      expect(report.result).toBe(actual === buildId ? 'PASS' : 'FAIL')
      expect(report.expectedBuildId).toBe(buildId)
      expect(report.expectedSha).toBeNull()
    }
    expect(() =>
      parseVerifyArgs([
        '--live',
        'https://a.test',
        '--expect-build-id',
        buildId,
        '--expect-sha',
        SHA,
      ]),
    ).toThrow('mutually exclusive')
  })

  it('limits request time and retry sleep to the remaining overall budget', async () => {
    let elapsed = 0
    const timeouts: number[] = []
    const sleeps: number[] = []
    const report = await runVerifyLive(
      parseVerifyArgs([
        '--live',
        'https://a.test',
        '--expect-build-id',
        'dev-example',
        '--no-health',
        '--no-smoke',
        '--deadline-ms',
        '25',
        '--timeout-ms',
        '100',
        '--interval-seconds',
        '10',
      ]),
      {
        now: () => elapsed,
        probe: async (url, options) => {
          timeouts.push(options!.timeoutMs!)
          elapsed += 10
          return { url, status: 200, headers: { 'x-build-version': 'old' } }
        },
        sleep: async (ms) => {
          sleeps.push(ms)
          elapsed += ms
        },
      },
    )
    expect(report.result).toBe('FAIL')
    expect(report.attemptsUsed).toBe(1)
    expect(timeouts).toEqual([25])
    expect(sleeps).toEqual([15])
    expect(elapsed).toBe(25)
  })

  it('does not accept a matching identity returned after the deadline', async () => {
    let elapsed = 0
    const report = await runVerifyLive(
      parseVerifyArgs([
        '--live',
        'https://a.test',
        '--expect-build-id',
        'dev-example',
        '--no-health',
        '--no-smoke',
        '--deadline-ms',
        '5',
      ]),
      {
        now: () => elapsed,
        probe: async (url) => {
          elapsed = 6
          return { url, status: 200, headers: { 'x-build-version': 'dev-example' } }
        },
      },
    )
    expect(report.result).toBe('FAIL')
    expect(report.exitCode).toBe(VERIFY_EXIT.unreachable)
  })
})

function flags(extra: string[] = []): ReturnType<typeof parseVerifyArgs> {
  return parseVerifyArgs(['--live', 'https://buoystat.us', '--expect-sha', SHA, ...extra])
}

describe('verify --live argument parsing', () => {
  it('accepts both spellings of the base URL', () => {
    expect(parseVerifyArgs(['--live', 'https://a.test']).baseUrl).toBe('https://a.test')
    expect(parseVerifyArgs(['--live', '--base-url', 'https://a.test']).baseUrl).toBe(
      'https://a.test',
    )
  })

  it('applies the design §2.1 liveProof defaults', () => {
    const parsed = parseVerifyArgs(['--live', 'https://a.test'])
    expect(parsed.buildVersionHeader).toBe('x-build-version')
    expect(parsed.healthPath).toBe('/api/health')
    expect(parsed.smokePath).toBe('/')
    expect(parsed.attempts).toBe(6)
    expect(parsed.intervalSeconds).toBe(10)
    expect(parsed.allowDegraded).toBe(false)
  })

  it('refuses usage it cannot act on', () => {
    expect(() => parseVerifyArgs([])).toThrow('Usage: narduk-app verify --live')
    expect(() => parseVerifyArgs(['--live', '--expect-sha', SHA])).toThrow('needs a base URL')
    expect(() => parseVerifyArgs(['--live', 'ftp://a.test'])).toThrow('http(s) URL')
    expect(() => parseVerifyArgs(['--live', 'https://a.test', '--expect-sha', 'zz'])).toThrow(
      'hex commit SHA',
    )
    expect(() => parseVerifyArgs(['--live', 'https://a.test', '--attempts', '0'])).toThrow(
      'positive integer',
    )
    expect(() =>
      parseVerifyArgs(['--live', 'https://a.test', '--no-health', '--no-smoke']),
    ).toThrow('at least one assertion')
    expect(() => parseVerifyArgs(['--live', 'https://a.test', '--bogus'])).toThrow(
      'Unknown verify option: --bogus',
    )
  })
})

describe('x-build-version comparison', () => {
  it('compares as a hex prefix in both directions', () => {
    // Cloudflare/narduk-core publishes 12 chars; git --short emits 7; GITHUB_SHA is 40.
    expect(buildVersionMatches(SHA, SHORT)).toBe(true)
    expect(buildVersionMatches(SHORT, SHA)).toBe(true)
    expect(buildVersionMatches(SHA, 'deadbeef')).toBe(false)
    expect(buildVersionMatches(SHA, undefined)).toBe(false)
    expect(buildVersionMatches(SHA, '0.4.2')).toBe(false)
  })
})

describe('verify --live outcomes', () => {
  const okHead: LiveResponse = {
    url: '',
    status: 200,
    headers: { 'x-build-version': SHORT, 'content-type': 'text/html;charset=utf-8' },
  }
  const okHealth: LiveResponse = {
    url: '',
    status: 200,
    headers: { 'content-type': 'application/json', 'x-build-version': SHORT },
    body: healthBody('ok', [{ name: 'publication', required: true, result: 'pass' }]),
  }

  it('passes on the first attempt when all three assertions hold', async () => {
    const { probe } = scriptedProbe({ '/': okHead, '/api/health': okHealth })
    const report = await runVerifyLive(flags(), { probe, sleep: noSleep })
    expect(report.result).toBe('PASS')
    expect(report.exitCode).toBe(VERIFY_EXIT.pass)
    expect(report.attemptsUsed).toBe(1)
    expect(report.assertions.map((a) => a.id)).toEqual(['build-version', 'smoke', 'health'])
    for (const assertion of report.assertions) {
      expect(assertion.exitCode).toBe(VERIFY_EXIT.pass)
    }
    expect(formatVerifyReport(report)).toContain('RESULT: PASS')
  })

  it('does not put the mismatch code on a build-version assertion that passed', async () => {
    const unhealthy: LiveResponse = { ...okHealth, body: healthBody('error') }
    const { probe } = scriptedProbe({ '/': okHead, '/api/health': unhealthy })
    const report = await runVerifyLive(flags(['--attempts', '1']), { probe, sleep: noSleep })
    expect(report.exitCode).toBe(VERIFY_EXIT.healthFailed)
    expect(report.assertions.find((assertion) => assertion.id === 'build-version')).toMatchObject({
      status: 'pass',
      exitCode: VERIFY_EXIT.pass,
    })
  })

  it('reads x-build-version from health when the smoke path is a prerendered static asset', async () => {
    // create-narduk-app SEO apps prerender `/`; Cloudflare serves it as an
    // asset with no Worker header. Health stays on the Worker (narduk-libs#781).
    const prerenderedHome: LiveResponse = {
      url: '',
      status: 200,
      headers: { 'content-type': 'text/html;charset=utf-8' },
    }
    const workerHealth: LiveResponse = {
      ...okHealth,
      headers: { ...okHealth.headers, 'x-build-version': SHORT },
    }
    const { probe } = scriptedProbe({ '/': prerenderedHome, '/api/health': workerHealth })
    const report = await runVerifyLive(flags(['--attempts', '1']), { probe, sleep: noSleep })
    expect(report.result).toBe('PASS')
    expect(report.exitCode).toBe(VERIFY_EXIT.pass)
    expect(report.assertions.find((assertion) => assertion.id === 'build-version')).toMatchObject({
      status: 'pass',
      exitCode: VERIFY_EXIT.pass,
    })
    expect(report.assertions.find((assertion) => assertion.id === 'smoke')?.status).toBe('pass')
  })

  it('falls back to the smoke path for x-build-version when health is disabled', async () => {
    const { probe } = scriptedProbe({ '/': okHead })
    const report = await runVerifyLive(flags(['--no-health', '--attempts', '1']), {
      probe,
      sleep: noSleep,
    })
    expect(report.result).toBe('PASS')
    expect(identityProofPath(flags(['--no-health']))).toBe('/')
    expect(identityProofPath(flags())).toBe('/api/health')
  })

  it('retries a propagation delay and then passes', async () => {
    const stale: LiveResponse = {
      ...okHealth,
      headers: { ...okHealth.headers, 'x-build-version': 'aaaaaaaaaaaa' },
    }
    const { probe } = scriptedProbe({ '/': okHead, '/api/health': [stale, stale, okHealth] })
    const report = await runVerifyLive(flags(['--attempts', '4']), { probe, sleep: noSleep })
    expect(report.result).toBe('PASS')
    expect(report.attemptsUsed).toBe(3)
  })

  it('exits 3 on a build version that never becomes the expected one', async () => {
    const stale: LiveResponse = {
      ...okHealth,
      headers: { ...okHealth.headers, 'x-build-version': 'aaaaaaaaaaaa' },
    }
    const { probe } = scriptedProbe({ '/': okHead, '/api/health': stale })
    const report = await runVerifyLive(flags(['--attempts', '2']), { probe, sleep: noSleep })
    expect(report.exitCode).toBe(VERIFY_EXIT.buildVersionMismatch)
    expect(report.attemptsUsed).toBe(2)
  })

  it('exits 2 when the deployment cannot be read at all', async () => {
    const { probe } = scriptedProbe({
      '/': { url: '', error: 'fetch failed' },
      '/api/health': { url: '', error: 'fetch failed' },
    })
    const report = await runVerifyLive(flags(['--attempts', '1']), { probe, sleep: noSleep })
    expect(report.exitCode).toBe(VERIFY_EXIT.unreachable)
  })

  it('exits 4 on a health report whose required check failed', async () => {
    const unhealthy: LiveResponse = {
      url: '',
      status: 503,
      headers: { 'content-type': 'application/json', 'x-build-version': SHORT },
      body: healthBody('error', [{ name: 'database', required: true, result: 'fail' }]),
    }
    const { probe } = scriptedProbe({ '/': okHead, '/api/health': unhealthy })
    const report = await runVerifyLive(flags(['--attempts', '1']), { probe, sleep: noSleep })
    expect(report.exitCode).toBe(VERIFY_EXIT.healthFailed)
    expect(report.assertions.find((a) => a.id === 'health')?.detail).toContain('database')
  })

  it('exits 5 when only the smoke route is wrong', async () => {
    const wrongType: LiveResponse = {
      url: '',
      status: 200,
      headers: { 'x-build-version': SHORT, 'content-type': 'application/json' },
    }
    const { probe } = scriptedProbe({ '/': wrongType, '/api/health': okHealth })
    const report = await runVerifyLive(flags(['--attempts', '1']), { probe, sleep: noSleep })
    expect(report.exitCode).toBe(VERIFY_EXIT.smokeFailed)
  })

  it('probes the paths it was told to probe', async () => {
    const { probe, requests } = scriptedProbe({
      '/status': { url: '', status: 200, headers: { 'content-type': 'application/json' } },
      '/healthz': okHealth,
    })
    await runVerifyLive(
      parseVerifyArgs([
        '--live',
        'https://a.test',
        '--health-path',
        '/healthz',
        '--smoke-path',
        '/status',
        '--expect-content-type',
        'application/json',
        '--attempts',
        '1',
      ]),
      { probe, sleep: noSleep, cacheBustToken: () => 'tok' },
    )
    expect(requests).toEqual([
      'https://a.test/status?_nardukProof=tok',
      'https://a.test/healthz?_nardukProof=tok',
    ])
  })
})

describe('degraded health', () => {
  const degraded: LiveResponse = {
    url: 'https://a.test/api/health',
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: healthBody('degraded', [
      { name: 'database', required: true, result: 'pass' },
      { name: 'publication', required: false, result: 'fail' },
    ]),
  }

  it('fails by default, taking design §6.2 literally', () => {
    const assertion = assessHealth(degraded, { allowDegraded: false })
    expect(assertion.status).toBe('fail')
    expect(assertion.detail).toContain('--allow-degraded')
    expect(assertion.evidence?.healthStatus).toBe('degraded')
  })

  it('passes under --allow-degraded, still recording the status verbatim', () => {
    const assertion = assessHealth(degraded, { allowDegraded: true })
    expect(assertion.status).toBe('pass')
    expect(assertion.evidence?.healthStatus).toBe('degraded')
  })

  it('never lets --allow-degraded excuse a failing required check', () => {
    const broken: LiveResponse = {
      ...degraded,
      body: healthBody('degraded', [{ name: 'database', required: true, result: 'fail' }]),
    }
    expect(assessHealth(broken, { allowDegraded: true }).status).toBe('fail')
  })

  it('rejects a body that is not the narduk-core envelope', () => {
    const notJson: LiveResponse = { url: 'https://a.test/api/health', status: 200, body: '<html>' }
    expect(assessHealth(notJson, { allowDegraded: false }).detail).toContain('not JSON')
    const wrongShape: LiveResponse = {
      url: 'https://a.test/api/health',
      status: 200,
      body: JSON.stringify({ ok: true }),
    }
    expect(assessHealth(wrongShape, { allowDegraded: false }).detail).toContain('health envelope')
  })

  it('treats a skipped check as not a failure', () => {
    const skipped: LiveResponse = {
      ...degraded,
      body: healthBody('ok', [{ name: 'database', required: true, result: 'skipped' }]),
    }
    expect(assessHealth(skipped, { allowDegraded: false }).status).toBe('pass')
  })
})

describe('exit code severity order', () => {
  it('reports unreachable ahead of every other class', () => {
    expect(
      resolveExitCode([
        { id: 'build-version', status: 'unknown', detail: '', exitCode: VERIFY_EXIT.unreachable },
        { id: 'smoke', status: 'fail', detail: '', exitCode: VERIFY_EXIT.smokeFailed },
      ]),
    ).toBe(VERIFY_EXIT.unreachable)
  })

  it('reports the build before the health before the smoke', () => {
    expect(
      resolveExitCode([
        {
          id: 'build-version',
          status: 'fail',
          detail: '',
          exitCode: VERIFY_EXIT.buildVersionMismatch,
        },
        { id: 'health', status: 'fail', detail: '', exitCode: VERIFY_EXIT.healthFailed },
      ]),
    ).toBe(VERIFY_EXIT.buildVersionMismatch)
    expect(
      resolveExitCode([
        { id: 'health', status: 'fail', detail: '', exitCode: VERIFY_EXIT.healthFailed },
        { id: 'smoke', status: 'fail', detail: '', exitCode: VERIFY_EXIT.smokeFailed },
      ]),
    ).toBe(VERIFY_EXIT.healthFailed)
    expect(resolveExitCode([])).toBe(VERIFY_EXIT.pass)
  })
})

/* -------------------------------------------------------------------------- */
/* Review round 1                                                             */
/* -------------------------------------------------------------------------- */

const HEALTHY: LiveResponse = {
  url: '',
  status: 200,
  headers: { 'content-type': 'application/json', 'x-build-version': SHORT },
  body: healthBody('ok', [{ name: 'publication', required: true, result: 'pass' }]),
}

describe('B3 -- the live proof must not be satisfiable by a cached response', () => {
  it('asks every hop not to answer from cache', async () => {
    const seen: Array<Record<string, string>> = []
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      seen.push(init.headers as Record<string, string>)
      expect(init.cache).toBe('no-store')
      return new Response('', { status: 200, headers: { 'x-build-version': SHORT } })
    }) as typeof globalThis.fetch
    try {
      const probe = createLiveProbe()
      await probe('https://a.test/')
    } finally {
      globalThis.fetch = originalFetch
    }
    expect(seen[0]['cache-control']).toContain('no-cache')
    expect(seen[0]['cache-control']).toContain('no-store')
    expect(seen[0].pragma).toBe('no-cache')
  })

  it('gives every attempt its own cache key, so a stale first answer cannot be replayed', async () => {
    const { probe, requests } = scriptedProbe({
      '/': {
        url: '',
        status: 200,
        headers: { 'content-type': 'text/html' },
      },
      '/api/health': [
        { ...HEALTHY, headers: { ...HEALTHY.headers, 'x-build-version': 'deadbee' } },
        HEALTHY,
      ],
    })
    const report = await runVerifyLive(flags(['--attempts', '2']), {
      probe,
      sleep: noSleep,
      cacheBustToken: (n) => `attempt-${String(n)}`,
    })
    expect(report.result).toBe('PASS')
    expect(requests[0]).toContain('_nardukProof=attempt-1')
    expect(requests.some((url) => url.includes('_nardukProof=attempt-2'))).toBe(true)
    // Two distinct keys: no intermediary can hold a copy of both.
    expect(new Set(requests.map((url) => new URL(url).searchParams.get('_nardukProof'))).size).toBe(
      2,
    )
  })

  it('keeps an existing query string and can be turned off', () => {
    expect(cacheBustedUrl('https://a.test/x?a=1', 'tok', true)).toBe(
      'https://a.test/x?a=1&_nardukProof=tok',
    )
    expect(cacheBustedUrl('https://a.test/x', 'tok', false)).toBe('https://a.test/x')
    expect(parseVerifyArgs(['--live', 'https://a.test', '--no-cache-bust']).cacheBust).toBe(false)
    expect(parseVerifyArgs(['--live', 'https://a.test']).cacheBust).toBe(true)
  })

  it('refuses a proof answered by a different origin, whatever the headers say', async () => {
    // Design §2.3: two Workers, two accounts, one hostname. Everything below
    // this redirect is a correct proof -- of the wrong deployment.
    const probe: LiveProbe = async (url) => ({
      url,
      finalUrl: 'https://other-worker.workers.dev/',
      redirected: true,
      status: 200,
      headers: { 'x-build-version': SHORT, 'content-type': 'text/html' },
      body: healthBody('ok'),
    })
    const report = await runVerifyLive(flags(['--attempts', '1']), { probe, sleep: noSleep })
    expect(report.exitCode).toBe(VERIFY_EXIT.offOrigin)
    expect(report.result).toBe('FAIL')
    const origin = report.assertions.find((entry) => entry.id === 'origin')
    expect(origin?.status).toBe('fail')
    expect(origin?.evidence).toMatchObject({
      finalUrl: 'https://other-worker.workers.dev/',
      expected: 'https://buoystat.us',
    })
    expect(formatVerifyReport(report)).toContain('origin:')
  })

  it('accepts a same-origin redirect, which is ordinary', async () => {
    const probe: LiveProbe = async (url) => ({
      url,
      finalUrl: 'https://buoystat.us/en/',
      redirected: true,
      status: 200,
      headers: { 'x-build-version': SHORT, 'content-type': 'text/html' },
      body: healthBody('ok'),
    })
    const report = await runVerifyLive(flags(['--attempts', '1']), { probe, sleep: noSleep })
    expect(report.result).toBe('PASS')
    expect(report.assertions.some((entry) => entry.id === 'origin')).toBe(false)
  })

  it('reports no origin assertion when nothing redirected', () => {
    expect(assessOrigin({ url: 'https://a.test/', status: 200 }, 'https://a.test')).toBeNull()
    expect(
      assessOrigin(
        { url: 'https://a.test/', finalUrl: 'https://a.test/', status: 200 },
        'https://a.test',
      ),
    ).toBeNull()
  })
})

describe('S4 -- --allow-degraded never excuses a broken database', () => {
  /** narduk-core reports a missing D1 binding as `required: false`, so the
   * summary is `degraded` rather than `error` on an app that never declared
   * `databaseBackend` (`runtime/server/health/report.ts`). */
  function degradedWithDatabase(database: string): LiveResponse {
    return {
      url: 'https://buoystat.us/api/health',
      status: 200,
      headers: {},
      body: JSON.stringify({
        success: true,
        data: {
          status: 'degraded',
          timestamp: '2026-09-17T00:00:00Z',
          database,
          missingAuthTables: [],
          checks: [{ name: 'database', required: false, result: 'fail' }],
        },
      }),
    }
  }

  for (const database of ['not_available', 'schema_error', 'error']) {
    it(`fails on database ${database} even with --allow-degraded`, () => {
      const assertion = assessHealth(degradedWithDatabase(database), { allowDegraded: true })
      expect(assertion.status).toBe('fail')
      expect(assertion.detail).toContain('never a missing or broken database binding')
      expect(assertion.evidence).toMatchObject({ database })
    })
  }

  for (const database of ['ok', 'not_applicable']) {
    it(`still accepts a degraded app whose database is ${database}`, () => {
      const assertion = assessHealth(degradedWithDatabase(database), { allowDegraded: true })
      expect(assertion.status).toBe('pass')
    })
  }

  it('fails a degraded app without the flag regardless of the database', () => {
    expect(assessHealth(degradedWithDatabase('ok'), { allowDegraded: false }).status).toBe('fail')
  })
})

/**
 * narduk-libs#435: `setCacheProfile` edge headers are inert unless Workers
 * Cache is on, so the live proof can be asked to show a real HIT on a
 * `live`/`slow` route, and a real non-HIT on a route that must never be stored.
 */
describe('verify --live edge-cache proof', () => {
  const API = '/api/stations'
  const PAGE = '/'
  const PUBLIC_HEADERS = {
    'content-type': 'application/json',
    'cache-control': 'public, max-age=60, stale-while-revalidate=900',
    'cdn-cache-control': 'public, max-age=300, stale-while-revalidate=900',
  }
  const response = (headers: Record<string, string>): LiveResponse => ({
    url: '',
    status: 200,
    headers,
  })
  const miss = response({ ...PUBLIC_HEADERS, 'cf-cache-status': 'MISS' })
  const hit = response({ ...PUBLIC_HEADERS, 'cf-cache-status': 'HIT' })
  const noStatus = response(PUBLIC_HEADERS)
  const previewSafe = response({
    'content-type': 'application/json',
    'cache-control': 'private, no-store',
  })
  const bypass = response({
    'content-type': 'text/html',
    'cache-control': 'private, no-store',
    'cf-cache-status': 'BYPASS',
  })

  function edgeFlags(extra: string[]): ReturnType<typeof parseVerifyArgs> {
    return parseVerifyArgs([
      '--live',
      'https://buoystat.us',
      '--no-health',
      '--no-smoke',
      '--attempts',
      '1',
      ...extra,
    ])
  }

  it('parses repeatable --edge-cache-path and --edge-uncached-path', () => {
    const parsed = edgeFlags([
      '--edge-cache-path',
      API,
      '--edge-cache-path',
      '/api/x',
      '--edge-uncached-path',
      PAGE,
    ])
    expect(parsed.edgeCachePaths).toEqual([API, '/api/x'])
    expect(parsed.edgeUncachedPaths).toEqual([PAGE])
    expect(parseVerifyArgs(['--live', 'https://a.test']).edgeCachePaths).toEqual([])
  })

  it('counts an edge-cache path as an assertion on its own', () => {
    expect(() =>
      parseVerifyArgs([
        '--live',
        'https://a.test',
        '--no-health',
        '--no-smoke',
        '--edge-cache-path',
        API,
      ]),
    ).not.toThrow()
  })

  it('passes when the second GET of a cacheable route is a HIT', async () => {
    const { probe, requests } = scriptedProbe({ [API]: [miss, hit] })
    const report = await runVerifyLive(edgeFlags(['--edge-cache-path', API]), {
      probe,
      sleep: noSleep,
      cacheBustToken: () => 'tok',
    })
    expect(report.exitCode).toBe(VERIFY_EXIT.pass)
    expect(report.assertions).toMatchObject([{ id: 'edge-cache', status: 'pass' }])
    // Both GETs use the same fresh URL, so the first cannot already be warm.
    expect(requests).toEqual([
      'https://buoystat.us/api/stations?_nardukProof=tok',
      'https://buoystat.us/api/stations?_nardukProof=tok',
    ])
  })

  it('fails when the second GET is still a MISS', async () => {
    const { probe } = scriptedProbe({ [API]: [miss, miss] })
    const report = await runVerifyLive(edgeFlags(['--edge-cache-path', API]), {
      probe,
      sleep: noSleep,
    })
    expect(report.exitCode).toBe(VERIFY_EXIT.edgeCacheFailed)
    expect(report.assertions[0]).toMatchObject({ id: 'edge-cache', status: 'fail' })
  })

  it('names Workers Cache when there is no Cf-Cache-Status at all', async () => {
    const { probe } = scriptedProbe({ [API]: [noStatus, noStatus] })
    const report = await runVerifyLive(edgeFlags(['--edge-cache-path', API]), {
      probe,
      sleep: noSleep,
    })
    expect(report.exitCode).toBe(VERIFY_EXIT.edgeCacheFailed)
    expect(report.assertions[0].detail).toContain('"cache": { "enabled": true }')
  })

  it('reports "cannot prove a HIT here" on a private/no-store answer (preview-safe mode)', async () => {
    const { probe } = scriptedProbe({ [API]: [previewSafe, previewSafe] })
    const report = await runVerifyLive(edgeFlags(['--edge-cache-path', API]), {
      probe,
      sleep: noSleep,
    })
    expect(report.exitCode).toBe(VERIFY_EXIT.edgeCacheFailed)
    expect(report.assertions[0]).toMatchObject({ id: 'edge-cache', status: 'unknown' })
    expect(report.assertions[0].detail).toContain('cannot prove a HIT here')
  })

  it('passes an uncached route that never HITs, and fails one that does', async () => {
    const good = scriptedProbe({ [PAGE]: [bypass, bypass] })
    const passReport = await runVerifyLive(edgeFlags(['--edge-uncached-path', PAGE]), {
      probe: good.probe,
      sleep: noSleep,
    })
    expect(passReport.assertions).toMatchObject([{ id: 'edge-uncached', status: 'pass' }])

    const bad = scriptedProbe({ [PAGE]: [miss, hit] })
    const failReport = await runVerifyLive(edgeFlags(['--edge-uncached-path', PAGE]), {
      probe: bad.probe,
      sleep: noSleep,
    })
    expect(failReport.exitCode).toBe(VERIFY_EXIT.edgeCacheFailed)
    expect(failReport.assertions[0]).toMatchObject({ id: 'edge-uncached', status: 'fail' })
  })

  it('reads the edge proof without the no-cache request headers', async () => {
    const seen: Array<boolean | undefined> = []
    const probe: LiveProbe = async (url, options) => {
      seen.push(options?.noCache)
      return { ...(seen.length === 1 ? miss : hit), url }
    }
    await runVerifyLive(edgeFlags(['--edge-cache-path', API]), { probe, sleep: noSleep })
    expect(seen).toEqual([false, false])
  })
})

describe('verify --live behind Cloudflare Access', () => {
  const ACCESS = [
    '--access-client-id-env',
    'CF_ACCESS_ID',
    '--access-client-secret-env',
    'CF_ACCESS_SECRET',
  ]

  it('takes variable names, both halves or neither', () => {
    expect(flags(ACCESS).accessClientIdEnv).toBe('CF_ACCESS_ID')
    expect(flags().accessClientIdEnv).toBeNull()
    expect(() => flags(['--access-client-id-env', 'CF_ACCESS_ID'])).toThrow(/go together/)
    expect(() =>
      flags(['--access-client-id-env', 'abc.123-value', '--access-client-secret-env', 'S']),
    ).toThrow(/variable NAME/)
  })

  it('sends the service token on every probe, read from the environment', async () => {
    const seen: Array<Record<string, string> | undefined> = []
    const { probe: scripted } = scriptedProbe({
      '/': {
        url: '',
        status: 200,
        headers: { 'x-build-version': SHORT, 'content-type': 'text/html' },
      },
      '/api/health': {
        url: '',
        status: 200,
        headers: { 'content-type': 'application/json', 'x-build-version': SHORT },
        body: healthBody('ok', [{ name: 'publication', required: true, result: 'pass' }]),
      },
    })
    const probe: LiveProbe = async (url, options) => {
      seen.push(options?.headers)
      return scripted(url, options)
    }
    const report = await runVerifyLive(flags([...ACCESS, '--attempts', '1']), {
      probe,
      sleep: noSleep,
      env: { CF_ACCESS_ID: 'id.access', CF_ACCESS_SECRET: 'not-printed' },
    })
    expect(report.result).toBe('PASS')
    expect(seen).toHaveLength(2)
    for (const headers of seen) {
      expect(headers).toEqual({
        'cf-access-client-id': 'id.access',
        'cf-access-client-secret': 'not-printed',
      })
    }
    expect(JSON.stringify(report)).not.toContain('not-printed')
    expect(formatVerifyReport(report)).not.toContain('not-printed')
  })

  it('fails closed on an unset variable and names it, not its value', () => {
    expect(() => resolveAccessHeaders(flags(ACCESS), { CF_ACCESS_ID: 'id.access' })).toThrow(
      'environment variable CF_ACCESS_SECRET is unset or empty',
    )
    expect(resolveAccessHeaders(flags(), {})).toBeUndefined()
  })

  it('treats a whitespace-only variable as empty', () => {
    expect(() =>
      resolveAccessHeaders(flags(ACCESS), { CF_ACCESS_ID: 'id.access', CF_ACCESS_SECRET: ' \t\n' }),
    ).toThrow('environment variable CF_ACCESS_SECRET is unset or empty')
  })

  it('adds the headers to the real probe request', async () => {
    const { createServer } = await import('node:http')
    let received: Record<string, unknown> = {}
    const server = createServer((request, response) => {
      received = request.headers
      response.end('ok')
    })
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
    const { port } = server.address() as { port: number }
    try {
      await createLiveProbe()(`http://127.0.0.1:${String(port)}/`, {
        headers: { 'cf-access-client-id': 'id.access' },
      })
    } finally {
      server.close()
    }
    expect(received['cf-access-client-id']).toBe('id.access')
  })
})
