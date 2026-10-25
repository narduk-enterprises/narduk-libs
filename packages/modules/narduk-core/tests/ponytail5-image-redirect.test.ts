import { createServer, request } from 'node:http'

import { createApp, createRouter, toNodeListener } from 'h3'
import { describe, expect, it, vi } from 'vitest'

import handler from '../runtime/server/routes/cdn-cgi/image/[...path]'

vi.mock('../runtime/server/utils/logger', () => {
  const logger = { debug: vi.fn(), warn: vi.fn(), child: () => logger }
  return { useLogger: () => logger }
})

async function rawGet(rawPath: string): Promise<{ location?: string; status: number }> {
  const router = createRouter().get('/cdn-cgi/image/**:path', handler)
  const server = createServer(toNodeListener(createApp().use(router)))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected TCP listener')
  try {
    // node:http sends the path verbatim; fetch() would normalize dot-segments away.
    return await new Promise((resolve, reject) => {
      const req = request(
        { host: '127.0.0.1', port: address.port, path: rawPath, method: 'GET' },
        (res) => {
          res.resume()
          resolve({ status: res.statusCode ?? 0, location: res.headers.location })
        },
      )
      req.on('error', reject)
      req.end()
    })
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

describe('ponytail-5 local image redirect guard (core-tests #11)', () => {
  it('sanity: /_og/ path redirects', async () => {
    const res = await rawGet('/cdn-cgi/image/w=80/_og/a.png')
    expect(res.location).toBe('/_og/a.png')
  })
  it('does not redirect outside /_og/ via dot-segments', async () => {
    const res = await rawGet('/cdn-cgi/image/w=80/_og/../../api/secret')
    expect(res.status).toBe(404)
    expect(res.location).toBeUndefined()
  })
})
