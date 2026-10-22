import { createServer } from 'node:http'

import { createApp, eventHandler, toNodeListener } from 'h3'
import { describe, expect, it } from 'vitest'

import { enforceUploadBodyByteCap, parseMultipartBody } from '../../runtime/server/utils/upload.js'

import type { AddressInfo } from 'node:net'

const BOUNDARY = 'XBOUND'

function multipart(size: number): Buffer {
  return Buffer.concat([
    Buffer.from(
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n`,
    ),
    Buffer.alloc(size, 1),
    Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
  ])
}

describe('ponytail-5 #3 multipart heap blow-up', () => {
  it('parseMultipartBody (what upload.post.js calls) stays near the body size', async () => {
    const size = 4 * 1024 * 1024
    const ct = `multipart/form-data; boundary=${BOUNDARY}`
    const body = multipart(size)
    const before = process.memoryUsage().heapUsed
    const parts = parseMultipartBody(body, ct)
    const deltaMb = (process.memoryUsage().heapUsed - before) / 1024 / 1024
    expect(parts?.[0]?.data.length).toBe(size)
    // A slice-based parse costs ~1x body (4MB). Per-byte array push costs ~35x.
    expect(deltaMb, `heap grew ${deltaMb.toFixed(0)}MB for a 4MB part`).toBeLessThan(16)
  })
})

describe('ponytail-5 #14 Node cap listener ordering', () => {
  it('the route order (bounded read, parser) still delivers the body to the parser', async () => {
    const body = multipart(32)
    let parsed: unknown
    let failure: unknown
    const app = createApp()
    app.use(
      eventHandler(async (event) => {
        try {
          const bounded = await enforceUploadBodyByteCap(event, 10 * 1024 * 1024)
          parsed = parseMultipartBody(bounded, event.node.req.headers['content-type'])
        } catch (error) {
          failure = error
        }
        return 'ok'
      }),
    )
    const server = createServer(toNodeListener(app))
    await new Promise<void>((resolve) => server.listen(0, resolve))
    const { port } = server.address() as AddressInfo
    try {
      const abort = AbortSignal.timeout(2000)
      await fetch(`http://127.0.0.1:${port}/`, {
        method: 'POST',
        headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
        body,
        signal: abort,
      }).catch(() => {})
    } finally {
      server.closeAllConnections()
      await new Promise((resolve) => server.close(resolve))
    }
    expect(failure).toBeUndefined()
    expect(parsed, 'multipart parser received no body').toHaveLength(1)
  })
})

describe('parseMultipartBody shape', () => {
  it('returns h3-shaped parts for files, fields and empty parts', () => {
    const body = Buffer.from(
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="a"\r\n\r\nhello\r\n` +
        `--${BOUNDARY}\r\nContent-Disposition: form-data; name="f"; filename="x.png"\r\nContent-Type: image/png\r\n\r\n\r\n` +
        `--${BOUNDARY}--\r\n`,
    )
    const parts = parseMultipartBody(body, `multipart/form-data; boundary="${BOUNDARY}"`)
    expect(parts).toEqual([
      { data: Buffer.from('hello'), name: 'a' },
      { data: Buffer.alloc(0), filename: 'x.png', name: 'f', type: 'image/png' },
    ])
    expect(parseMultipartBody(body, 'multipart/form-data')).toBeUndefined()
  })
})
