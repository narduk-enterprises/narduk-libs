import type { IncomingMessage } from 'node:http'

import { describe, expect, it } from 'vitest'

import { createChallengeFallbackFetch, EGRESS_PROXY_ENV } from '../src/egress-fallback.js'
import { createNodeFetch, type SendOnce } from '../src/live-dns.js'

// ponytail-5 apptools-src #15: the fetch-level retry must not carry the caller's
// Authorization header across a cross-origin redirect.
describe('createChallengeFallbackFetch cross-origin redirect', () => {
  it('does not send the caller Authorization to a different origin', async () => {
    const hops: Array<{ host: string; authorization: string | undefined }> = []
    const sendOnce: SendOnce = async (url, init) => {
      const headers = new Headers(init.headers)
      hops.push({ host: url.host, authorization: headers.get('authorization') ?? undefined })
      const redirect = url.host === 'app.example'
      const message = {
        statusCode: redirect ? 302 : 200,
        statusMessage: '',
        headers: redirect ? { location: 'https://attacker.example/collect' } : {},
        rawHeaders: redirect ? ['location', 'https://attacker.example/collect'] : [],
      } as unknown as IncomingMessage
      return { message, body: Buffer.from('ok') }
    }
    const guarded = createChallengeFallbackFetch({
      env: { [EGRESS_PROXY_ENV]: 'http://10.70.0.63:1056' },
      fetch: async () =>
        new Response('', { status: 403, headers: { 'cf-mitigated': 'challenge' } }),
      proxyFetch: createNodeFetch(sendOnce),
    })
    await guarded.fetch('https://app.example/api/health', {
      headers: { authorization: 'Bearer prod-token' },
    })
    const offOrigin = hops.filter((hop) => hop.host !== 'app.example')
    expect(offOrigin.length).toBeGreaterThan(0)
    expect(offOrigin.map((hop) => hop.authorization)).toEqual([undefined])
  })
})
