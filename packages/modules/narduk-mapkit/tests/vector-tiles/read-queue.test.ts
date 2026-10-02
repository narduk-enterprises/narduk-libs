import { describe, expect, it, vi } from 'vitest'

import { buildDecodedVectorTile, createVectorTileOverlaySource } from '../../src/client/index.js'
import { createPmTilesTileSource } from '../../src/client/pmtiles.js'

import { createFakeCanvas, until } from './fake-canvas.js'

import type { DecodedVectorTile } from '../../src/client/index.js'
import type { FakeCanvas } from './fake-canvas.js'

const line = buildDecodedVectorTile(4096, [
  {
    lines: [
      [
        { x: 0, y: 0 },
        { x: 4096, y: 4096 },
      ],
    ],
    properties: { so: 1 },
  },
])

interface Read {
  abort: boolean
  finish: (bytes: Uint8Array | null) => void
  fail: (reason: unknown) => void
  signal: AbortSignal | undefined
  x: number
  y: number
  z: number
}

/** A `tileBytes` whose reads stay open until the test finishes them. */
function controlledReads() {
  const reads: Read[] = []
  const order: string[] = []
  let active = 0
  let peak = 0
  const tileBytes = (z: number, x: number, y: number, signal?: AbortSignal) => {
    order.push(`${z}/${x}/${y}`)
    active += 1
    peak = Math.max(peak, active)
    return new Promise<Uint8Array | null>((resolve, reject) => {
      const read: Read = {
        abort: false,
        fail: reject,
        finish: (bytes) => {
          active -= 1
          resolve(bytes)
        },
        signal,
        x,
        y,
        z,
      }
      signal?.addEventListener('abort', () => {
        read.abort = true
        active -= 1
        reject(new DOMException('aborted', 'AbortError'))
      })
      reads.push(read)
    })
  }
  return { order, peak: () => peak, reads, tileBytes }
}

function source(
  tileBytes: ReturnType<typeof controlledReads>['tileBytes'],
  extra: { onError?: (reason: unknown) => void; readConcurrency?: number } = {},
) {
  const decode = vi.fn(async (): Promise<DecodedVectorTile | null> => line)
  const overlay = createVectorTileOverlaySource<FakeCanvas>({
    createCanvas: createFakeCanvas,
    decode,
    style: () => ({ color: '#2563eb', width: 1 }),
    tileBytes,
    ...extra,
  })
  return { decode, overlay }
}

const bytes = new Uint8Array([1])

async function noTile(): Promise<{ data: ArrayBuffer } | undefined> {
  return
}

describe('read queue', () => {
  it('serves the newest request first', async () => {
    const control = controlledReads()
    const { overlay } = source(control.tileBytes, { readConcurrency: 1 })

    const pending = [0, 1, 2, 3].map((x) => overlay.imageForTile(x, 0, 5, 1))
    // The first starts at once; B, C, D wait.
    expect(control.order).toEqual(['5/0/0'])

    control.reads[0]?.finish(bytes)
    await until(() => control.order.length === 2, 'second read')
    control.reads[1]?.finish(bytes)
    await until(() => control.order.length === 3, 'third read')
    control.reads[2]?.finish(bytes)
    await until(() => control.order.length === 4, 'fourth read')
    control.reads[3]?.finish(bytes)

    expect(control.order).toEqual(['5/0/0', '5/3/0', '5/2/0', '5/1/0'])
    await Promise.all(pending)
  })

  it('never has more reads in flight than the concurrency limit', async () => {
    const control = controlledReads()
    const { overlay } = source(control.tileBytes, { readConcurrency: 3 })

    const pending = Array.from({ length: 10 }, (_, x) => overlay.imageForTile(x, 0, 5, 1))
    expect(control.order).toHaveLength(3)

    let finished = 0
    while (finished < 10) {
      await until(() => control.reads.length > finished, 'a read to finish')
      control.reads[finished]?.finish(bytes)
      finished += 1
      await Promise.resolve()
    }
    await Promise.all(pending)

    expect(control.order).toHaveLength(10)
    expect(control.peak()).toBe(3)
  })

  it('drops a queued request for a zoom the map has left before it reads', async () => {
    const control = controlledReads()
    const onError = vi.fn()
    const { overlay } = source(control.tileBytes, { onError, readConcurrency: 1 })

    const first = overlay.imageForTile(0, 0, 5, 1)
    const queued = overlay.imageForTile(1, 0, 5, 1)
    expect(control.order).toEqual(['5/0/0'])

    // The map zooms in: zoom 5 is no longer wanted.
    const current = overlay.imageForTile(2, 0, 6, 1)
    await expect(queued).resolves.toBeNull()
    // The running zoom-5 read was aborted, which frees the slot for zoom 6.
    await until(() => control.order.length === 2, 'zoom 6 read')
    expect(control.order).toEqual(['5/0/0', '6/2/0'])
    expect(control.order).not.toContain('5/1/0')

    control.reads[1]?.finish(bytes)
    await expect(current).resolves.not.toBeNull()
    await expect(first).resolves.toBeNull()
    expect(onError).not.toHaveBeenCalled()
  })

  it('aborts an in-flight read through the signal tileBytes was given', async () => {
    const control = controlledReads()
    const onError = vi.fn()
    const { decode, overlay } = source(control.tileBytes, { onError })

    const stale = overlay.imageForTile(0, 0, 5, 1)
    const read = control.reads[0]
    expect(read?.signal).toBeInstanceOf(AbortSignal)
    expect(read?.signal?.aborted).toBe(false)

    void overlay.imageForTile(0, 0, 6, 1)
    expect(read?.signal?.aborted).toBe(true)
    expect(read?.abort).toBe(true)

    await expect(stale).resolves.toBeNull()
    expect(decode).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
  })

  it('does not retain a read whose tileBytes ignores the abort and resolves anyway', async () => {
    const control = controlledReads()
    const { decode, overlay } = source(
      (z, x, y, signal) => {
        void control.tileBytes(z, x, y, signal).catch(() => {})
        return Promise.resolve(bytes)
      },
      { readConcurrency: 1 },
    )
    const stale = overlay.imageForTile(0, 0, 5, 1)
    const current = overlay.imageForTile(0, 0, 6, 1)
    await expect(stale).resolves.toBeNull()
    await expect(current).resolves.not.toBeNull()
    expect(decode).toHaveBeenCalledTimes(1)
    expect(decode).toHaveBeenCalledWith(bytes, { x: 0, y: 0, z: 6 })
    // Only the zoom-6 tile was kept.
    expect(overlay.size).toBe(1)
  })

  it('loads a dropped tile when it is asked for again, without onError', async () => {
    const control = controlledReads()
    const onError = vi.fn()
    const { overlay } = source(control.tileBytes, { onError, readConcurrency: 1 })

    const dropped = overlay.imageForTile(0, 0, 5, 1)
    void overlay.imageForTile(0, 0, 6, 1)
    await expect(dropped).resolves.toBeNull()
    expect(overlay.size).toBe(0)

    // Back to zoom 5: the same address is a fresh read, not the dead one.
    const again = overlay.imageForTile(0, 0, 5, 1)
    await until(() => control.reads.some((read) => read.z === 5 && !read.abort), 'fresh read')
    control.reads.find((read) => read.z === 5 && !read.abort)?.finish(bytes)
    const canvas = await again
    expect(canvas).not.toBeNull()
    expect(overlay.size).toBe(1)
    expect(onError).not.toHaveBeenCalled()
  })

  it('still reports a real read failure', async () => {
    const control = controlledReads()
    const onError = vi.fn()
    const { overlay } = source(control.tileBytes, { onError })
    const pending = overlay.imageForTile(0, 0, 5, 1)
    control.reads[0]?.fail(new Error('range 500'))
    await expect(pending).resolves.toBeNull()
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('keeps joining a duplicate request onto the one read', async () => {
    const control = controlledReads()
    const { decode, overlay } = source(control.tileBytes)
    const pending = [overlay.imageForTile(1, 1, 5, 1), overlay.imageForTile(1, 1, 5, 1)]
    expect(control.order).toEqual(['5/1/1'])
    control.reads[0]?.finish(bytes)
    await Promise.all(pending)
    expect(decode).toHaveBeenCalledTimes(1)
  })
})

describe('pmtiles tile source and cancellation', () => {
  it('does not report a read aborted through its signal', async () => {
    const onError = vi.fn()
    const controller = new AbortController()
    const tiles = createPmTilesTileSource({
      onError,
      reader: {
        getZxy: (_z, _x, _y, signal) =>
          new Promise((_resolve, reject) => {
            signal?.addEventListener('abort', () => reject(new DOMException('x', 'AbortError')))
          }),
      },
    })
    const pending = tiles.getTile(1, 0, 0, controller.signal)
    controller.abort()
    await expect(pending).resolves.toBeNull()
    expect(onError).not.toHaveBeenCalled()
  })

  it('still reports a failure that is not an abort', async () => {
    const onError = vi.fn()
    const tiles = createPmTilesTileSource({
      onError,
      reader: { getZxy: () => Promise.reject(new Error('boom')) },
    })
    await expect(tiles.getTile(1, 0, 0, new AbortController().signal)).resolves.toBeNull()
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('reports the archive max zoom from the header, once, and undefined without one', async () => {
    const getHeader = vi.fn(async () => ({ maxZoom: 12 }))
    const withHeader = createPmTilesTileSource({
      reader: { getHeader, getZxy: noTile },
    })
    await expect(withHeader.getMaxZoom?.()).resolves.toBe(12)
    await expect(withHeader.getMaxZoom?.()).resolves.toBe(12)
    expect(getHeader).toHaveBeenCalledTimes(1)

    const without = createPmTilesTileSource({ reader: { getZxy: noTile } })
    await expect(without.getMaxZoom?.()).resolves.toBeUndefined()

    const failing = createPmTilesTileSource({
      reader: { getHeader: () => Promise.reject(new Error('down')), getZxy: noTile },
    })
    await expect(failing.getMaxZoom?.()).resolves.toBeUndefined()
  })
})
