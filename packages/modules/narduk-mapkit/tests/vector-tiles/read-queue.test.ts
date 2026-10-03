import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  buildDecodedVectorTile,
  createVectorTileOverlaySource,
  VECTOR_TILE_DROP_REFRESH_MS,
} from '../../src/client/index.js'
import { createPmTilesTileSource } from '../../src/client/pmtiles.js'

import { createFakeCanvas, until } from './fake-canvas.js'

import type { DecodedVectorTile, VectorTileRestyleHost } from '../../src/client/index.js'
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
  done?: boolean
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

/**
 * MapKit as the source sees it: each tile keeps the last image it was given,
 * `null` included, and is asked for again only when the overlay is swapped.
 */
function fakeMapKit(view: Array<[number, number, number]>) {
  const shown = new Map<string, unknown>()
  let replaces = 0
  const host: VectorTileRestyleHost<FakeCanvas> = {
    layerId: 'network',
    async replace(_id, descriptor) {
      replaces += 1
      await Promise.all(
        view.map(async ([x, y, z]) => {
          shown.set(`${z}/${x}/${y}`, await descriptor.imageForTile(x, y, z, 3))
        }),
      )
    },
  }
  return {
    host,
    replaces: () => replaces,
    show: (key: string, image: unknown) => shown.set(key, image),
    blank: () =>
      view.filter(([x, y, z]) => !shown.get(`${z}/${x}/${y}`)).map(([x, y, z]) => `${z}/${x}/${y}`),
  }
}

describe('tiles dropped for a zoom change', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('asks again for every tile on screen once requests interleaved across z10 and z11 settle on z11', async () => {
    vi.useFakeTimers()
    const control = controlledReads()
    const z11: Array<[number, number, number]> = [0, 1, 2, 3, 4, 5].map((x) => [x, 0, 11])
    const mapkit = fakeMapKit(z11)
    const { overlay } = source(control.tileBytes, { readConcurrency: 2 })
    overlay.setRestyleHost(mapkit.host)
    const ask = (x: number, z: number) =>
      overlay.imageForTile(x, 0, z, 3).then((image) => mapkit.show(`${z}/${x}/0`, image))

    // A pinch on iOS: z11 tiles, then the neighbouring zoom, then z11 again.
    const asks = [0, 1, 2, 3].map((x) => ask(x, 11))
    asks.push(...[0, 1].map((x) => ask(x, 10)))
    asks.push(...[4, 5].map((x) => ask(x, 11)))
    for (let turn = 0; turn < 4; turn += 1) {
      await until(() => control.reads.some((read) => !read.abort && !read.done), 'a live read')
      const live = control.reads.find((read) => !read.abort && !read.done)
      if (!live) break
      live.done = true
      live.finish(bytes)
      if (
        z11.every(([x]) => control.reads.some((read) => read.z === 11 && read.x === x && read.done))
      )
        break
      if (!control.reads.some((read) => !read.abort && !read.done)) break
    }
    await Promise.all(asks)
    // Without a refresh, the z11 tiles dropped by the z10 asks stay blank.
    expect(mapkit.blank().length).toBeGreaterThan(0)
    expect(mapkit.replaces()).toBe(0)

    // The zoom settles: after the quiet period the overlay is swapped and re-asked.
    vi.advanceTimersByTime(VECTOR_TILE_DROP_REFRESH_MS)
    await until(() => mapkit.replaces() === 1, 'refresh')
    for (let turn = 0; turn < 20 && mapkit.blank().length > 0; turn += 1) {
      const live = control.reads.find((read) => !read.abort && !read.done)
      if (live) {
        live.done = true
        live.finish(bytes)
      }
      await Promise.resolve()
      await Promise.resolve()
    }
    await until(() => mapkit.blank().length === 0, 'every z11 tile painted')
    expect(mapkit.replaces()).toBe(1)
  })

  it('waits for requests to stop before refreshing, and refreshes once', async () => {
    vi.useFakeTimers()
    const control = controlledReads()
    const mapkit = fakeMapKit([])
    const { overlay } = source(control.tileBytes, { readConcurrency: 1 })
    overlay.setRestyleHost(mapkit.host)

    void overlay.imageForTile(0, 0, 10, 3)
    void overlay.imageForTile(1, 0, 10, 3)
    void overlay.imageForTile(0, 0, 11, 3)
    // Still asking every frame: no refresh yet.
    for (let frame = 0; frame < 5; frame += 1) {
      vi.advanceTimersByTime(VECTOR_TILE_DROP_REFRESH_MS - 1)
      void overlay.imageForTile(frame, 1, 11, 3)
    }
    expect(mapkit.replaces()).toBe(0)
    vi.advanceTimersByTime(VECTOR_TILE_DROP_REFRESH_MS)
    await until(() => mapkit.replaces() === 1, 'refresh')
    vi.advanceTimersByTime(VECTOR_TILE_DROP_REFRESH_MS * 4)
    await Promise.resolve()
    expect(mapkit.replaces()).toBe(1)
  })

  it('never refreshes when nothing was dropped', async () => {
    vi.useFakeTimers()
    const control = controlledReads()
    const mapkit = fakeMapKit([])
    const { overlay } = source(control.tileBytes)
    overlay.setRestyleHost(mapkit.host)
    const pending = overlay.imageForTile(0, 0, 11, 3)
    control.reads[0]?.finish(bytes)
    await expect(pending).resolves.not.toBeNull()
    vi.advanceTimersByTime(VECTOR_TILE_DROP_REFRESH_MS * 4)
    await Promise.resolve()
    expect(mapkit.replaces()).toBe(0)
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
