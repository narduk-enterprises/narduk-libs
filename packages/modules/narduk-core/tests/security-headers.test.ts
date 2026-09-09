import { createServer } from 'node:http'

import { createApp, toNodeListener } from 'h3'
import { afterEach, describe, expect, it, vi } from 'vitest'

import securityHeaders from '../runtime/server/middleware/securityHeaders'

const { runtime } = vi.hoisted(() => ({
  runtime: { public: { cspMediaSrc: '', cspConnectSrc: '' } },
}))
vi.mock('nitropack/runtime', () => ({ useRuntimeConfig: () => runtime }))

describe('media content security policy', () => {
  afterEach(() => {
    runtime.public.cspMediaSrc = ''
    runtime.public.cspConnectSrc = ''
  })
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
