type HeaderValue = number | string | string[] | undefined

type HeaderRecord = Record<string, HeaderValue>

type WebHeadersLike = {
  append?: (name: string, value: string) => void
  get?: (name: string) => string | null
  set?: (name: string, value: string) => void
}

type NodeResponseLike = {
  appendHeader?: (name: string, value: string) => void
  getHeader?: (name: string) => HeaderValue
  removeHeader?: (name: string) => void
  setHeader?: (name: string, value: string | string[]) => void
}

export type AppH3EventLike = {
  context?: Record<string, unknown>
  node?: {
    req?: {
      headers?: HeaderRecord
    }
    res?: NodeResponseLike
  }
  req?: {
    headers?: HeaderRecord | WebHeadersLike
  }
  request?: {
    headers?: HeaderRecord | WebHeadersLike
  }
  res?: NodeResponseLike | { headers?: WebHeadersLike }
  response?: {
    headers?: WebHeadersLike
  }
}

export type AppCookieSameSite = 'lax' | 'none' | 'strict'

export type AppCookieOptions = {
  domain?: string
  expires?: Date
  httpOnly?: boolean
  maxAge?: number
  path?: string
  sameSite?: AppCookieSameSite
  secure?: boolean
}

function hasHeaderGet(
  value: unknown,
): value is WebHeadersLike & { get: (name: string) => string | null } {
  return Boolean(
    value && typeof value === 'object' && typeof (value as WebHeadersLike).get === 'function',
  )
}

function hasHeaderSet(
  value: unknown,
): value is WebHeadersLike & { set: (name: string, value: string) => void } {
  return Boolean(
    value && typeof value === 'object' && typeof (value as WebHeadersLike).set === 'function',
  )
}

function hasHeaderAppend(
  value: unknown,
): value is WebHeadersLike & { append: (name: string, value: string) => void } {
  return Boolean(
    value && typeof value === 'object' && typeof (value as WebHeadersLike).append === 'function',
  )
}

function readHeaderRecord(headers: HeaderRecord, name: string): string | undefined {
  const direct = headers[name]
  const lower = headers[name.toLowerCase()]
  const value = direct ?? lower
  if (Array.isArray(value)) {
    return value.join(', ')
  }
  return value === undefined ? undefined : String(value)
}

function requestHeaderSources(event: AppH3EventLike): unknown[] {
  return [event.req?.headers, event.request?.headers, event.node?.req?.headers]
}

export function readAppRequestHeader(event: AppH3EventLike, name: string): string | undefined {
  for (const headers of requestHeaderSources(event)) {
    if (!headers) continue
    if (hasHeaderGet(headers)) {
      const value = headers.get(name)
      if (value !== null) return value
      continue
    }
    if (typeof headers === 'object') {
      const value = readHeaderRecord(headers as HeaderRecord, name)
      if (value !== undefined) return value
    }
  }

  return undefined
}

function responseHeaders(event: AppH3EventLike): WebHeadersLike | undefined {
  const res = event.res
  return (res && 'headers' in res ? res.headers : undefined) ?? event.response?.headers
}

function isNodeResponseLike(value: unknown): value is NodeResponseLike {
  return Boolean(
    value &&
    typeof value === 'object' &&
    (typeof (value as NodeResponseLike).appendHeader === 'function' ||
      typeof (value as NodeResponseLike).getHeader === 'function' ||
      typeof (value as NodeResponseLike).setHeader === 'function'),
  )
}

function nodeResponse(event: AppH3EventLike): NodeResponseLike | undefined {
  return event.node?.res ?? (isNodeResponseLike(event.res) ? event.res : undefined)
}

export function setAppResponseHeader(event: AppH3EventLike, name: string, value: string): boolean {
  const headers = responseHeaders(event)
  if (hasHeaderSet(headers)) {
    headers.set(name, value)
    return true
  }

  const res = nodeResponse(event)
  if (typeof res?.setHeader === 'function') {
    res.setHeader(name, value)
    return true
  }

  return false
}

export function appendAppResponseHeader(
  event: AppH3EventLike,
  name: string,
  value: string,
): boolean {
  const headers = responseHeaders(event)
  if (hasHeaderAppend(headers)) {
    headers.append(name, value)
    return true
  }

  const res = nodeResponse(event)
  if (typeof res?.appendHeader === 'function') {
    res.appendHeader(name, value)
    return true
  }

  if (typeof res?.setHeader === 'function') {
    const previous =
      typeof res.getHeader === 'function'
        ? (res.getHeader(name) ?? res.getHeader(name.toLowerCase()))
        : undefined
    const values = Array.isArray(previous)
      ? [...previous.map(String), value]
      : previous === undefined
        ? [value]
        : [String(previous), value]
    res.setHeader(name, values)
    return true
  }

  return false
}

function parseCookieHeader(cookieHeader: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {}
  if (!cookieHeader) return cookies

  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim()
    if (!trimmed) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const name = trimmed.slice(0, eq).trim()
    const rawValue = trimmed.slice(eq + 1)
    try {
      cookies[name] = decodeURIComponent(rawValue)
    } catch {
      cookies[name] = rawValue
    }
  }

  return cookies
}

function serializeCookie(name: string, value: string, options: AppCookieOptions = {}) {
  const segments = [`${name}=${encodeURIComponent(value)}`]

  if (typeof options.maxAge === 'number') {
    segments.push(`Max-Age=${Math.floor(options.maxAge)}`)
  }
  if (options.domain) {
    segments.push(`Domain=${options.domain}`)
  }
  if (options.path) {
    segments.push(`Path=${options.path}`)
  }
  if (options.expires) {
    segments.push(`Expires=${options.expires.toUTCString()}`)
  }
  if (options.httpOnly) {
    segments.push('HttpOnly')
  }
  if (options.secure) {
    segments.push('Secure')
  }
  if (options.sameSite) {
    const sameSite = `${options.sameSite.slice(0, 1).toUpperCase()}${options.sameSite.slice(1)}`
    segments.push(`SameSite=${sameSite}`)
  }

  return segments.join('; ')
}

export function readAppCookie(event: AppH3EventLike, name: string): string | undefined {
  return parseCookieHeader(readAppRequestHeader(event, 'cookie'))[name]
}

export function setAppCookie(
  event: AppH3EventLike,
  name: string,
  value: string,
  options: AppCookieOptions = {},
): boolean {
  return appendAppResponseHeader(event, 'Set-Cookie', serializeCookie(name, value, options))
}

export function deleteAppCookie(
  event: AppH3EventLike,
  name: string,
  options: Omit<AppCookieOptions, 'expires' | 'maxAge'> = {},
): boolean {
  return setAppCookie(event, name, '', {
    ...options,
    expires: new Date(0),
    maxAge: 0,
  })
}
