import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  formatAdoptionSummary,
  runAdoptionCheck,
  type AdoptionArtefact,
  type LiveRetry,
} from '../../src/foundation/evaluate-adoption.js'
import type { FetchTransport } from '../../src/live-probe.js'
import { CACHE_BUST_PARAM } from '../../src/verify-live.js'
import { makeTempRepo, writeJson } from './helpers.js'
import {
  CONFORMANT_HEADERS,
  NO_ALERTS,
  SHA,
  TOOL_VERSION,
  baselineReality,
  fakeHeaderProbe,
  writeAdoptionBaseline,
} from './adoption-fixture.js'

const tempDirs: string[] = []
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

const PROXY_ENV = { NARDUK_APP_EGRESS_PROXY: 'http://proxy.test:3128' }

function healthy(url: string): Response {
  const headers = { ...CONFORMANT_HEADERS, 'x-build-version': '48ba389bdb1b' }
  return url.endsWith('/api/health')
    ? new Response('{}', { status: 200 })
    : new Response('<html></html>', { headers, status: 200 })
}

const challenge = (): Response =>
  new Response('challenge', { headers: { 'cf-mitigated': 'challenge' }, status: 403 })

function recording(answer: (url: string) => Response) {
  const calls: string[] = []
  const transport: FetchTransport = async (url) => {
    calls.push(url)
    return answer(url)
  }
  return { calls, transport }
}

async function run(
  direct: FetchTransport,
  extra: {
    env?: Record<string, string>
    expectSha?: string | null
    headerProbe?: boolean
    liveProof?: { attempts: number; intervalSeconds: number }
    proxy?: FetchTransport
    retry?: Partial<LiveRetry>
  } = {},
): Promise<AdoptionArtefact> {
  const root = makeTempRepo()
  tempDirs.push(root)
  writeAdoptionBaseline(root)
  if (extra.liveProof) {
    const path = join(root, 'Config', 'cloudflare-app.json')
    const config = JSON.parse(readFileSync(path, 'utf8')) as {
      deployment: { liveProof: Record<string, unknown> }
    }
    config.deployment.liveProof = { ...config.deployment.liveProof, ...extra.liveProof }
    writeJson(root, 'Config/cloudflare-app.json', config)
  }
  return runAdoptionCheck({
    dependabotReality: NO_ALERTS,
    egressProxyFetch: extra.proxy,
    env: extra.env ?? {},
    ...(extra.expectSha === null ? {} : { expectSha: extra.expectSha ?? SHA }),
    ...(extra.headerProbe ? { headerProbe: fakeHeaderProbe } : {}),
    liveRetry: extra.retry ?? { attempts: 1 },
    liveTransport: direct,
    liveUrl: 'https://buoystat.us',
    reality: baselineReality(),
    root,
    toolVersion: TOOL_VERSION,
  })
}

const req = (artefact: AdoptionArtefact, id: string) =>
  artefact.requirements.find((r) => r.id === id)!

describe('doctor --adoption --live egress fallback', () => {
  it('passes direct and records egress direct when nothing is challenged', async () => {
    const direct = recording(healthy)
    const artefact = await run(direct.transport, { env: PROXY_ENV })

    expect(artefact.live?.egress).toBe('direct')
    expect(artefact.live?.egressDetail).toBeUndefined()
    expect(req(artefact, 'R5').verdict).toBe('pass')
    expect(req(artefact, 'R8').verdict).toBe('pass')
    expect(req(artefact, 'R12').verdict).toBe('pass')
    expect(formatAdoptionSummary(artefact)).toContain('egress     direct')
  })

  it('retries a challenge once through the proxy and passes, recording residential', async () => {
    const direct = recording(challenge)
    const proxy = recording(healthy)
    const artefact = await run(direct.transport, { env: PROXY_ENV, proxy: proxy.transport })

    expect(artefact.live?.egress).toBe('residential')
    expect(artefact.live?.egressDetail?.retried).toBe(3)
    expect(req(artefact, 'R5').verdict).toBe('pass')
    expect(req(artefact, 'R8').verdict).toBe('pass')
    expect(req(artefact, 'R12').verdict).toBe('pass')
    expect(proxy.calls).toHaveLength(3)
    expect(formatAdoptionSummary(artefact)).toContain('egress     residential')
  })

  it('reports UNKNOWN, never FAIL, for a challenge with no proxy', async () => {
    const direct = recording(challenge)
    const artefact = await run(direct.transport)

    expect(artefact.live?.egress).toBe('direct')
    expect(artefact.live?.buildVersion).toBeNull()
    for (const id of ['R5', 'R8', 'R12']) expect(req(artefact, id).verdict).toBe('unknown')
    expect(req(artefact, 'R5').detail).toContain('Cloudflare challenge')
    expect(artefact.requirements.filter((r) => r.verdict === 'fail')).toEqual([])
    expect(artefact.result).toBe('UNKNOWN')
    expect(formatAdoptionSummary(artefact)).toContain('NARDUK_APP_EGRESS_PROXY is not set')
  })

  it('reports UNKNOWN, never FAIL, when the proxy itself fails', async () => {
    const direct = recording(challenge)
    const proxy: FetchTransport = async () => {
      throw new Error('proxy refused CONNECT: HTTP 502')
    }
    const artefact = await run(direct.transport, { env: PROXY_ENV, proxy })

    expect(artefact.live?.egress).toBe('direct')
    expect(artefact.live?.egressDetail?.fallbackError).toContain('proxy refused CONNECT')
    for (const id of ['R5', 'R8', 'R12']) expect(req(artefact, id).verdict).toBe('unknown')
    expect(artefact.requirements.filter((r) => r.verdict === 'fail')).toEqual([])
  })

  it('re-reads a stale build stamp before grading R5', async () => {
    let reads = 0
    const direct = recording((url) => {
      if (url.endsWith('/api/health')) return healthy(url)
      reads += 1
      const response = healthy(url)
      if (reads >= 3) return response
      return new Response('', { headers: { 'x-build-version': 'e4df9478b4c5' }, status: 200 })
    })
    const artefact = await run(direct.transport, { retry: { attempts: 5, intervalMs: 0 } })

    expect(req(artefact, 'R5').verdict).toBe('pass')
  })

  it('grades FAIL once a stale stamp outlasts every attempt', async () => {
    const direct = recording((url) =>
      url.endsWith('/api/health')
        ? healthy(url)
        : new Response('', { headers: { 'x-build-version': 'e4df9478b4c5' }, status: 200 }),
    )
    const artefact = await run(direct.transport, { retry: { attempts: 2, intervalMs: 0 } })

    expect(req(artefact, 'R5').verdict).toBe('fail')
    expect(req(artefact, 'R5').detail).toBe(
      'live https://buoystat.us/ serves e4df9478b4c5, which is NOT the expected commit',
    )
  })
})

const OLD = 'e4df9478b4c5'
const FRESH = '48ba389bdb1b'

/** Smoke-route answers in order. Health is always 200 and is not a smoke read.
 * The header probe is injected, so this transport sees only R5 and R12. */
function stamped(stamps: readonly string[]) {
  const urls: string[] = []
  let smokeReads = 0
  const transport: FetchTransport = async (url) => {
    urls.push(url)
    if (new URL(url).pathname === '/api/health') return new Response('{}', { status: 200 })
    const stamp = stamps[Math.min(smokeReads, stamps.length - 1)] ?? OLD
    smokeReads += 1
    return new Response('<html></html>', {
      headers: { 'x-build-version': stamp },
      status: 200,
    })
  }
  const smokeUrls = () => urls.filter((url) => new URL(url).pathname !== '/api/health')
  return { smokeUrls, transport }
}

describe('R5 propagation retry (verify --attempts)', () => {
  it('passes R5 when the first smoke read is stale and the next is the expected build', async () => {
    const live = stamped([OLD, FRESH])
    const artefact = await run(live.transport, {
      headerProbe: true,
      retry: {
        attempts: 4,
        cacheBustToken: (attempt) => `attempt-${String(attempt)}`,
        intervalMs: 0,
      },
    })

    expect(req(artefact, 'R5').verdict).toBe('pass')
    expect(req(artefact, 'R5').detail).toBe(
      `live https://buoystat.us/ serves ${FRESH}, which is the expected commit`,
    )
    const smoke = live.smokeUrls()
    expect(smoke).toHaveLength(2)
    const [first, second] = smoke
    expect(first && new URL(first).searchParams.get(CACHE_BUST_PARAM)).toBe('attempt-1')
    expect(second && new URL(second).searchParams.get(CACHE_BUST_PARAM)).toBe('attempt-2')
    expect(req(artefact, 'R5').detail).not.toContain(CACHE_BUST_PARAM)
  })

  it('fails R5 with the same detail when every read stays on the previous build', async () => {
    const live = stamped([OLD])
    const artefact = await run(live.transport, {
      headerProbe: true,
      retry: { attempts: 3, cacheBustToken: (n) => `t${String(n)}`, intervalMs: 0 },
    })

    expect(req(artefact, 'R5').verdict).toBe('fail')
    expect(req(artefact, 'R5').detail).toBe(
      `live https://buoystat.us/ serves ${OLD}, which is NOT the expected commit`,
    )
    expect(live.smokeUrls()).toHaveLength(3)
    expect(artefact.result).toBe('FAIL')
  })

  it('does not pass R5 because the health route already serves the expected commit', async () => {
    const urls: string[] = []
    const transport: FetchTransport = async (url) => {
      urls.push(url)
      if (new URL(url).pathname === '/api/health') {
        return new Response('{}', { headers: { 'x-build-version': FRESH }, status: 200 })
      }
      return new Response('<html></html>', {
        headers: { 'x-build-version': OLD },
        status: 200,
      })
    }
    const artefact = await run(transport, {
      headerProbe: true,
      retry: { attempts: 2, intervalMs: 0 },
    })

    expect(req(artefact, 'R5').verdict).toBe('fail')
    expect(req(artefact, 'R5').detail).toContain('NOT the expected commit')
    expect(urls.filter((url) => new URL(url).pathname !== '/api/health')).toHaveLength(2)
  })

  it('reads the smoke route once, with no cache bust, when no expected commit is given', async () => {
    const live = stamped([OLD])
    const artefact = await run(live.transport, {
      expectSha: null,
      headerProbe: true,
      retry: { attempts: 4, cacheBustToken: () => 'should-not-appear', intervalMs: 0 },
    })

    expect(live.smokeUrls()).toEqual(['https://buoystat.us/'])
    expect(req(artefact, 'R5').verdict).toBe('unknown')
    expect(req(artefact, 'R5').detail).toContain('no --expect-sha')
  })

  it('uses the declared liveProof attempts, the same number verify --attempts is given', async () => {
    const live = stamped([OLD])
    const artefact = await run(live.transport, {
      headerProbe: true,
      liveProof: { attempts: 3, intervalSeconds: 10 },
      retry: { cacheBustToken: (n) => `t${String(n)}`, intervalMs: 0 },
    })

    expect(req(artefact, 'R5').verdict).toBe('fail')
    expect(live.smokeUrls()).toHaveLength(3)
  })

  it('stops at the verify deadline even when attempts remain', async () => {
    let clock = 0
    const live = stamped([OLD])
    const artefact = await run(live.transport, {
      headerProbe: true,
      retry: {
        attempts: 6,
        deadlineMs: 15_000,
        intervalMs: 10_000,
        now: () => clock,
        sleep: async (ms) => {
          clock += ms
        },
      },
    })

    expect(req(artefact, 'R5').verdict).toBe('fail')
    // One read, sleep 10s, second read, then the remaining 5s of the deadline
    // is not enough for another full wait: the loop stops the way verify does.
    expect(live.smokeUrls()).toHaveLength(2)
    expect(clock).toBe(15_000)
  })
})
