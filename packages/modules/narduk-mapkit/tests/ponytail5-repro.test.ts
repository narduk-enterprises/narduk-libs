// ponytail-5 audit regression tests
import { describe, expect, it } from 'vitest'

import { createServer } from 'node:http'
import { connect } from 'node:net'

import { createApp, defineEventHandler, getRequestURL, toNodeListener } from 'h3'

import { buildDecodedVectorTile, createVectorTileOverlaySource } from '../src/client/index.js'
import { mapKitRoutedOrigin, mapKitTokenResponse } from '../src/server/index.js'
import { createTestPrivateKeyPem } from './test-keys.js'

import type { AddressInfo } from 'node:net'
import type { VectorTileCanvas } from '../src/client/index.js'

function createCanvas(width: number, height: number): VectorTileCanvas {
  const noop = () => {}
  const context = new Proxy({} as Record<string, unknown>, {
    get: (target, key: string) => (key in target ? target[key] : noop),
    set: (target, key: string, value) => {
      target[key] = value
      return true
    },
  })
  return { getContext: () => context, height, width } as unknown as VectorTileCanvas
}

const oneReach = buildDecodedVectorTile(4096, [
  {
    lines: [
      [
        { x: 0, y: 0 },
        { x: 4096, y: 4096 },
      ],
    ],
    properties: { ri: 1, so: 5 },
  },
])

describe('mapkit-src #1: in-flight vector tile after clearCache', () => {
  it('does not paint a tile whose read began before clearCache (archive swap)', async () => {
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const source = createVectorTileOverlaySource<VectorTileCanvas>({
      createCanvas,
      decode: () => Promise.resolve(oneReach),
      style: () => ({ color: '#0e7490', width: 1 }),
      tileBytes: async () => {
        await gate
        return new Uint8Array([1])
      },
    })
    const pending = source.imageForTile(31, 48, 7, 1)
    source.clearCache()
    release?.()
    // The old archive's tile must not be handed to MapKit.
    expect(await pending).toBeNull()
  })
})

describe('mapkit-src #3: copied Nuxt token example builds self from a spoofable URL', () => {
  it('mints nothing for an absolute-form request line when self is built as the example does', async () => {
    const config = {
      keyId: 'KEY1234567',
      privateKey: await createTestPrivateKeyPem(),
      teamId: 'TEAM123456',
    }
    const app = createApp()
    app.use(
      defineEventHandler(async (event) => {
        // Mirrors examples/nuxt-mapkit-token.get.ts
        const self = mapKitRoutedOrigin({
          derivedOrigin: getRequestURL(event, { xForwardedHost: false }).origin,
          request: event.web?.request,
          requestTarget: event.node.req.originalUrl ?? event.path,
        })
        const request = new Request(getRequestURL(event).toString(), {
          headers: event.headers,
          method: event.method,
        })
        return await mapKitTokenResponse(request, config, { self })
      }),
    )
    const server = createServer(toNodeListener(app))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    try {
      const raw = await new Promise<string>((resolve, reject) => {
        const socket = connect(port, '127.0.0.1', () => {
          socket.write(
            [
              'GET https://evil.example/api/mapkit-token HTTP/1.1',
              'Host: evil.example',
              'Sec-Fetch-Site: same-origin',
              'Connection: close',
              '',
              '',
            ].join('\r\n'),
          )
        })
        const chunks: Buffer[] = []
        socket.on('data', (chunk: Buffer) => chunks.push(chunk))
        socket.on('error', reject)
        socket.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      })
      expect(raw).not.toContain('"token"')
      expect(raw).toContain('403 ')
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})
