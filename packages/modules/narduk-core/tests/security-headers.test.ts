import { createServer } from 'node:http'

import { createApp, toNodeListener } from 'h3'
import { afterEach, describe, expect, it, vi } from 'vitest'

import securityHeaders from '../runtime/server/middleware/securityHeaders'
import { BASELINE_ALLOWLIST } from '../runtime/shared/security-headers'

const { runtime } = vi.hoisted(() => ({
  runtime: { public: { cspMediaSrc: '', cspConnectSrc: '', cspScriptSrc: '' } },
}))
vi.mock('nitropack/runtime', () => ({ useRuntimeConfig: () => runtime }))

async function headers() {
  const app = createApp()
    .use(securityHeaders)
    .use(() => 'ok')
  const server = createServer(toNodeListener(app))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected TCP listener')
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}`)
    await response.text()
    return response.headers.get('content-security-policy')!
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
}

function directive(name: string, csp: string) {
  return csp.split('; ').find((part) => part.startsWith(`${name} `))
}

describe('media content security policy', () => {
  afterEach(() => {
    runtime.public.cspMediaSrc = ''
    runtime.public.cspConnectSrc = ''
  })
  it('keeps media restricted to the application origin by default', async () => {
    expect(await headers()).toContain("media-src 'self';")
  })
  it('permits configured media origins and blobs without broadening other directives', async () => {
    const baseline = await headers()
    runtime.public.cspMediaSrc = 'blob:, https://media.example.com,blob:'
    runtime.public.cspConnectSrc = 'https://media.example.com'
    const configured = await headers()
    expect(configured).toContain("media-src 'self' blob: https://media.example.com;")
    const directives = (value: string) =>
      value
        .split('; ')
        .filter((part) => !part.startsWith('media-src ') && !part.startsWith('connect-src '))
    expect(directives(configured)).toEqual(directives(baseline))
    expect(configured.split('; ').find((part) => part.startsWith('connect-src '))).toContain(
      'https://media.example.com',
    )
  })
})

describe('GA4 Google-signals beacon (issue #472)', () => {
  it('allows the Google-signals page_view beacon on connect-src, agreeing with the strict-CSP baseline', async () => {
    expect(directive('connect-src', await headers())).toContain('https://www.google.com')
    // The shared strict-CSP module lists the same GA host, so the two
    // policies do not silently drift apart on this endpoint.
    expect(BASELINE_ALLOWLIST.connect).toContain('https://www.google.com')
  })

  it('covers the same host on img-src via the existing https: wildcard', async () => {
    expect(directive('img-src', await headers())).toContain('https:')
  })
})

describe('legacy script-src baseline (issue #459)', () => {
  const ADSENSE = 'https://pagead2.googlesyndication.com'

  afterEach(() => {
    runtime.public.cspScriptSrc = ''
  })

  it('does not grant the AdSense script origin to every app', async () => {
    expect(directive('script-src', await headers())).not.toContain(ADSENSE)
  })

  it('lists the same script hosts as the strict preset baseline', async () => {
    const hosts = directive('script-src', await headers())!
      .split(' ')
      .slice(1)
      .filter((source) => !source.startsWith("'"))
    expect([...hosts].sort()).toEqual([...BASELINE_ALLOWLIST.script].sort())
  })

  it('still lets an app that serves ads opt the origin back in', async () => {
    runtime.public.cspScriptSrc = ADSENSE
    expect(directive('script-src', await headers())).toContain(ADSENSE)
  })
})
