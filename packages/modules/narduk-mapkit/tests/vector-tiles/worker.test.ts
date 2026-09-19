import { buildDecodedVectorTile, createWorkerDecoder } from '../../src/client/index.js'
import { createMvtDecoder, serveVectorTileDecoder } from '../../src/vector-tiles/index.js'

import { encodeVectorTile } from './fixture.js'

import type { DecodedVectorTile } from '../../src/client/index.js'

type Listener = (event: { data: unknown }) => void

/**
 * Two ends of a message channel, delivered synchronously.
 *
 * A real `Worker` would need a bundler and a thread; the protocol under test
 * is the message shape and the id correlation, and both are visible here.
 * Transfers are modelled honestly: a transferred buffer is recorded, so a test
 * can assert the bytes moved rather than being copied.
 */
function createChannel() {
  const toWorker: Listener[] = []
  const toMain: Listener[] = []
  const transferred: Transferable[][] = []

  const workerScope = {
    addEventListener: (_type: 'message', listener: Listener) => toWorker.push(listener),
    postMessage: (message: unknown, transfer?: Transferable[]) => {
      if (transfer) transferred.push(transfer)
      for (const listener of [...toMain]) listener({ data: message })
    },
    removeEventListener: (_type: 'message', listener: Listener) => {
      const index = toWorker.indexOf(listener)
      if (index >= 0) toWorker.splice(index, 1)
    },
  }

  const workerPort = {
    addEventListener: (_type: 'message', listener: Listener) => toMain.push(listener),
    postMessage: (message: unknown, transfer?: Transferable[]) => {
      if (transfer) transferred.push(transfer)
      for (const listener of [...toWorker]) listener({ data: message })
    },
    removeEventListener: (_type: 'message', listener: Listener) => {
      const index = toMain.indexOf(listener)
      if (index >= 0) toMain.splice(index, 1)
    },
  }

  return { transferred, workerPort, workerScope }
}

const address = { x: 31, y: 48, z: 7 }

const oneReach = encodeVectorTile([
  {
    features: [
      {
        lines: [
          [
            { x: 0, y: 0 },
            { x: 2048, y: 2048 },
          ],
        ],
        properties: { ri: 9, so: 6 },
        type: 2,
      },
    ],
    name: 'reaches',
  },
])

describe('the worker decode protocol', () => {
  it('decodes a real tile across the channel and rebuilds the typed arrays', async () => {
    const { transferred, workerPort, workerScope } = createChannel()
    serveVectorTileDecoder(workerScope, createMvtDecoder())
    const decoder = createWorkerDecoder({ worker: workerPort })

    const tile = (await decoder.decode(oneReach, address)) as DecodedVectorTile

    expect(tile.extent).toBe(4096)
    expect(tile.coordinates).toBeInstanceOf(Int16Array)
    expect([...tile.coordinates]).toEqual([0, 0, 2048, 2048])
    expect(tile.properties[0]).toEqual({ ri: 9, so: 6 })
    expect(decoder.pending).toBe(0)
    // Request bytes out, then the three tile buffers back: nothing is copied.
    expect(transferred.map((batch) => batch.length)).toEqual([1, 3])
  })

  it('correlates replies by id, so one worker serves a screenful at once', async () => {
    const { workerPort, workerScope } = createChannel()
    const order: number[] = []
    serveVectorTileDecoder(workerScope, (bytes) => {
      order.push(bytes.length)
      return Promise.resolve(
        buildDecodedVectorTile(4096, [
          {
            lines: [
              [
                { x: bytes.length, y: 0 },
                { x: bytes.length, y: 10 },
              ],
            ],
            properties: { size: bytes.length },
          },
        ]),
      )
    })
    const decoder = createWorkerDecoder({ worker: workerPort })

    const tiles = await Promise.all([
      decoder.decode(new Uint8Array(3), address),
      decoder.decode(new Uint8Array(5), address),
      decoder.decode(new Uint8Array(7), address),
    ])

    expect(order).toEqual([3, 5, 7])
    expect(tiles.map((tile) => tile?.properties[0]?.size)).toEqual([3, 5, 7])
  })

  it('passes an empty tile through as null rather than as a failure', async () => {
    const { workerPort, workerScope } = createChannel()
    serveVectorTileDecoder(workerScope, () => Promise.resolve(null))
    const decoder = createWorkerDecoder({ worker: workerPort })

    await expect(decoder.decode(new Uint8Array(1), address)).resolves.toBeNull()
  })

  it('carries a decode failure back as a rejection instead of an unhandled error', async () => {
    const { workerPort, workerScope } = createChannel()
    serveVectorTileDecoder(workerScope, () => Promise.reject(new Error('bad protobuf')))
    const decoder = createWorkerDecoder({ worker: workerPort })

    await expect(decoder.decode(new Uint8Array(1), address)).rejects.toThrow('bad protobuf')
    expect(decoder.pending).toBe(0)
  })

  it('fails one tile when the worker never answers, rather than hanging the overlay', async () => {
    const { workerPort } = createChannel()
    let fire: (() => void) | undefined
    const decoder = createWorkerDecoder({
      scheduleTimeout: (run) => {
        fire = run
        return () => {
          fire = undefined
        }
      },
      timeoutMs: 250,
      worker: workerPort,
    })

    const pending = decoder.decode(new Uint8Array(1), address)
    expect(decoder.pending).toBe(1)
    fire?.()

    await expect(pending).rejects.toThrow('vector tile decode timed out after 250ms')
    expect(decoder.pending).toBe(0)
  })

  it('fails every in-flight decode on dispose and refuses new ones', async () => {
    const { workerPort } = createChannel()
    const decoder = createWorkerDecoder({ worker: workerPort })

    const pending = decoder.decode(new Uint8Array(1), address)
    decoder.dispose()
    decoder.dispose()

    await expect(pending).rejects.toThrow('disposed')
    await expect(decoder.decode(new Uint8Array(1), address)).rejects.toThrow('disposed')
    expect(decoder.pending).toBe(0)
  })

  it('copies the bytes instead of transferring them when asked', async () => {
    const { transferred, workerPort, workerScope } = createChannel()
    serveVectorTileDecoder(workerScope, () => Promise.resolve(null))
    const decoder = createWorkerDecoder({ transfer: false, worker: workerPort })

    await decoder.decode(new Uint8Array(4), address)

    expect(transferred).toEqual([])
  })

  it('sends only the view it was given, not the buffer behind it', async () => {
    const { workerPort, workerScope } = createChannel()
    const seen: number[][] = []
    serveVectorTileDecoder(workerScope, (bytes) => {
      seen.push([...bytes])
      return Promise.resolve(null)
    })
    const decoder = createWorkerDecoder({ worker: workerPort })

    // What a decompressor, a `subarray`, or a pooled read hands back: a view
    // that starts partway into a larger buffer. Posting the whole buffer
    // would decode the wrong bytes and detach an array the caller still owns.
    const pool = new Uint8Array([9, 9, 1, 2, 3, 9, 9])
    const view = pool.subarray(2, 5)
    await decoder.decode(view, address)

    expect(seen).toEqual([[1, 2, 3]])
    expect([...pool]).toEqual([9, 9, 1, 2, 3, 9, 9])
  })

  it('matches replies to requests by id even when they come back out of order', async () => {
    const { workerPort, workerScope } = createChannel()
    const queued: Array<() => void> = []
    // A scope that holds each reply until the test releases it, so the
    // answers can be delivered in the opposite order to the requests.
    const deferred = {
      ...workerScope,
      postMessage: (message: unknown, transfer?: Transferable[]) => {
        queued.push(() => workerScope.postMessage(message, transfer))
      },
    }
    serveVectorTileDecoder(deferred, (bytes) =>
      Promise.resolve(
        buildDecodedVectorTile(4096, [
          {
            lines: [
              [
                { x: 0, y: 0 },
                { x: 1, y: 1 },
              ],
            ],
            properties: { size: bytes.length },
          },
        ]),
      ),
    )
    const decoder = createWorkerDecoder({ worker: workerPort })

    const first = decoder.decode(new Uint8Array(3), address)
    const second = decoder.decode(new Uint8Array(5), address)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(queued).toHaveLength(2)
    for (const send of [...queued].reverse()) send()

    expect((await first)?.properties[0]?.size).toBe(3)
    expect((await second)?.properties[0]?.size).toBe(5)
  })
})
