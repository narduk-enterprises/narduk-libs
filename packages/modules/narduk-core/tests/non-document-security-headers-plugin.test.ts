/**
 * narduk-libs#1216: with the security.headers preset on, non-document
 * responses carry the preset's Permissions-Policy (and under enforce its
 * nonce-free CSP), while HTML, route-rule headers and report-only semantics
 * are left alone. Driven through a real h3 app and HTTP round trip.
 */
import { createServer } from 'node:http'

import { createApp, defineEventHandler, setResponseHeader, toNodeListener } from 'h3'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { H3Event } from 'h3'

const { runtime } = vi.hoisted(() => ({
  runtime: {} as { nardukSecurityHeaders?: { mode: string }; security?: { headers?: unknown } },
}))

vi.mock('nitropack/runtime', () => ({
  defineNitroPlugin: (plugin: unknown) => plugin,
  useRuntimeConfig: () => runtime,
}))

const { default: plugin } = await import('../runtime/server/plugins/non-document-security-headers')

const CSP = 'content-security-policy'
const PERMISSIONS = 'permissions-policy'
const presetHeaders = {
  contentSecurityPolicy: {
    'default-src': ["'self'"],
    'script-src': ["'self'", "'nonce-{{nonce}}'", "'strict-dynamic'"],
  },
  permissionsPolicy: { camera: [], geolocation: [] },
}

type Hook = (event: H3Event, response?: unknown) => void

async function respond(mode: string, handler: (event: H3Event) => unknown): Promise<Headers> {
  runtime.nardukSecurityHeaders = { mode }
  runtime.security = { headers: presetHeaders }
  const hooks: Hook[] = []
  // A fresh plugin instance per request, since it memoises the preset.
  ;(plugin as (nitro: unknown) => void)({
    hooks: { hook: (name: string, fn: Hook) => name === 'beforeResponse' && hooks.push(fn) },
  })
  const app = createApp({
    onBeforeResponse: (event, response) => {
      for (const hook of hooks) hook(event, response)
    },
  }).use(defineEventHandler((event) => handler(event)))
  const server = createServer(toNodeListener(app))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected TCP listener')
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/`)
    await response.text()
    return response.headers
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
}

afterEach(() => {
  delete runtime.nardukSecurityHeaders
  delete runtime.security
})

describe('non-document security headers plugin', () => {
  it('serves the preset policy without the nonce on an API response under enforce', async () => {
    const headers = await respond('enforce', () => ({ ok: true }))
    expect(headers.get(PERMISSIONS)).toBe('camera=(), geolocation=()')
    expect(headers.get(CSP)).toBe("default-src 'self'; script-src 'self' 'strict-dynamic';")
  })

  it('adds only Permissions-Policy in report-only, so no second enforcing CSP appears', async () => {
    const headers = await respond('report-only', () => ({ ok: true }))
    expect(headers.get(PERMISSIONS)).toBe('camera=(), geolocation=()')
    expect(headers.get(CSP)).toBeNull()
  })

  it('does nothing when the preset is off', async () => {
    const headers = await respond('off', () => ({ ok: true }))
    expect(headers.get(PERMISSIONS)).toBeNull()
    expect(headers.get(CSP)).toBeNull()
  })

  it('leaves an HTML response to the renderer and its route rules', async () => {
    // A page whose route rule turned security off arrives here with no CSP.
    const typed = await respond('enforce', (event) => {
      setResponseHeader(event, 'content-type', 'text/html;charset=utf-8')
      return '<!DOCTYPE html><html><body><script>boot()</script></body></html>'
    })
    expect(typed.get(CSP)).toBeNull()
    expect(typed.get(PERMISSIONS)).toBeNull()
    const untyped = await respond('enforce', () => '<html><body>hi</body></html>')
    expect(untyped.get(CSP)).toBeNull()
    const webResponse = await respond(
      'enforce',
      () => new Response('<p>x</p>', { headers: { 'content-type': 'text/html' } }),
    )
    expect(webResponse.get(CSP)).toBeNull()
  })

  it('never overwrites a header a route rule or handler already set', async () => {
    const headers = await respond('enforce', (event) => {
      setResponseHeader(event, 'Content-Security-Policy', "default-src 'none'")
      setResponseHeader(event, 'Permissions-Policy', 'camera=(self)')
      return { ok: true }
    })
    expect(headers.get(CSP)).toBe("default-src 'none'")
    expect(headers.get(PERMISSIONS)).toBe('camera=(self)')
  })

  it('covers a plain-text robots response', async () => {
    const headers = await respond('enforce', (event) => {
      setResponseHeader(event, 'content-type', 'text/plain')
      return 'User-agent: *\nAllow: /\n'
    })
    expect(headers.get(PERMISSIONS)).toBe('camera=(), geolocation=()')
  })
})
