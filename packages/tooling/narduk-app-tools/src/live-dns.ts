/**
 * Name resolution for `narduk-app verify --live` (narduk-libs#783).
 *
 * After a DNS change a workstation's resolver can keep a negative (NXDOMAIN)
 * answer for a hostname that is already live. The system lookup then fails with
 * `ENOTFOUND`, native fetch reports `fetch failed` with that code on `cause`, and
 * the live proof reads exactly like a dead deployment. (loadtest.dev: `dig
 * @1.1.1.1` and `@8.8.8.8` returned Cloudflare addresses while curl and Node on
 * the Mac failed "Could not resolve host" for more than ten minutes.)
 *
 * Two things live here, kept out of `verify-live.ts` so the proof's own request
 * plan stays untouched:
 *
 *   1. A diagnosis. When a probe fails to resolve the host, ask public resolvers
 *      directly (`node:dns` `Resolver`, bypassing the system cache). If they
 *      answer, the pass gets a distinct `dns` assertion, status `unknown`:
 *      "the local resolver has a stale negative answer", with the public
 *      addresses and the remedies. It stays exit 2 (unreachable) -- this process
 *      still could not read the deployment, so it is not a proof -- but a
 *      person or a job can tell it apart from a dead deployment by the `dns`
 *      assertion id, without parsing text.
 *   2. `--resolver public`: every probe connects to an address the public
 *      resolvers returned, through `node:http(s)` with a custom `lookup`. The URL,
 *      and so the TLS SNI, certificate check and `Host` header, keep the real
 *      hostname; only the address the socket dials changes. It is `curl
 *      --resolve` done for you. Native fetch cannot take a custom lookup without
 *      the `undici` package, which this package does not depend on.
 */

import { Resolver } from 'node:dns/promises'
import { request as httpRequest, type IncomingMessage } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { isIP, type LookupFunction } from 'node:net'

import {
  createLiveProbe,
  type FetchTransport,
  type LiveProbe,
  type LiveResponse,
} from './live-probe.js'

/** The public resolvers both the diagnosis and `--resolver public` ask. */
export const PUBLIC_RESOLVERS = ['1.1.1.1', '8.8.8.8'] as const

/**
 * getaddrinfo's "this name has no address" codes. `EAI_AGAIN` is what macOS and
 * some Linux resolvers return for a cached negative answer as well as for a
 * resolver that is down, so it is diagnosed too.
 */
export const NAME_RESOLUTION_ERROR_CODES: ReadonlySet<string> = new Set(['ENOTFOUND', 'EAI_AGAIN'])

export type VerifyResolverMode = 'system' | 'public'

export const VERIFY_RESOLVER_MODES: readonly VerifyResolverMode[] = ['system', 'public']

/** The command a person runs to drop macOS's cached negative answer. */
export const MACOS_DNS_FLUSH = 'sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder'

/**
 * Addresses public DNS holds for a hostname, bypassing the system resolver.
 * Resolves `[]` when public DNS has no record either, and rejects when the
 * public resolvers themselves could not be asked.
 */
export type PublicResolve = (hostname: string) => Promise<string[]>

const NO_RECORD_CODES = new Set(['ENOTFOUND', 'ENODATA'])

function errorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' ? code : undefined
}

/** A `PublicResolve` over `node:dns` pinned to `servers`: A and AAAA, IPv4 first. */
export function createPublicResolve(
  servers: readonly string[] = PUBLIC_RESOLVERS,
  timeoutMs = 2500,
): PublicResolve {
  return async (hostname) => {
    const resolver = new Resolver({ timeout: timeoutMs, tries: 1 })
    resolver.setServers([...servers])
    const results = await Promise.allSettled([
      resolver.resolve4(hostname),
      resolver.resolve6(hostname),
    ])
    const addresses = results.flatMap((result) =>
      result.status === 'fulfilled' ? result.value : [],
    )
    if (addresses.length > 0) return addresses
    const failure = results.find(
      (result): result is PromiseRejectedResult =>
        result.status === 'rejected' && !NO_RECORD_CODES.has(errorCode(result.reason) ?? ''),
    )
    if (failure) throw failure.reason
    return []
  }
}

/** True when a probe failed because the host name did not resolve. */
export function isNameResolutionFailure(response: LiveResponse): boolean {
  return (
    response.error !== undefined &&
    response.errorCode !== undefined &&
    NAME_RESOLUTION_ERROR_CODES.has(response.errorCode)
  )
}

/**
 * A `net` lookup that answers from `resolve` instead of the system resolver.
 * Handles both callback shapes: Node asks for `all` addresses when it races
 * address families (`autoSelectFamily`, on by default since Node 20).
 */
export function publicLookup(resolve: PublicResolve): LookupFunction {
  return (hostname, options, callback) => {
    const answer = async (): Promise<void> => {
      let found: string[]
      try {
        found = await resolve(hostname)
      } catch (error) {
        callback(error as NodeJS.ErrnoException, '', 4)
        return
      }
      const family = typeof options.family === 'number' ? options.family : 0
      const addresses = found
        .map((address) => ({ address, family: isIP(address) }))
        .filter((entry) => entry.family !== 0 && (family === 0 || entry.family === family))
      if (addresses.length === 0) {
        const error = Object.assign(
          new Error(`public DNS (${PUBLIC_RESOLVERS.join(', ')}) has no address for ${hostname}`),
          { code: 'ENOTFOUND', hostname },
        )
        callback(error, '', 4)
        return
      }
      if (options.all) callback(null, addresses)
      else callback(null, addresses[0]!.address, addresses[0]!.family)
    }
    void answer()
  }
}

/** `URL.hostname` keeps an IPv6 literal's brackets; sockets and `isIP` want it bare. */
function bareHostname(url: URL): string {
  return url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304])
const MAX_REDIRECTS = 20

function send(
  url: URL,
  init: RequestInit,
  lookup: LookupFunction,
): Promise<{ message: IncomingMessage; body: Buffer }> {
  const headers: Record<string, string> = {}
  new Headers(init.headers).forEach((value, name) => {
    headers[name] = value
  })
  const hostname = bareHostname(url)
  const request = url.protocol === 'https:' ? httpsRequest : httpRequest
  return new Promise((resolve, reject) => {
    const outgoing = request(
      {
        protocol: url.protocol,
        hostname,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: init.method ?? 'GET',
        // The real hostname for SNI and the certificate check; `lookup` only
        // decides which address the socket dials.
        servername: isIP(hostname) ? undefined : hostname,
        headers: { ...headers, host: url.host },
        lookup,
        signal: init.signal ?? undefined,
        agent: false,
      },
      (message) => {
        const chunks: Buffer[] = []
        message.on('data', (chunk: Buffer) => chunks.push(chunk))
        message.on('end', () => resolve({ message, body: Buffer.concat(chunks) }))
        message.on('error', reject)
      },
    )
    outgoing.on('error', reject)
    outgoing.end()
  })
}

/**
 * A fetch for `createLiveProbe` that dials what `lookup` returns. Follows
 * redirects like fetch (`redirect: 'follow'`, 20 hops) unless asked for
 * `manual`, and fails the way fetch does -- `TypeError('fetch failed')` with the
 * transport error on `cause` -- so the probe reports it identically.
 */
export function createPinnedFetch(lookup: LookupFunction): FetchTransport {
  return async (input, init = {}) => {
    let url = new URL(input)
    let redirected = false
    try {
      for (let hop = 0; ; hop += 1) {
        const { message, body } = await send(url, init, lookup)
        const status = message.statusCode ?? 0
        const location = message.headers.location
        if (init.redirect !== 'manual' && REDIRECT_STATUSES.has(status) && location) {
          if (hop >= MAX_REDIRECTS) throw new Error('redirect count exceeded')
          url = new URL(location, url)
          redirected = true
          continue
        }
        const headers = new Headers()
        for (let index = 0; index + 1 < message.rawHeaders.length; index += 2) {
          headers.append(message.rawHeaders[index]!, message.rawHeaders[index + 1]!)
        }
        const response = new Response(
          NULL_BODY_STATUSES.has(status) ? null : new Uint8Array(body),
          {
            status,
            statusText: message.statusMessage ?? '',
            headers,
          },
        )
        Object.defineProperty(response, 'url', { value: url.href })
        Object.defineProperty(response, 'redirected', { value: redirected })
        return response
      }
    } catch (error) {
      if ((error as { name?: unknown } | null)?.name === 'AbortError') throw error
      throw new TypeError('fetch failed', { cause: error })
    }
  }
}

/**
 * The probe `verify --live` uses when none is injected. `system` is the plain
 * native-fetch probe it has always used; `public` dials the public resolvers'
 * answer while keeping the hostname for SNI and `Host`.
 */
export function createResolverProbe(
  mode: VerifyResolverMode,
  options: { timeoutMs: number; resolvePublic?: PublicResolve },
): LiveProbe {
  if (mode === 'system') return createLiveProbe({ timeoutMs: options.timeoutMs })
  const lookup = publicLookup(options.resolvePublic ?? createPublicResolve())
  return createLiveProbe({ timeoutMs: options.timeoutMs }, createPinnedFetch(lookup))
}

// A type alias, not an interface, so it is assignable to a report's
// `Record<string, unknown>` evidence.
export type StaleDnsDiagnosis = {
  hostname: string
  /** What the system lookup failed with, e.g. `ENOTFOUND`. */
  localErrorCode: string
  publicResolvers: string[]
  publicAddresses: string[]
}

export interface DnsDiagnosisAssertion {
  id: 'dns'
  status: 'unknown'
  detail: string
  exitCode: number
  evidence: StaleDnsDiagnosis
}

export function staleDnsDetail(diagnosis: StaleDnsDiagnosis): string {
  return (
    `local resolver has a stale negative answer for ${diagnosis.hostname}: the system lookup ` +
    `failed with ${diagnosis.localErrorCode}, but public DNS (${diagnosis.publicResolvers.join(', ')}) ` +
    `resolves it to ${diagnosis.publicAddresses.join(', ')}. The deployment may well be live; ` +
    'this process could not reach it, so nothing was proven. Flush the local DNS cache ' +
    `(macOS: ${MACOS_DNS_FLUSH}) or rerun with --resolver public, which probes those ` +
    'addresses with the real hostname for SNI and Host.'
  )
}

export interface DnsDiagnoser {
  /** Wrap a probe so a name-resolution failure is checked against public DNS. */
  wrap: (probe: LiveProbe) => LiveProbe
  /**
   * Put this attempt's diagnoses in front of its assertions, then forget them:
   * each attempt asks public DNS afresh, because the answer is what changes
   * during a DNS cut-over.
   */
  annotate: <T>(assertions: T[]) => Array<T | DnsDiagnosisAssertion>
}

type PublicAnswer = { addresses: string[] } | { error: string }

/**
 * `exitCode` is passed in (the caller's `VERIFY_EXIT.unreachable`) so this
 * module needs nothing from `verify-live.ts` at runtime.
 */
export function createDnsDiagnoser(options: {
  mode: VerifyResolverMode
  exitCode: number
  resolvePublic?: PublicResolve
}): DnsDiagnoser {
  const resolvePublic = options.resolvePublic ?? createPublicResolve()
  let answers = new Map<string, Promise<PublicAnswer>>()
  let found = new Map<string, StaleDnsDiagnosis>()
  const ask = (hostname: string): Promise<PublicAnswer> => {
    let answer = answers.get(hostname)
    if (!answer) {
      answer = resolvePublic(hostname).then(
        (addresses) => ({ addresses }),
        (error: unknown) => ({ error: error instanceof Error ? error.message : String(error) }),
      )
      answers.set(hostname, answer)
    }
    return answer
  }
  const servers = [...PUBLIC_RESOLVERS]
  return {
    wrap: (probe) => async (url, probeOptions) => {
      const response = await probe(url, probeOptions)
      // Under --resolver public the failed lookup already WAS public DNS.
      if (options.mode === 'public' || !isNameResolutionFailure(response)) return response
      let parsed: URL
      try {
        parsed = new URL(url)
      } catch {
        return response
      }
      if (isIP(bareHostname(parsed))) return response
      const { hostname } = parsed
      const answer = await ask(hostname)
      const code = response.errorCode!
      if ('error' in answer) {
        return {
          ...response,
          error: `${response.error!} (${code}; public DNS ${servers.join(', ')} could not be asked either: ${answer.error})`,
        }
      }
      if (answer.addresses.length === 0) {
        return {
          ...response,
          error: `${response.error!} (${code}; public DNS ${servers.join(', ')} has no address for ${hostname} either)`,
        }
      }
      found.set(hostname, {
        hostname,
        localErrorCode: code,
        publicResolvers: servers,
        publicAddresses: answer.addresses,
      })
      return {
        ...response,
        error: `${response.error!} (${code}): stale local DNS -- public DNS resolves ${hostname}; see the dns assertion`,
      }
    },
    annotate: (assertions) => {
      const diagnoses = [...found.values()].map((diagnosis): DnsDiagnosisAssertion => ({
        id: 'dns',
        status: 'unknown',
        detail: staleDnsDetail(diagnosis),
        exitCode: options.exitCode,
        evidence: diagnosis,
      }))
      answers = new Map()
      found = new Map()
      return [...diagnoses, ...assertions]
    },
  }
}
