import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer as createHttpServer, type IncomingMessage } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { connect as netConnect, type AddressInfo, type Server, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  createChallengeFallbackFetch,
  createChallengeFallbackProbe,
  createProxyFetch,
  EGRESS_PROXY_ENV,
  formatEgress,
  isCloudflareChallenge,
  resolveEgressProxy,
} from '../src/egress-fallback.js'
import { createLiveProbe, type FetchTransport, type LiveProbe } from '../src/live-probe.js'
import { formatVerifyReport, parseVerifyArgs, runVerifyLive } from '../src/verify-live.js'

const SHA = 'f736b07d7f49a1b2c3d4e5f60718293a4b5c6d7e'
const PROXY = 'http://10.70.0.63:1056'
const ENV = { [EGRESS_PROXY_ENV]: PROXY }
const CHALLENGE = { 'cf-mitigated': 'challenge', server: 'cloudflare' }

const healthBody = JSON.stringify({
  success: true,
  data: {
    status: 'ok',
    timestamp: '2026-10-13T00:00:00Z',
    database: 'ok',
    missingAuthTables: [],
    checks: [],
  },
})

/** A transport that answers by path and records every URL it was asked for. */
function scriptedTransport(
  answer: (url: URL) => { status: number; headers?: Record<string, string>; body?: string },
): { transport: FetchTransport; urls: string[] } {
  const urls: string[] = []
  const transport: FetchTransport = async (input) => {
    urls.push(input)
    const { status, headers = {}, body = '' } = answer(new URL(input))
    return new Response(body, { status, headers })
  }
  return { transport, urls }
}

describe('resolveEgressProxy', () => {
  it('reads an http proxy URL', () => {
    const proxy = resolveEgressProxy({ [EGRESS_PROXY_ENV]: ` ${PROXY} ` })
    expect(proxy.kind).toBe('ready')
    if (proxy.kind === 'ready') expect(proxy.url.host).toBe('10.70.0.63:1056')
  })

  it('treats an unset or blank variable as no proxy', () => {
    expect(resolveEgressProxy({})).toEqual({ kind: 'none' })
    expect(resolveEgressProxy({ [EGRESS_PROXY_ENV]: '   ' })).toEqual({ kind: 'none' })
  })

  it.each([
    ['an https proxy', 'https://user:hunter2@10.70.0.63:1056'],
    ['a socks proxy', 'socks5://user:hunter2@10.70.0.63:1056'],
    ['a proxy with a path', 'http://user:hunter2@10.70.0.63:1056/x'],
    ['not a URL', 'user:hunter2 10.70.0.63'],
  ])('is invalid for %s, and the reason never echoes the value', (_label, value) => {
    const proxy = resolveEgressProxy({ [EGRESS_PROXY_ENV]: value })
    expect(proxy.kind).toBe('invalid')
    if (proxy.kind === 'invalid') {
      expect(proxy.reason).toContain(EGRESS_PROXY_ENV)
      expect(proxy.reason).not.toContain('hunter2')
    }
  })
})

describe('isCloudflareChallenge', () => {
  it('is only a 403 with cf-mitigated: challenge', () => {
    expect(isCloudflareChallenge({ status: 403, headers: CHALLENGE })).toBe(true)
    expect(isCloudflareChallenge({ status: 403, headers: { 'cf-mitigated': 'Challenge' } })).toBe(
      true,
    )
    expect(isCloudflareChallenge({ status: 403, headers: {} })).toBe(false)
    expect(isCloudflareChallenge({ status: 403, headers: { 'cf-mitigated': 'block' } })).toBe(false)
    expect(isCloudflareChallenge({ status: 200, headers: CHALLENGE })).toBe(false)
    expect(isCloudflareChallenge({ status: 429, headers: CHALLENGE })).toBe(false)
    expect(isCloudflareChallenge({ status: 403 })).toBe(false)
    expect(isCloudflareChallenge({ status: 403, headers: new Headers(CHALLENGE) })).toBe(true)
  })
})

describe('the probe-level challenge fallback', () => {
  const ok = { status: 200, headers: { 'x-build-version': SHA.slice(0, 12) }, body: healthBody }

  it('retries a challenged request once through the proxy and tags the route', async () => {
    const direct = scriptedTransport(() => ({ status: 403, headers: CHALLENGE }))
    const proxy = scriptedTransport(() => ok)
    const fallback = createChallengeFallbackProbe({ env: ENV, proxyFetch: proxy.transport })
    const response = await fallback.wrap(createLiveProbe({}, direct.transport))(
      'https://harmonyhotsauce.com/api/health',
      { readBody: true },
    )
    expect(response.status).toBe(200)
    expect(response.egress).toBe('residential')
    expect(direct.urls).toHaveLength(1)
    expect(proxy.urls).toEqual(['https://harmonyhotsauce.com/api/health'])
    expect(fallback.summary()).toEqual({ route: 'residential', challenged: 1, retried: 1 })
  })

  it('sends nothing but the challenged request through the proxy', async () => {
    const direct = scriptedTransport((url) =>
      url.pathname === '/api/health' ? { status: 403, headers: CHALLENGE } : ok,
    )
    const proxy = scriptedTransport(() => ok)
    const fallback = createChallengeFallbackProbe({ env: ENV, proxyFetch: proxy.transport })
    const probe = fallback.wrap(createLiveProbe({}, direct.transport))
    const smoke = await probe('https://harmonyhotsauce.com/api/auth/runtime-public')
    const health = await probe('https://harmonyhotsauce.com/api/health')
    expect(smoke.egress).toBe('direct')
    expect(health.egress).toBe('residential')
    expect(proxy.urls).toEqual(['https://harmonyhotsauce.com/api/health'])
  })

  it('does not retry a 403 that is not a Cloudflare challenge', async () => {
    const direct = scriptedTransport(() => ({ status: 403, headers: { 'cf-mitigated': 'block' } }))
    const proxy = scriptedTransport(() => ok)
    const fallback = createChallengeFallbackProbe({ env: ENV, proxyFetch: proxy.transport })
    const response = await fallback.wrap(createLiveProbe({}, direct.transport))('https://a.test/')
    expect(response.status).toBe(403)
    expect(response.egress).toBe('direct')
    expect(proxy.urls).toEqual([])
    expect(fallback.summary()).toEqual({ route: 'direct', challenged: 0, retried: 0 })
  })

  it('does not retry any other failure: a 500, a 200 or a transport error', async () => {
    const proxy = scriptedTransport(() => ok)
    for (const answer of [500, 200, 'throw'] as const) {
      const direct: FetchTransport = async () => {
        if (answer === 'throw') throw new TypeError('fetch failed')
        return new Response('', { status: answer })
      }
      const fallback = createChallengeFallbackProbe({ env: ENV, proxyFetch: proxy.transport })
      await fallback.wrap(createLiveProbe({}, direct))('https://a.test/')
    }
    expect(proxy.urls).toEqual([])
  })

  it('fails closed with no proxy: the direct 403 comes back and the reason is recorded', async () => {
    const direct = scriptedTransport(() => ({ status: 403, headers: CHALLENGE }))
    const fallback = createChallengeFallbackProbe({ env: {} })
    const response = await fallback.wrap(createLiveProbe({}, direct.transport))('https://a.test/')
    expect(response.status).toBe(403)
    expect(response.egress).toBe('direct')
    const summary = fallback.summary()
    expect(summary.route).toBe('direct')
    expect(summary.retried).toBe(0)
    expect(summary.fallbackError).toContain(`${EGRESS_PROXY_ENV} is not set`)
  })

  it('fails closed with an invalid proxy URL, without echoing it', async () => {
    const direct = scriptedTransport(() => ({ status: 403, headers: CHALLENGE }))
    const fallback = createChallengeFallbackProbe({
      env: { [EGRESS_PROXY_ENV]: 'socks5://user:hunter2@10.70.0.63:1056' },
    })
    const response = await fallback.wrap(createLiveProbe({}, direct.transport))('https://a.test/')
    expect(response.status).toBe(403)
    expect(fallback.summary().fallbackError).toContain('must be an http://host:port')
    expect(JSON.stringify(fallback.summary())).not.toContain('hunter2')
  })

  it('fails closed when the proxy fails, and does not try again', async () => {
    const direct = scriptedTransport(() => ({ status: 403, headers: CHALLENGE }))
    let proxyCalls = 0
    const failing: FetchTransport = async () => {
      proxyCalls += 1
      throw new TypeError('fetch failed', {
        cause: Object.assign(new Error('proxy refused CONNECT: HTTP 403'), {
          code: 'EPROXYREFUSED',
        }),
      })
    }
    const fallback = createChallengeFallbackProbe({ env: ENV, proxyFetch: failing })
    const response = await fallback.wrap(createLiveProbe({}, direct.transport))('https://a.test/')
    expect(response.status).toBe(403)
    expect(response.egress).toBe('direct')
    expect(proxyCalls).toBe(1)
    expect(direct.urls).toHaveLength(1)
    const summary = fallback.summary()
    expect(summary.route).toBe('direct')
    expect(summary.retried).toBe(1)
    expect(summary.fallbackError).toContain('proxy refused CONNECT: HTTP 403')
  })

  it('reports a residential 403 as residential, and never loops', async () => {
    const direct = scriptedTransport(() => ({ status: 403, headers: CHALLENGE }))
    const proxy = scriptedTransport(() => ({ status: 403, headers: CHALLENGE }))
    const fallback = createChallengeFallbackProbe({ env: ENV, proxyFetch: proxy.transport })
    const response = await fallback.wrap(createLiveProbe({}, direct.transport))('https://a.test/')
    expect(response.status).toBe(403)
    expect(response.egress).toBe('residential')
    expect(proxy.urls).toHaveLength(1)
  })

  it('gives the retry only what is left of the deadline, and skips it when none is left', async () => {
    const direct = scriptedTransport(() => ({ status: 403, headers: CHALLENGE }))
    let signalSeen: AbortSignal | null | undefined
    const hanging: FetchTransport = (_url, init) =>
      new Promise((_resolve, reject) => {
        signalSeen = init?.signal
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      })
    const started = Date.now()
    const tight = createChallengeFallbackProbe({
      env: ENV,
      proxyFetch: hanging,
      remainingMs: () => 40,
    })
    const response = await tight.wrap(createLiveProbe({}, direct.transport))('https://a.test/', {
      timeoutMs: 15_000,
    })
    expect(Date.now() - started).toBeLessThan(2_000)
    expect(signalSeen?.aborted).toBe(true)
    expect(response.status).toBe(403)
    expect(tight.summary().fallbackError).toContain('aborted')

    const spent = createChallengeFallbackProbe({
      env: ENV,
      proxyFetch: hanging,
      remainingMs: () => 0,
    })
    const skipped = await spent.wrap(createLiveProbe({}, direct.transport))('https://a.test/')
    expect(skipped.status).toBe(403)
    expect(spent.summary().fallbackError).toContain('deadline')
  })
})

describe('narduk-app verify --live with the fallback', () => {
  const flags = parseVerifyArgs([
    '--live',
    'https://harmonyhotsauce.com',
    '--expect-sha',
    SHA,
    '--health-path',
    '/api/health',
    '--smoke-path',
    '/api/auth/runtime-public',
    '--attempts',
    '2',
  ])
  const noSleep = async (): Promise<void> => {}
  const challenged = (): LiveProbe =>
    createLiveProbe({}, scriptedTransport(() => ({ status: 403, headers: CHALLENGE })).transport)
  const proxyAnswer = scriptedTransport((url) => ({
    status: 200,
    headers: { 'x-build-version': SHA.slice(0, 12), 'content-type': 'text/html' },
    body: url.pathname === '/api/health' ? healthBody : '<html></html>',
  }))

  it('passes through the proxy and records egress: residential in the JSON and the text', async () => {
    proxyAnswer.urls.length = 0
    const report = await runVerifyLive(flags, {
      probe: challenged(),
      env: ENV,
      egressProxyFetch: proxyAnswer.transport,
      sleep: noSleep,
      cacheBustToken: (n) => `t${String(n)}`,
    })
    expect(report.result).toBe('PASS')
    expect(report.egress).toBe('residential')
    expect(JSON.parse(JSON.stringify(report)).egress).toBe('residential')
    expect(report.egressDetail).toMatchObject({ route: 'residential', challenged: 2, retried: 2 })
    expect(formatVerifyReport(report)).toContain('  egress     residential (')
    expect(proxyAnswer.urls.every((url) => url.startsWith('https://harmonyhotsauce.com/'))).toBe(
      true,
    )
  })

  it('fails as today with no proxy, and says why in the report', async () => {
    const report = await runVerifyLive(flags, {
      probe: challenged(),
      env: {},
      sleep: noSleep,
    })
    expect(report.result).toBe('FAIL')
    expect(report.egress).toBe('direct')
    expect(formatVerifyReport(report)).toContain(`${EGRESS_PROXY_ENV} is not set`)
  })

  it('fails when the proxy fails', async () => {
    const report = await runVerifyLive(flags, {
      probe: challenged(),
      env: ENV,
      egressProxyFetch: async () => {
        throw new TypeError('fetch failed')
      },
      sleep: noSleep,
    })
    expect(report.result).toBe('FAIL')
    expect(report.egress).toBe('direct')
    expect(report.egressDetail?.fallbackError).toContain('retry through')
  })

  it('records direct and leaves the report quiet when nothing was challenged', async () => {
    const report = await runVerifyLive(flags, {
      probe: createLiveProbe({}, proxyAnswer.transport),
      env: ENV,
      egressProxyFetch: async () => {
        throw new Error('the proxy must not be used')
      },
      sleep: noSleep,
    })
    expect(report.result).toBe('PASS')
    expect(report.egress).toBe('direct')
    expect(report.egressDetail).toBeUndefined()
    expect(formatVerifyReport(report)).toContain('  egress     direct\n')
  })
})

describe('the fetch-level fallback', () => {
  it('retries only a challenged call, once, and tags nothing else', async () => {
    const direct = scriptedTransport((url) =>
      url.hostname === 'harmonyhotsauce.com'
        ? { status: 403, headers: CHALLENGE }
        : { status: 302, headers: { location: 'https://appleid.apple.com/auth' } },
    )
    const proxy = scriptedTransport(() => ({ status: 200, body: 'ok' }))
    const guarded = createChallengeFallbackFetch({
      env: ENV,
      fetch: direct.transport,
      proxyFetch: proxy.transport,
    })
    const site = await guarded.fetch('https://harmonyhotsauce.com/api/auth/runtime-public', {})
    const idp = await guarded.fetch('https://xyz.supabase.co/auth/v1/authorize', {})
    expect(site.status).toBe(200)
    expect(idp.status).toBe(302)
    expect(proxy.urls).toEqual(['https://harmonyhotsauce.com/api/auth/runtime-public'])
    expect(guarded.summary()).toEqual({ route: 'residential', challenged: 1, retried: 1 })
  })

  it('returns the direct challenge when the proxy fails or is missing', async () => {
    const direct = scriptedTransport(() => ({ status: 403, headers: CHALLENGE }))
    const failing = createChallengeFallbackFetch({
      env: ENV,
      fetch: direct.transport,
      proxyFetch: async () => {
        throw new TypeError('fetch failed')
      },
    })
    expect((await failing.fetch('https://a.test/', {})).status).toBe(403)
    expect(failing.summary().route).toBe('direct')
    const none = createChallengeFallbackFetch({ env: {}, fetch: direct.transport })
    expect((await none.fetch('https://a.test/', {})).status).toBe(403)
    expect(none.summary().fallbackError).toContain('is not set')
  })
})

describe('the CONNECT tunnel transport', () => {
  const cleanup: Array<() => void> = []
  afterEach(() => {
    for (const close of cleanup.splice(0)) close()
  })

  function selfSignedLocalhost(): { cert: string; key: string } {
    const dir = mkdtempSync(join(tmpdir(), 'egress-tls-'))
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
    const result = spawnSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-days',
        '2',
        '-keyout',
        join(dir, 'k.pem'),
        '-out',
        join(dir, 'c.pem'),
        '-subj',
        '/CN=localhost',
        '-addext',
        'subjectAltName=DNS:localhost',
      ],
      { encoding: 'utf8' },
    )
    expect(result.status, result.stderr).toBe(0)
    return {
      cert: readFileSync(join(dir, 'c.pem'), 'utf8'),
      key: readFileSync(join(dir, 'k.pem'), 'utf8'),
    }
  }

  async function listen(server: Server): Promise<number> {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    cleanup.push(() => void server.close())
    return (server.address() as AddressInfo).port
  }

  async function startTarget(tls: {
    cert: string
    key: string
  }): Promise<{ port: number; requests: IncomingMessage[] }> {
    const requests: IncomingMessage[] = []
    const server = createHttpsServer(tls, (request, response) => {
      requests.push(request)
      response.writeHead(200, { 'content-type': 'text/plain', 'x-build-version': 'abc' })
      response.end(`hello ${request.url ?? ''}`)
    })
    const port = await listen(server)
    return { port, requests }
  }

  /** A CONNECT proxy: records each CONNECT and either tunnels it or refuses with `refuse`. */
  async function startProxy(options: { refuse?: number } = {}): Promise<{
    port: number
    connects: Array<{ authority: string; authorization?: string }>
    plain: number
  }> {
    const connects: Array<{ authority: string; authorization?: string }> = []
    const state = { plain: 0 }
    const server = createHttpServer((_request, response) => {
      state.plain += 1
      response.writeHead(405).end()
    })
    server.on('connect', (request, client: Socket) => {
      const authority = request.url ?? ''
      connects.push({ authority, authorization: request.headers['proxy-authorization'] })
      if (options.refuse) {
        client.end(`HTTP/1.1 ${String(options.refuse)} Forbidden\r\ncontent-length: 0\r\n\r\n`)
        return
      }
      const port = Number(authority.split(':').pop())
      const upstream = netConnect(port, '127.0.0.1', () => {
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
        upstream.pipe(client)
        client.pipe(upstream)
      })
      upstream.on('error', () => client.destroy())
      client.on('error', () => upstream.destroy())
    })
    const port = await listen(server)
    return {
      port,
      connects,
      get plain() {
        return state.plain
      },
    }
  }

  it('tunnels a request with CONNECT, does TLS to the real host, and follows no plain-HTTP path', async () => {
    const tls = selfSignedLocalhost()
    const target = await startTarget(tls)
    const proxy = await startProxy()
    const send = createProxyFetch(new URL(`http://127.0.0.1:${String(proxy.port)}`), {
      ca: tls.cert,
    })
    const response = await send(`https://localhost:${String(target.port)}/api/health?x=1`, {
      headers: { 'user-agent': 'probe' },
    })
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('hello /api/health?x=1')
    expect(response.headers.get('x-build-version')).toBe('abc')
    expect(proxy.connects).toEqual([
      { authority: `localhost:${String(target.port)}`, authorization: undefined },
    ])
    expect(proxy.plain).toBe(0)
    expect(target.requests[0]?.headers['user-agent']).toBe('probe')
    expect(target.requests[0]?.headers.host).toBe(`localhost:${String(target.port)}`)
  })

  it('sends proxy credentials as Proxy-Authorization, to the proxy only', async () => {
    const tls = selfSignedLocalhost()
    const target = await startTarget(tls)
    const proxy = await startProxy()
    const send = createProxyFetch(new URL(`http://user:p%40ss@127.0.0.1:${String(proxy.port)}`), {
      ca: tls.cert,
    })
    await send(`https://localhost:${String(target.port)}/`, {})
    expect(proxy.connects[0]?.authorization).toBe(
      `Basic ${Buffer.from('user:p@ss').toString('base64')}`,
    )
    expect(target.requests[0]?.headers['proxy-authorization']).toBeUndefined()
  })

  it('verifies the target certificate over the tunnel', async () => {
    const tls = selfSignedLocalhost()
    const target = await startTarget(tls)
    const proxy = await startProxy()
    const send = createProxyFetch(new URL(`http://127.0.0.1:${String(proxy.port)}`))
    await expect(send(`https://localhost:${String(target.port)}/`, {})).rejects.toThrow(
      'fetch failed',
    )
  })

  it('fails when the proxy refuses the CONNECT', async () => {
    const proxy = await startProxy({ refuse: 403 })
    const send = createProxyFetch(new URL(`http://127.0.0.1:${String(proxy.port)}`))
    const probe = createLiveProbe({}, send)
    const result = await probe('https://example.com/')
    expect(result.error).toBeDefined()
    expect(result.status).toBeUndefined()
    expect(proxy.connects).toEqual([{ authority: 'example.com:443', authorization: undefined }])
  })

  it('refuses a plain-http target, so the proxy only ever carries https', async () => {
    const proxy = await startProxy()
    const probe = createLiveProbe(
      {},
      createProxyFetch(new URL(`http://127.0.0.1:${String(proxy.port)}`)),
    )
    const result = await probe('http://example.com/')
    expect(result.error).toBeDefined()
    expect(proxy.connects).toEqual([])
    expect(proxy.plain).toBe(0)
  })

  it('reports an unreachable proxy as an error, not an answer', async () => {
    const probe = createLiveProbe({}, createProxyFetch(new URL('http://127.0.0.1:9')))
    const result = await probe('https://example.com/', { timeoutMs: 2_000 })
    expect(result.error).toBeDefined()
  })
})

describe('formatEgress', () => {
  it('says what happened without naming the proxy URL', () => {
    expect(formatEgress({ route: 'direct', challenged: 0, retried: 0 })).toBe('direct')
    expect(formatEgress({ route: 'residential', challenged: 2, retried: 2 })).toContain(
      'retried once through NARDUK_APP_EGRESS_PROXY',
    )
    expect(
      formatEgress({ route: 'direct', challenged: 1, retried: 0, fallbackError: 'is not set' }),
    ).toBe('direct (Cloudflare challenged 1 request(s); is not set)')
  })
})
