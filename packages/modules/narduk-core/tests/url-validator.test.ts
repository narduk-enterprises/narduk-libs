import { describe, expect, it, vi } from 'vitest'

import { fetchWithValidatedRedirects, validateUrl } from '../runtime/server/utils/urlValidator'

vi.mock('node:dns/promises', () => ({
  resolve4: vi.fn(async () => ['93.184.216.34']),
  resolve6: vi.fn(async () => {
    throw Object.assign(new Error('none'), { code: 'ENODATA' })
  }),
}))

describe('validateUrl loopback spellings', () => {
  it.each(['http://127.0.0.1/', 'http://2130706433/', 'http://127.1/'])(
    'rejects %s in production',
    (url) => {
      expect(validateUrl(url).valid).toBe(false)
    },
  )
})

describe('fetchWithValidatedRedirects', () => {
  it('blocks a redirect to a loopback address', async () => {
    const realFetch = globalThis.fetch
    globalThis.fetch = vi.fn(
      async () => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/' } }),
    ) as typeof fetch
    try {
      const result = await fetchWithValidatedRedirects('http://example.com/')
      expect(result.ok).toBe(false)
      expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    } finally {
      globalThis.fetch = realFetch
    }
  })
})
