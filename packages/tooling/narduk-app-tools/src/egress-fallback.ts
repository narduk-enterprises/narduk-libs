/**
 * The challenge fallback for live proofs (harmony-hot-sauce#148).
 *
 * The deploy runners sit on a Hetzner address. Cloudflare Bot Fight Mode on a
 * client's Free-plan zone answers that address with `403` and
 * `cf-mitigated: challenge` for every request, while a workstation and Workers
 * Builds get `200`. A live proof run from the runner then fails on a good
 * release and, under the standard, rolls it back.
 *
 * The estate already has a fail-closed residential egress: a forward proxy on
 * the fleet's CT 630 whose traffic leaves through Logan's residential tailnet
 * exit nodes (fleet `infrastructure/proxmox/data-egress`, narduk-data's
 * `egress_fallback: residential`). This module is the client half of that
 * pattern for `narduk-app` proofs.
 *
 * THE RULE
 * --------
 * Only a request that was answered `403` with `cf-mitigated: challenge` is
 * retried, once, through the proxy named by `NARDUK_APP_EGRESS_PROXY`
 * (`http://host:port`, an HTTP CONNECT proxy). Every other request, and every
 * other answer, stays direct. Nothing is retried in a loop, and the proxy is
 * never the first route.
 *
 * FAILS CLOSED
 * ------------
 * With no proxy set, an invalid one, a refused CONNECT, a timeout or a
 * transport error, the caller gets the original direct `403` back, so the
 * proof fails exactly as it did before this module existed. The reason is
 * recorded (`fallbackError`), never swallowed, and the proxy URL is never
 * echoed: it may carry credentials.
 *
 * WHAT IT RECORDS
 * ---------------
 * `egress: 'direct' | 'residential'`: `residential` when at least one request
 * of the run went through the proxy. It proves which route answered. It does not
 * prove that the proxy's exit is residential: that is the proxy's own contract
 * (fleet `data-egress/README.md`).
 */

import { request as httpRequest } from 'node:http'
import { Agent as HttpsAgent, request as httpsRequest } from 'node:https'
import { isIP, type Socket } from 'node:net'
import { connect as tlsConnect } from 'node:tls'

import { bareHostname, createNodeFetch, plainHeaders, type SendOnce } from './live-dns.js'
import {
  createLiveProbe,
  DEFAULT_LIVE_TIMEOUT_MS,
  type FetchTransport,
  type LiveProbe,
  type LiveProbeOptions,
} from './live-probe.js'

/** The environment variable holding the proxy URL. */
export const EGRESS_PROXY_ENV = 'NARDUK_APP_EGRESS_PROXY'

export type EgressRoute = 'direct' | 'residential'

export type EgressProxy =
  { kind: 'none' } | { kind: 'ready'; url: URL } | { kind: 'invalid'; reason: string }

/**
 * Read the proxy from the environment. Only a plain `http://host[:port]` URL is
 * accepted: the proxy speaks CONNECT over plain HTTP, and anything else
 * (`https:`, `socks5:`, a path, a typo) is `invalid`, which behaves as no proxy
 * and says why. The reason never contains the value.
 */
export function resolveEgressProxy(
  env: Record<string, string | undefined> = process.env,
): EgressProxy {
  const raw = env[EGRESS_PROXY_ENV]?.trim()
  if (!raw) return { kind: 'none' }
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { kind: 'invalid', reason: `${EGRESS_PROXY_ENV} is not a URL` }
  }
  if (url.protocol !== 'http:') {
    return {
      kind: 'invalid',
      reason: `${EGRESS_PROXY_ENV} must be an http://host:port CONNECT proxy, not ${url.protocol}`,
    }
  }
  if ((url.pathname !== '/' && url.pathname !== '') || url.search !== '' || url.hash !== '') {
    return {
      kind: 'invalid',
      reason: `${EGRESS_PROXY_ENV} must be http://host:port with no path, query or fragment`,
    }
  }
  return { kind: 'ready', url }
}

/** The one answer that triggers the fallback: Cloudflare's managed challenge. */
export function isCloudflareChallenge(answer: {
  status?: number
  headers?: Record<string, string> | Headers
}): boolean {
  if (answer.status !== 403 || !answer.headers) return false
  const value =
    answer.headers instanceof Headers
      ? answer.headers.get('cf-mitigated')
      : answer.headers['cf-mitigated']
  return value?.trim().toLowerCase() === 'challenge'
}

function openTunnel(
  proxy: URL,
  target: URL,
  signal: AbortSignal | null | undefined,
): Promise<Socket> {
  const authority = `${bareHostname(target)}:${target.port || '443'}`
  const headers: Record<string, string> = { host: authority }
  if (proxy.username) {
    const credentials = `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`
    headers['proxy-authorization'] = `Basic ${Buffer.from(credentials).toString('base64')}`
  }
  return new Promise((resolve, reject) => {
    const connect = httpRequest({
      host: bareHostname(proxy),
      port: proxy.port || 80,
      method: 'CONNECT',
      path: authority,
      headers,
      agent: false,
      signal: signal ?? undefined,
    })
    connect.once('connect', (response, socket) => {
      if (response.statusCode !== 200) {
        socket.destroy()
        reject(
          Object.assign(new Error(`proxy refused CONNECT: HTTP ${String(response.statusCode)}`), {
            code: 'EPROXYREFUSED',
          }),
        )
        return
      }
      resolve(socket)
    })
    connect.once('error', reject)
    connect.end()
  })
}

function sendThroughProxy(proxy: URL, options: { ca?: string | Buffer }): SendOnce {
  return async (url, init) => {
    if (url.protocol !== 'https:') {
      throw Object.assign(new Error('the egress proxy carries https targets only'), {
        code: 'EPROXYSCHEME',
      })
    }
    const tunnel = await openTunnel(proxy, url, init.signal)
    const hostname = bareHostname(url)
    const secure = tlsConnect({
      socket: tunnel,
      servername: isIP(hostname) ? undefined : hostname,
      ca: options.ca,
    })
    return new Promise((resolve, reject) => {
      const fail = (error: Error): void => {
        secure.destroy()
        reject(error)
      }
      const outgoing = httpsRequest(
        {
          protocol: url.protocol,
          hostname,
          port: url.port || undefined,
          path: `${url.pathname}${url.search}`,
          method: init.method ?? 'GET',
          headers: { ...plainHeaders(init), host: url.host },
          // An agent whose only connection is the tunnel: `agent: false` would build
          // a fresh agent that dials the target directly and bypass the proxy.
          agent: Object.assign(new HttpsAgent(), { createConnection: () => secure }),
          signal: init.signal ?? undefined,
        },
        (message) => {
          const chunks: Buffer[] = []
          message.on('data', (chunk: Buffer) => chunks.push(chunk))
          message.on('end', () => {
            secure.destroy()
            resolve({ message, body: Buffer.concat(chunks) })
          })
          message.on('error', fail)
        },
      )
      outgoing.on('error', fail)
      secure.on('error', fail)
      outgoing.end(typeof init.body === 'string' ? init.body : undefined)
    })
  }
}

/**
 * A fetch that tunnels every request through `proxy` with HTTP CONNECT and does
 * TLS to the real host over the tunnel (SNI and the certificate check use the
 * real hostname). https targets only. `ca` exists for tests that run their own
 * TLS server; production uses the system roots.
 */
export function createProxyFetch(
  proxy: URL,
  options: { ca?: string | Buffer } = {},
): FetchTransport {
  return createNodeFetch(sendThroughProxy(proxy, options))
}

/** What a run did, for the report. */
export interface EgressSummary {
  /** `residential` when any request of the run went through the proxy. */
  route: EgressRoute
  /** Requests Cloudflare answered with a managed challenge on the direct route. */
  challenged: number
  /** Of those, the requests retried through the proxy. */
  retried: number
  /** Why a challenged request was not answered through the proxy, last one wins. */
  fallbackError?: string
}

function describeFailure(error: unknown): string {
  const cause = (error as { cause?: unknown } | null)?.cause
  const inner = cause instanceof Error ? cause : error
  const message = inner instanceof Error ? inner.message : String(inner)
  const code = (inner as { code?: unknown } | null)?.code
  return typeof code === 'string' && !message.includes(code) ? `${message} (${code})` : message
}

class FallbackState {
  private challenged = 0
  private retried = 0
  private residential = false
  private fallbackError: string | undefined
  private lastTransportError: unknown
  private cachedProxy: FetchTransport | undefined
  readonly proxy: EgressProxy

  constructor(
    env: Record<string, string | undefined>,
    private readonly proxyFetch: FetchTransport | undefined,
  ) {
    this.proxy = resolveEgressProxy(env)
  }

  reset(): void {
    this.challenged = 0
    this.retried = 0
    this.residential = false
    this.fallbackError = undefined
    this.lastTransportError = undefined
  }

  /** The transport for the retry, or null with the reason recorded. */
  transport(): FetchTransport | null {
    if (this.proxy.kind === 'ready') {
      this.cachedProxy ??= this.proxyFetch ?? createProxyFetch(this.proxy.url)
      const inner = this.cachedProxy
      // createLiveProbe reports only "fetch failed"; keep the cause for the report.
      return async (url, init) => {
        try {
          return await inner(url, init)
        } catch (error) {
          this.lastTransportError = error
          throw error
        }
      }
    }
    this.fallbackError =
      this.proxy.kind === 'invalid'
        ? `${this.proxy.reason}; the challenged request was not retried`
        : `${EGRESS_PROXY_ENV} is not set; the challenged request was not retried`
    return null
  }

  noteChallenge(): void {
    this.challenged += 1
  }

  noteRetry(answered: boolean, error?: unknown): void {
    this.retried += 1
    if (answered) this.residential = true
    else {
      const cause = this.lastTransportError ?? error
      this.fallbackError = `retry through ${EGRESS_PROXY_ENV} failed: ${describeFailure(cause)}`
    }
  }

  summary(): EgressSummary {
    return {
      route: this.residential ? 'residential' : 'direct',
      challenged: this.challenged,
      retried: this.retried,
      ...(this.fallbackError ? { fallbackError: this.fallbackError } : {}),
    }
  }
}

export interface ChallengeFallbackOptions {
  /** Where the proxy variable is read from; `process.env` by default. */
  env?: Record<string, string | undefined>
  /** Injected in tests: the transport used for the retry instead of a real CONNECT tunnel. */
  proxyFetch?: FetchTransport
  /**
   * Milliseconds left in the caller's overall budget. The retry gets at most
   * this long and is skipped when it is spent, so the fallback cannot push a
   * proof past its deadline.
   */
  remainingMs?: () => number
}

export interface ChallengeFallbackProbe {
  /** Wrap a probe: a Cloudflare challenge is retried once through the proxy. */
  wrap: (probe: LiveProbe) => LiveProbe
  /** Forget what the previous attempt did. */
  reset: () => void
  summary: () => EgressSummary
}

/**
 * The probe-level fallback `narduk-app verify --live` uses. Every response is
 * tagged with the route that produced it (`egress`).
 */
export function createChallengeFallbackProbe(
  options: ChallengeFallbackOptions = {},
): ChallengeFallbackProbe {
  const state = new FallbackState(options.env ?? process.env, options.proxyFetch)
  return {
    reset: () => state.reset(),
    summary: () => state.summary(),
    wrap:
      (direct) =>
      async (url, probeOptions = {}) => {
        const first = await direct(url, probeOptions)
        if (!isCloudflareChallenge(first)) return { ...first, egress: 'direct' }
        state.noteChallenge()
        const transport = state.transport()
        if (!transport) return { ...first, egress: 'direct' }
        const budget = options.remainingMs?.()
        if (budget !== undefined && budget <= 0) {
          state.noteRetry(false, new Error('the overall deadline was already spent'))
          return { ...first, egress: 'direct' }
        }
        const timeoutMs = Math.min(
          probeOptions.timeoutMs ?? DEFAULT_LIVE_TIMEOUT_MS,
          budget ?? Number.POSITIVE_INFINITY,
        )
        const retried: LiveProbeOptions = { ...probeOptions, timeoutMs }
        const second = await createLiveProbe({}, transport)(url, retried)
        if (second.error !== undefined) {
          state.noteRetry(false, new Error(second.error))
          return { ...first, egress: 'direct' }
        }
        state.noteRetry(true)
        return { ...second, egress: 'residential' }
      },
  }
}

export interface ChallengeFallbackFetch {
  fetch: FetchTransport
  summary: () => EgressSummary
}

/**
 * The same rule as a plain fetch, for scripts that call `fetch` themselves
 * (an app's own post-deploy auth check). Only the calls made through `.fetch`
 * can be retried; a call to any other host (an identity provider, say) stays on
 * the plain `fetch` and never touches the proxy.
 */
export function createChallengeFallbackFetch(
  options: ChallengeFallbackOptions & { fetch?: FetchTransport } = {},
): ChallengeFallbackFetch {
  const state = new FallbackState(options.env ?? process.env, options.proxyFetch)
  const direct: FetchTransport = options.fetch ?? ((url, init) => fetch(url, init))
  return {
    summary: () => state.summary(),
    fetch: async (url, init) => {
      const first = await direct(url, init)
      if (!isCloudflareChallenge({ status: first.status, headers: first.headers })) return first
      state.noteChallenge()
      const transport = state.transport()
      if (!transport) return first
      const budget = options.remainingMs?.()
      if (budget !== undefined && budget <= 0) {
        state.noteRetry(false, new Error('the overall deadline was already spent'))
        return first
      }
      try {
        const second = await transport(url, init)
        state.noteRetry(true)
        return second
      } catch (error) {
        state.noteRetry(false, error)
        return first
      }
    },
  }
}

export function formatEgress(summary: EgressSummary): string {
  const challenged = `Cloudflare challenged ${String(summary.challenged)} request(s)`
  if (summary.route === 'residential') {
    return `residential (${challenged}; ${String(summary.retried)} retried once through ${EGRESS_PROXY_ENV})`
  }
  if (summary.challenged === 0) return 'direct'
  return `direct (${challenged}; ${summary.fallbackError ?? 'no residential answer'})`
}
