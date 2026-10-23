import { createServer } from 'node:http'

import { createApp, toNodeListener } from 'h3'
import { describe, expect, it, vi } from 'vitest'

import cors from '../runtime/server/middleware/cors'

vi.mock('nitropack/runtime', () => ({
  useRuntimeConfig: () => ({ corsAllowedOrigins: 'https://a.example, https://b.example' }),
}))

async function get(path: string, origin: string): Promise<Headers> {
  const app = createApp()
    .use(cors)
    .use(() => 'ok')
  const server = createServer(toNodeListener(app))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected TCP listener')
  try {
    return (await fetch(`http://127.0.0.1:${address.port}${path}`, { headers: { origin } })).headers
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
}

describe('cors middleware', () => {
  it('reflects an origin on the allow list, without credentials', async () => {
    const headers = await get('/api/items', 'https://b.example')
    expect(headers.get('access-control-allow-origin')).toBe('https://b.example')
    expect(headers.get('access-control-allow-credentials')).toBeNull()
  })

  it('adds nothing for an origin that is not listed', async () => {
    const headers = await get('/api/items', 'https://evil.example')
    expect(headers.get('access-control-allow-origin')).toBeNull()
  })

  it('reflects an extension origin only on the scraper-extension prefix', async () => {
    const extension = 'chrome-extension://abcdef'
    expect(
      (await get('/api/admin/scraper-extension/ping', extension)).get(
        'access-control-allow-origin',
      ),
    ).toBe(extension)
    expect((await get('/api/admin/other', extension)).get('access-control-allow-origin')).toBeNull()
  })
})
