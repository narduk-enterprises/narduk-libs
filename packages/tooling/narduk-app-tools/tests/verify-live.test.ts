import { describe, expect, it } from 'vitest'

import { createLiveProbe, type LiveProbe, type LiveResponse } from '../src/live-probe.js'
import {
  assessHealth,
  assessOrigin,
  buildVersionMatches,
  cacheBustedUrl,
  formatVerifyReport,
  parseVerifyArgs,
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
    headers: { 'content-type': 'application/json' },
    body: healthBody('ok', [{ name: 'publication', required: true, result: 'pass' }]),
  }

  it('passes on the first attempt when all three assertions hold', async () => {
    const { probe } = scriptedProbe({ '/': okHead, '/api/health': okHealth })
    const report = await runVerifyLive(flags(), { probe, sleep: noSleep })
    expect(report.result).toBe('PASS')
    expect(report.exitCode).toBe(VERIFY_EXIT.pass)
    expect(report.attemptsUsed).toBe(1)
    expect(report.assertions.map((a) => a.id)).toEqual(['build-version', 'smoke', 'health'])
    expect(formatVerifyReport(report)).toContain('RESULT: PASS')
  })

  it('retries a propagation delay and then passes', async () => {
    const stale: LiveResponse = {
      url: '',
      status: 200,
      headers: { 'x-build-version': 'aaaaaaaaaaaa', 'content-type': 'text/html' },
    }
    const { probe } = scriptedProbe({ '/': [stale, stale, okHead], '/api/health': okHealth })
    const report = await runVerifyLive(flags(['--attempts', '4']), { probe, sleep: noSleep })
    expect(report.result).toBe('PASS')
    expect(report.attemptsUsed).toBe(3)
  })

  it('exits 3 on a build version that never becomes the expected one', async () => {
    const stale: LiveResponse = {
      url: '',
      status: 200,
      headers: { 'x-build-version': 'aaaaaaaaaaaa', 'content-type': 'text/html' },
    }
    const { probe } = scriptedProbe({ '/': stale, '/api/health': okHealth })
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
      headers: { 'content-type': 'application/json' },
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
  headers: { 'content-type': 'application/json' },
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
      '/': [
        {
          url: '',
          status: 200,
          headers: { 'x-build-version': 'deadbee', 'content-type': 'text/html' },
        },
        {
          url: '',
          status: 200,
          headers: { 'x-build-version': SHORT, 'content-type': 'text/html' },
        },
      ],
      '/api/health': HEALTHY,
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
