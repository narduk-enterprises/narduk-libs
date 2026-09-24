/**
 * narduk-libs#783: a stale local NXDOMAIN must read as its own diagnosis, not as
 * a dead deployment, and `--resolver public` must be able to finish the proof.
 */
import { createServer as createHttpServer, type IncomingHttpHeaders } from 'node:http'
import { createServer as createTcpServer, type LookupFunction } from 'node:net'

import { afterEach, describe, expect, it } from 'vitest'

import {
  createDnsDiagnoser,
  createPinnedFetch,
  createPublicResolve,
  isNameResolutionFailure,
  MACOS_DNS_FLUSH,
  publicLookup,
  type PublicResolve,
} from '../src/live-dns.js'
import {
  createLiveProbe,
  transportErrorCode,
  type LiveProbe,
  type LiveResponse,
} from '../src/live-probe.js'
import {
  formatVerifyReport,
  parseVerifyArgs,
  runVerifyLive,
  VERIFY_EXIT,
} from '../src/verify-live.js'

const SHA = 'f736b07d7f49a1b2c3d4e5f60718293a4b5c6d7e'
const SHORT = 'f736b07d7f49'
const HOST = 'loadtest.dev'
const noSleep = async (): Promise<void> => {}

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()))
})

function healthBody(): string {
  return JSON.stringify({
    success: true,
    data: {
      status: 'ok',
      database: 'ok',
      checks: [{ name: 'publication', required: true, result: 'pass' }],
    },
  })
}

/** What getaddrinfo hands a socket when the system resolver has no address. */
function getaddrinfoError(hostname: string, code = 'ENOTFOUND'): NodeJS.ErrnoException {
  return Object.assign(new Error(`getaddrinfo ${code} ${hostname}`), {
    code,
    syscall: 'getaddrinfo',
    hostname,
  })
}

/** An injected system lookup that holds a negative answer for every name. */
const staleSystemLookup: LookupFunction = (hostname, _options, callback) => {
  callback(getaddrinfoError(hostname), '', 4)
}

/** The deployment, on loopback: the build header on every route, a healthy health route. */
async function serveDeployment(): Promise<{ port: number; hosts: IncomingHttpHeaders[] }> {
  const hosts: IncomingHttpHeaders[] = []
  const server = createHttpServer((request, response) => {
    hosts.push(request.headers)
    const path = new URL(request.url ?? '/', 'http://x').pathname
    if (path === '/old') {
      response.writeHead(308, { location: '/' })
      response.end()
      return
    }
    const isHealth = path === '/api/health'
    response.writeHead(200, {
      'x-build-version': SHORT,
      'content-type': isHealth ? 'application/json' : 'text/html; charset=utf-8',
    })
    response.end(isHealth ? healthBody() : '<!doctype html><title>ok</title>')
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  cleanups.push(
    () =>
      new Promise<void>((done) => {
        server.closeAllConnections()
        server.close(() => done())
      }),
  )
  return { port: (server.address() as { port: number }).port, hosts }
}

function counting(resolve: PublicResolve): { resolve: PublicResolve; asked: string[] } {
  const asked: string[] = []
  return {
    asked,
    resolve: async (hostname) => {
      asked.push(hostname)
      return resolve(hostname)
    },
  }
}

const unresolvable: LiveProbe = async (url) => ({
  url,
  error: 'fetch failed',
  errorCode: 'ENOTFOUND',
})

describe('transport error codes', () => {
  it('reads the code native fetch nests on cause', () => {
    const error = new TypeError('fetch failed', { cause: getaddrinfoError(HOST) })
    expect(transportErrorCode(error)).toBe('ENOTFOUND')
    expect(transportErrorCode(new Error('plain'))).toBeUndefined()
    expect(transportErrorCode(getaddrinfoError(HOST, 'EAI_AGAIN'))).toBe('EAI_AGAIN')
  })

  it('reports the nested code on the probe response', async () => {
    const probe = createLiveProbe({}, async () => {
      throw new TypeError('fetch failed', { cause: getaddrinfoError(HOST) })
    })
    const response = await probe(`https://${HOST}/`)
    expect(response).toMatchObject({ error: 'fetch failed', errorCode: 'ENOTFOUND' })
    expect(isNameResolutionFailure(response)).toBe(true)
    expect(isNameResolutionFailure({ url: '', error: 'x', errorCode: 'ECONNREFUSED' })).toBe(false)
  })
})

describe('stale local NXDOMAIN diagnosis', () => {
  it('turns a failed system lookup that public DNS answers into a distinct dns UNKNOWN', async () => {
    const { port } = await serveDeployment()
    const publicDns = counting(async () => ['127.0.0.1'])
    const report = await runVerifyLive(
      parseVerifyArgs([
        '--live',
        `http://${HOST}:${String(port)}`,
        '--expect-sha',
        SHA,
        '--attempts',
        '2',
      ]),
      {
        probe: createLiveProbe({}, createPinnedFetch(staleSystemLookup)),
        resolvePublic: publicDns.resolve,
        sleep: noSleep,
      },
    )
    expect(report.exitCode).toBe(VERIFY_EXIT.unreachable)
    const dns = report.assertions.filter((assertion) => assertion.id === 'dns')
    expect(dns).toHaveLength(1)
    expect(dns[0]).toMatchObject({
      status: 'unknown',
      exitCode: VERIFY_EXIT.unreachable,
      evidence: {
        hostname: HOST,
        localErrorCode: 'ENOTFOUND',
        publicResolvers: ['1.1.1.1', '8.8.8.8'],
        publicAddresses: ['127.0.0.1'],
      },
    })
    expect(dns[0]!.detail).toContain('local resolver has a stale negative answer')
    expect(dns[0]!.detail).toContain(MACOS_DNS_FLUSH)
    expect(dns[0]!.detail).toContain('--resolver public')
    // The per-route verdicts point at it instead of reading as a dead deployment.
    for (const id of ['build-version', 'health', 'smoke'] as const) {
      expect(report.assertions.find((assertion) => assertion.id === id)?.detail).toContain(
        'stale local DNS',
      )
    }
    // Public DNS is asked once per attempt, not once per probe.
    expect(publicDns.asked).toEqual([HOST, HOST])
    const text = formatVerifyReport(report)
    expect(text).toContain('[UNKN] dns: local resolver has a stale negative answer')
    expect(report.resolver).toBeUndefined()
  })

  it('stays a generic unreachable when public DNS has no address either', async () => {
    const report = await runVerifyLive(parseVerifyArgs(['--live', `https://${HOST}`]), {
      probe: unresolvable,
      resolvePublic: async () => [],
      sleep: noSleep,
    })
    expect(report.exitCode).toBe(VERIFY_EXIT.unreachable)
    expect(report.assertions.some((assertion) => assertion.id === 'dns')).toBe(false)
    expect(report.assertions.find((assertion) => assertion.id === 'health')?.detail).toContain(
      `has no address for ${HOST} either`,
    )
  })

  it('says so when public DNS cannot be asked', async () => {
    const report = await runVerifyLive(
      parseVerifyArgs(['--live', `https://${HOST}`, '--attempts', '1']),
      {
        probe: unresolvable,
        resolvePublic: async () => {
          throw new Error('queryA ETIMEOUT')
        },
      },
    )
    expect(report.assertions.some((assertion) => assertion.id === 'dns')).toBe(false)
    expect(report.assertions.find((assertion) => assertion.id === 'smoke')?.detail).toContain(
      'could not be asked either: queryA ETIMEOUT',
    )
  })

  it('never asks public DNS about a failure that is not name resolution', async () => {
    const publicDns = counting(async () => ['127.0.0.1'])
    const report = await runVerifyLive(
      parseVerifyArgs(['--live', `https://${HOST}`, '--attempts', '1']),
      {
        probe: async (url) => ({ url, error: 'fetch failed', errorCode: 'ECONNREFUSED' }),
        resolvePublic: publicDns.resolve,
      },
    )
    expect(publicDns.asked).toEqual([])
    expect(report.assertions.some((assertion) => assertion.id === 'dns')).toBe(false)
  })

  it('does not second-guess a failure that already came from public DNS', async () => {
    const diagnoser = createDnsDiagnoser({
      mode: 'public',
      exitCode: VERIFY_EXIT.unreachable,
      resolvePublic: async () => ['127.0.0.1'],
    })
    const response: LiveResponse = await diagnoser.wrap(unresolvable)(`https://${HOST}/`)
    expect(response.error).toBe('fetch failed')
    expect(diagnoser.annotate([])).toEqual([])
  })
})

describe('--resolver public', () => {
  it('parses the resolver mode and refuses anything else', () => {
    expect(parseVerifyArgs(['--live', `https://${HOST}`]).resolver).toBe('system')
    expect(parseVerifyArgs(['--live', `https://${HOST}`, '--resolver', 'public']).resolver).toBe(
      'public',
    )
    expect(() => parseVerifyArgs(['--live', `https://${HOST}`, '--resolver', '9.9.9.9'])).toThrow(
      '--resolver must be system or public',
    )
  })

  it('proves the SHA through the public answer, keeping the hostname in Host', async () => {
    const { port, hosts } = await serveDeployment()
    const publicDns = counting(async () => ['127.0.0.1'])
    const report = await runVerifyLive(
      parseVerifyArgs([
        '--live',
        `http://${HOST}:${String(port)}`,
        '--expect-sha',
        SHA,
        '--resolver',
        'public',
        '--attempts',
        '1',
      ]),
      { resolvePublic: publicDns.resolve },
    )
    expect(report.result).toBe('PASS')
    expect(report.exitCode).toBe(VERIFY_EXIT.pass)
    expect(report.resolver).toBe('public')
    expect(report.assertions.find((assertion) => assertion.id === 'build-version')).toMatchObject({
      status: 'pass',
      evidence: { actual: SHORT, expected: SHA },
    })
    expect(hosts.map((headers) => headers.host)).toEqual([
      `${HOST}:${String(port)}`,
      `${HOST}:${String(port)}`,
    ])
    expect(publicDns.asked.every((name) => name === HOST)).toBe(true)
    expect(formatVerifyReport(report)).toContain('resolver   public (1.1.1.1, 8.8.8.8)')
  })

  it('sends the real hostname as TLS SNI while dialing the public address', async () => {
    const hellos: Buffer[] = []
    const server = createTcpServer((socket) => {
      socket.once('data', (chunk: Buffer) => {
        hellos.push(chunk)
        socket.destroy()
      })
    })
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
    cleanups.push(() => new Promise<void>((done) => server.close(() => done())))
    const { port } = server.address() as { port: number }
    const fetchPinned = createPinnedFetch(publicLookup(async () => ['127.0.0.1']))
    await expect(fetchPinned(`https://${HOST}:${String(port)}/`)).rejects.toThrow('fetch failed')
    expect(hellos).toHaveLength(1)
    // The ClientHello's server_name extension carries the hostname in clear.
    expect(hellos[0]!.includes(Buffer.from(HOST))).toBe(true)
  })

  it('follows redirects like fetch and reports the final URL', async () => {
    const { port } = await serveDeployment()
    const probe = createLiveProbe({}, createPinnedFetch(publicLookup(async () => ['127.0.0.1'])))
    const response = await probe(`http://${HOST}:${String(port)}/old`)
    expect(response).toMatchObject({
      status: 200,
      redirected: true,
      finalUrl: `http://${HOST}:${String(port)}/`,
    })
    const manual = await probe(`http://${HOST}:${String(port)}/old`, { redirect: 'manual' })
    expect(manual.status).toBe(308)
  })

  it('answers both lookup shapes and filters by family', async () => {
    const lookup = publicLookup(async () => ['127.0.0.1', '::1'])
    const all = await new Promise((done) => {
      lookup(HOST, { all: true }, (_error, addresses) => done(addresses))
    })
    expect(all).toEqual([
      { address: '127.0.0.1', family: 4 },
      { address: '::1', family: 6 },
    ])
    const six = await new Promise((done) => {
      lookup(HOST, { family: 6 }, (_error, address, family) => done([address, family]))
    })
    expect(six).toEqual(['::1', 6])
    const none = await new Promise<NodeJS.ErrnoException | null>((done) => {
      publicLookup(async () => [])(HOST, {}, (error) => done(error))
    })
    expect(none?.code).toBe('ENOTFOUND')
  })

  it('builds a node:dns resolver without touching the network until asked', () => {
    expect(typeof createPublicResolve()).toBe('function')
  })
})
