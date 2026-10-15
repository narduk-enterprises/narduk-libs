import { rmSync } from 'node:fs'

import { afterEach, describe, expect, it } from 'vitest'

import {
  formatAdoptionSummary,
  runAdoptionCheck,
  type AdoptionArtefact,
} from '../../src/foundation/evaluate-adoption.js'
import type { FetchTransport } from '../../src/live-probe.js'
import { makeTempRepo } from './helpers.js'
import {
  CONFORMANT_HEADERS,
  NO_ALERTS,
  SHA,
  TOOL_VERSION,
  baselineReality,
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
  extra: { env?: Record<string, string>; proxy?: FetchTransport } = {},
): Promise<AdoptionArtefact> {
  const root = makeTempRepo()
  tempDirs.push(root)
  writeAdoptionBaseline(root)
  return runAdoptionCheck({
    dependabotReality: NO_ALERTS,
    egressProxyFetch: extra.proxy,
    env: extra.env ?? {},
    expectSha: SHA,
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
})
