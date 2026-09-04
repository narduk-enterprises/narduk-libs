import {
  appendAppResponseHeader,
  deleteAppCookie,
  readAppCookie,
  readAppRequestHeader,
  setAppCookie,
  setAppResponseHeader,
} from '../src/server/http'
import { describe, expect, it } from 'vitest'

import type { AppH3EventLike } from '../src/server/http'

function makeNodeEvent(headers: Record<string, string> = {}) {
  const responseHeaders = new Map<string, string | string[]>()
  const event: AppH3EventLike = {
    req: {
      headers,
    },
    node: {
      res: {
        getHeader(name) {
          return responseHeaders.get(name) ?? responseHeaders.get(name.toLowerCase())
        },
        setHeader(name, value) {
          responseHeaders.set(name, value)
        },
      },
    },
  }

  return { event, responseHeaders }
}

describe('server http helpers', () => {
  it('reads Web Headers request values', () => {
    const event: AppH3EventLike = {
      req: {
        headers: new Headers({
          cookie: 'app_auth_pkce=abc',
          host: 'example.com',
        }),
      },
    }

    expect(readAppRequestHeader(event, 'host')).toBe('example.com')
    expect(readAppCookie(event, 'app_auth_pkce')).toBe('abc')
  })

  it('reads plain-object request headers from Nitro Cloudflare events', () => {
    const { event } = makeNodeEvent({
      cookie: 'app_auth_pkce=encoded%20value',
      host: 'workers.dev',
    })

    expect(readAppRequestHeader(event, 'host')).toBe('workers.dev')
    expect(readAppCookie(event, 'app_auth_pkce')).toBe('encoded value')
  })

  it('sets response headers through Web Headers when present', () => {
    const headers = new Headers()
    const event: AppH3EventLike = {
      res: { headers },
    }

    expect(setAppResponseHeader(event, 'Cache-Control', 'private, no-store')).toBe(true)
    expect(headers.get('Cache-Control')).toBe('private, no-store')
  })

  it('does not throw when no response object exists', () => {
    expect(setAppResponseHeader({}, 'Cache-Control', 'private, no-store')).toBe(false)
    expect(appendAppResponseHeader({}, 'Set-Cookie', 'a=b')).toBe(false)
  })

  it('appends Set-Cookie values through node response fallback', () => {
    const { event, responseHeaders } = makeNodeEvent()

    expect(setAppCookie(event, 'app_auth_pkce', 'abc', { httpOnly: true, path: '/' })).toBe(true)
    expect(deleteAppCookie(event, 'app_auth_pkce', { path: '/' })).toBe(true)

    expect(responseHeaders.get('Set-Cookie')).toEqual([
      'app_auth_pkce=abc; Path=/; HttpOnly',
      'app_auth_pkce=; Max-Age=0; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    ])
  })
})
