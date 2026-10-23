import { connect, constants, type ClientHttp2Session } from 'node:http2'

import type { ApnsTransport } from './apns.js'

export interface NodeHttp2Transport {
  /** Close every open session; later sends reconnect. */
  close: () => void
  send: ApnsTransport
}

export interface NodeHttp2TransportOptions {
  /** Per-request timeout. */
  timeoutMs?: number
}

/**
 * An HTTP/2 transport for Node, one long-lived session per origin as Apple
 * asks ("keep your connections with APNs open across multiple notifications").
 * A session that closes, errors or receives GOAWAY is replaced on the next send.
 * Open sessions keep the process alive: call `close()` when done.
 */
export function createNodeHttp2Transport(
  options: NodeHttp2TransportOptions = {},
): NodeHttp2Transport {
  const timeoutMs = options.timeoutMs ?? 10_000
  const sessions = new Map<string, ClientHttp2Session>()

  const sessionFor = (origin: string): ClientHttp2Session => {
    const existing = sessions.get(origin)
    if (existing && !existing.closed && !existing.destroyed) return existing
    const session = connect(origin)
    const forget = (): void => {
      if (sessions.get(origin) === session) sessions.delete(origin)
    }
    session.on('close', forget)
    session.on('goaway', forget)
    session.on('error', forget)
    sessions.set(origin, session)
    return session
  }

  const send: ApnsTransport = (request) =>
    new Promise((resolve, reject) => {
      const url = new URL(request.url)
      const stream = sessionFor(url.origin).request({
        [constants.HTTP2_HEADER_METHOD]: request.method,
        [constants.HTTP2_HEADER_PATH]: url.pathname,
        ...request.headers,
      })
      stream.setTimeout(timeoutMs, () => {
        stream.close(constants.NGHTTP2_CANCEL)
        reject(new Error('APNs request timed out'))
      })
      let status = 0
      const headers: Record<string, string> = {}
      const chunks: Buffer[] = []
      stream.on('response', (responseHeaders) => {
        status = Number(responseHeaders[constants.HTTP2_HEADER_STATUS] ?? 0)
        for (const [name, value] of Object.entries(responseHeaders)) {
          if (!name.startsWith(':') && value !== undefined) {
            headers[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value)
          }
        }
      })
      stream.on('data', (chunk: Buffer) => chunks.push(chunk))
      stream.on('end', () => {
        resolve({ status, headers, body: Buffer.concat(chunks).toString('utf8') })
      })
      stream.on('error', reject)
      stream.end(request.body)
    })

  return {
    send,
    close: () => {
      for (const session of sessions.values()) session.close()
      sessions.clear()
    },
  }
}
