import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'

import { createEvent, getResponseStatus, getResponseStatusText } from 'h3'

import type { H3Event } from 'h3'

/**
 * Options for {@link createFakeEvent}. Every field is optional; an empty call
 * builds a bare `GET /` request.
 */
export interface FakeEventOptions {
  /**
   * A JSON-serializable value, a string, or a `Buffer`. A non-string,
   * non-Buffer value is JSON-stringified and given a default
   * `content-type: application/json` (unless `headers` already sets one).
   */
  body?: unknown
  /** Extra fields merged onto `event.context` (e.g. pre-seeded auth state). */
  context?: Record<string, unknown>
  /** Serialized into a `Cookie` request header, unless `headers` already sets one. */
  cookies?: Record<string, string>
  /** Request headers. Names are case-insensitive, matching real HTTP. */
  headers?: Record<string, string>
  /** HTTP method. Defaults to `GET`. */
  method?: string
  /** Route params, readable via h3's `getRouterParam`/`getRouterParams`. */
  params?: Record<string, string>
  /** Request path, with or without an existing query string. Defaults to `/`. */
  path?: string
  /** Query params, merged with any query string already in `path`. */
  query?: Record<string, Array<boolean | number | string> | boolean | number | string>
}

/** The response an {@link H3Event} produced, read back after a handler ran. */
export interface FakeHandlerResponse<TBody = unknown> {
  /**
   * The response body. If the handler (or something it called, like
   * `sendError`) wrote bytes to `event.node.res`, this is those bytes —
   * JSON-parsed when the response `content-type` says JSON, else a UTF-8
   * string. Otherwise it is the handler's own return value, matching how
   * Nitro serializes a plain `return value` handler in production.
   */
  body: TBody
  /** Response headers, as `event.node.res.getHeaders()` reports them. */
  headers: Record<string, string | string[]>
  /** Response status code. */
  status: number
  /** Response status text, when one was set. */
  statusText?: string
}

const capturedChunks = new WeakMap<ServerResponse, Buffer[]>()

function normalizeHeaders(headers: Record<string, string> = {}): Record<string, string> {
  const normalized: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    normalized[name.toLowerCase()] = value
  }
  return normalized
}

function serializeCookies(cookies: Record<string, string>): string {
  return Object.entries(cookies)
    .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
    .join('; ')
}

function appendQuery(path: string, query: FakeEventOptions['query']): string {
  const [pathname, existingSearch = ''] = path.split('?')
  const search = new URLSearchParams(existingSearch)
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (Array.isArray(value)) {
        search.delete(key)
        for (const item of value) search.append(key, String(item))
        continue
      }
      search.set(key, String(value))
    }
  }
  const serialized = search.toString()
  return serialized ? `${pathname}?${serialized}` : pathname
}

function resolveRequestBody(body: unknown, headers: Record<string, string>): Buffer | undefined {
  if (body === undefined) return undefined
  if (Buffer.isBuffer(body)) return body
  if (typeof body === 'string') return Buffer.from(body)
  if (!('content-type' in headers)) headers['content-type'] = 'application/json'
  return Buffer.from(JSON.stringify(body))
}

function recordChunk(chunks: Buffer[], chunk: unknown, encoding?: unknown): void {
  if (chunk === undefined || chunk === null) return
  if (Buffer.isBuffer(chunk)) {
    chunks.push(chunk)
    return
  }
  if (typeof chunk === 'string') {
    chunks.push(
      Buffer.from(chunk, typeof encoding === 'string' ? (encoding as BufferEncoding) : 'utf8'),
    )
  }
}

/**
 * Instrument a real `ServerResponse` to remember every byte written through
 * `write`/`end`, while still calling through to the original method so the
 * response's own bookkeeping (`headersSent`, `writableEnded`, `statusCode`,
 * ...) stays exactly what a real Node response would report. This is the
 * only way to observe a body an h3 handler sent directly (`send`,
 * `sendError`, a manual `res.end(...)`) instead of returning it, without
 * reaching into any h3 or Node internals.
 */
function instrumentResponse(res: ServerResponse): void {
  const chunks: Buffer[] = []
  capturedChunks.set(res, chunks)

  const originalWrite = res.write.bind(res)
  const originalEnd = res.end.bind(res)

  res.write = ((chunk: unknown, encoding?: unknown, callback?: unknown) => {
    recordChunk(chunks, chunk, encoding)
    return (originalWrite as (...args: unknown[]) => boolean)(chunk, encoding, callback)
  }) as typeof res.write

  res.end = ((chunk?: unknown, encoding?: unknown, callback?: unknown) => {
    if (typeof chunk !== 'function') recordChunk(chunks, chunk, encoding)
    return (originalEnd as (...args: unknown[]) => ServerResponse)(chunk, encoding, callback)
  }) as typeof res.end
}

/**
 * Build a real-enough h3 `H3Event` for unit-testing a route handler directly
 * — no Wrangler, no Miniflare, no browser. It is a genuine Node
 * `IncomingMessage`/`ServerResponse` pair run through h3's own public
 * `createEvent`, the same construction narduk-core's own h3 tests already
 * use by hand (see e.g. `packages/modules/narduk-core/tests/request-correlation.test.ts`),
 * so `getQuery`, `readBody`, `getRouterParam`, `getHeader`, `setResponseStatus`,
 * and `setHeader` all behave the way they do against a real request.
 *
 * @example
 * ```ts
 * const event = createFakeEvent({
 *   method: 'POST',
 *   path: '/api/buoys',
 *   body: { name: 'Buoy 12' },
 * })
 * const result = await handler(event)
 * ```
 */
export function createFakeEvent(options: FakeEventOptions = {}): H3Event {
  const method = (options.method ?? 'GET').toUpperCase()
  const headers = normalizeHeaders(options.headers)

  if (options.cookies && !('cookie' in headers)) {
    headers.cookie = serializeCookies(options.cookies)
  }

  const bodyBuffer = resolveRequestBody(options.body, headers)
  if (bodyBuffer !== undefined && !('content-length' in headers)) {
    headers['content-length'] = String(bodyBuffer.length)
  }

  const path = appendQuery(options.path ?? '/', options.query)

  const request = new IncomingMessage(new Socket())
  request.method = method
  request.url = path
  Object.assign(request.headers, headers)
  if (bodyBuffer !== undefined) request.push(bodyBuffer)
  request.push(null)

  const response = new ServerResponse(request)
  instrumentResponse(response)

  const event = createEvent(request, response)

  if (options.params) {
    event.context.params = { ...options.params }
  }
  if (options.context) {
    Object.assign(event.context, options.context)
  }

  return event
}

function decodeCapturedBody(chunks: Buffer[], contentType: unknown): unknown {
  const raw = Buffer.concat(chunks)
  const text = raw.toString('utf8')
  if (typeof contentType === 'string' && contentType.includes('application/json')) {
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }
  return text
}

function normalizeOutgoingHeaders(
  headers: ReturnType<ServerResponse['getHeaders']>,
): Record<string, string | string[]> {
  const normalized: Record<string, string | string[]> = {}
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue
    normalized[name] = Array.isArray(value) ? value.map(String) : String(value)
  }
  return normalized
}

/**
 * Read back the status, headers, and body an {@link H3Event} produced after a
 * handler ran against it. Pass the handler's own return value as
 * `handlerResult` so a handler that follows the common Nitro convention of
 * `return data` (rather than calling `send`/`sendError` itself) still reports
 * a body — this harness cannot know which style a given handler uses.
 *
 * Prefer {@link callHandler} for the common case of "call one handler, read
 * its response"; use this directly when a test needs to run middleware and a
 * handler against the same event before reading the result.
 */
export function readFakeEventResponse<TBody = unknown>(
  event: H3Event,
  handlerResult?: unknown,
): FakeHandlerResponse<TBody> {
  const res = event.node.res
  const chunks = capturedChunks.get(res)
  const body =
    chunks && chunks.length > 0
      ? (decodeCapturedBody(chunks, res.getHeader('content-type')) as TBody)
      : (handlerResult as TBody)

  return {
    body,
    headers: normalizeOutgoingHeaders(res.getHeaders()),
    status: getResponseStatus(event),
    statusText: getResponseStatusText(event) || undefined,
  }
}
