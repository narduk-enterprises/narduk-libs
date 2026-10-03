import {
  buildDecodedVectorTile,
  createVectorTileOverlaySource,
  createWorkerPainter,
  createWorkerTileService,
  paintVectorTile,
  portableVectorTileStyle,
  VECTOR_TILE_PAINT_CHANNEL,
  vectorTileStyleSpec,
} from '../../src/client/index.js'
import {
  copyVectorTile,
  createMvtDecoder,
  serveVectorTileWorker,
} from '../../src/vector-tiles/index.js'

import { createFakeCanvas } from './fake-canvas.js'
import { encodeVectorTile } from './fixture.js'

import type {
  DecodedVectorTile,
  VectorTileClassStyle,
  VectorTileOverlayStyle,
  VectorTileStyleFunction,
} from '../../src/client/index.js'
import type { VectorTileWorkerCanvas } from '../../src/vector-tiles/index.js'
import type { FakeCanvas, PaintCall } from './fake-canvas.js'

type Listener = (event: { data: unknown }) => void

/** A fake `ImageBitmap`: what the worker canvas recorded when it was handed over. */
interface FakeBitmap {
  calls: PaintCall[]
  height: number
  width: number
}

/**
 * Both ends of a worker, delivered synchronously, with every message logged.
 * A transfer is recorded so a test can tell a moved buffer from a copied one.
 */
function createChannel() {
  const toWorker: Listener[] = []
  const toMain: Listener[] = []
  const sentToWorker: unknown[] = []
  const transferredToMain: Transferable[][] = []

  const workerScope = {
    addEventListener: (_type: 'message', listener: Listener) => toWorker.push(listener),
    postMessage: (message: unknown, transfer?: Transferable[]) => {
      if (transfer) transferredToMain.push(transfer)
      for (const listener of [...toMain]) listener({ data: message })
    },
  }
  const workerPort = {
    addEventListener: (_type: 'message', listener: Listener) => toMain.push(listener),
    postMessage: (message: unknown) => {
      sentToWorker.push(message)
      for (const listener of [...toWorker]) listener({ data: message })
    },
    removeEventListener: (_type: 'message', listener: Listener) => {
      const index = toMain.indexOf(listener)
      if (index >= 0) toMain.splice(index, 1)
    },
  }
  const paintMessages = () =>
    sentToWorker.filter(
      (message): message is { tile?: unknown; type: string } =>
        (message as { channel?: string }).channel === VECTOR_TILE_PAINT_CHANNEL &&
        (message as { type?: string }).type === 'paint',
    )
  const styleMessages = () =>
    sentToWorker.filter(
      (message) =>
        (message as { channel?: string }).channel === VECTOR_TILE_PAINT_CHANNEL &&
        (message as { type?: string }).type === 'style',
    )
  return { paintMessages, sentToWorker, styleMessages, transferredToMain, workerPort, workerScope }
}

/** A worker canvas whose bitmap is the list of draw calls made on it. */
function workerCanvases() {
  const made: FakeCanvas[] = []
  const createCanvas = (width: number, height: number): VectorTileWorkerCanvas => {
    const canvas = createFakeCanvas(width, height)
    made.push(canvas)
    return {
      ...canvas,
      transferToImageBitmap: () => {
        const bitmap: FakeBitmap = { calls: canvas.calls.splice(0), height, width }
        return bitmap as unknown as ImageBitmap
      },
    }
  }
  return { createCanvas, made }
}

const twoReaches = encodeVectorTile([
  {
    features: [
      {
        lines: [
          [
            { x: 0, y: 0 },
            { x: 2048, y: 2048 },
          ],
        ],
        properties: { si: 3, so: 6 },
        type: 2,
      },
      {
        lines: [
          [
            { x: 4096, y: 0 },
            { x: 1024, y: 3072 },
            { x: 0, y: 4096 },
          ],
        ],
        properties: { si: 4, so: 8 },
        type: 2,
      },
    ],
    name: 'rivers',
  },
])

interface RiverParams {
  colors: readonly string[]
  widthPerOrder: number
}

/** A style built from data, as an app's would be: colour and width by stream order. */
function riverStyle(params: RiverParams): VectorTileStyleFunction {
  return (properties) => {
    const order = typeof properties.so === 'number' ? properties.so : 1
    return {
      color: params.colors[order % params.colors.length] ?? '#000',
      width: order * params.widthPerOrder,
    }
  }
}

const styles = { river: riverStyle }

function setup(options: { canvas?: boolean } = {}) {
  const channel = createChannel()
  const worker = workerCanvases()
  serveVectorTileWorker(channel.workerScope, {
    createCanvas: options.canvas === false ? null : worker.createCanvas,
    decode: createMvtDecoder({ properties: ['si', 'so'] }),
    styles,
  })
  const service = createWorkerTileService<FakeBitmap>({
    enabled: true,
    toImage: (bitmap) => bitmap as unknown as FakeBitmap,
    worker: channel.workerPort,
  })
  const mainCanvases: FakeCanvas[] = []
  const errors: unknown[] = []
  const style = portableVectorTileStyle(
    'river',
    { colors: ['#a', '#b', '#c'], widthPerOrder: 0.25 },
    riverStyle,
  )
  const source = createVectorTileOverlaySource<FakeCanvas, FakeBitmap>({
    createCanvas: (width, height) => {
      const canvas = createFakeCanvas(width, height)
      mainCanvases.push(canvas)
      return canvas
    },
    decode: service.decode,
    onError: (reason) => errors.push(reason),
    painter: service.painter,
    style,
    tileBytes: async () => twoReaches,
  })
  return { channel, errors, mainCanvases, service, source, style, worker }
}

/** What the main-thread painter draws for the same tile and style, for comparison. */
async function paintedOnMain(style: VectorTileOverlayStyle, scale: number, z = 7) {
  const tile = (await createMvtDecoder({ properties: ['si', 'so'] })(twoReaches, {
    x: 0,
    y: 0,
    z,
  })) as DecodedVectorTile
  const canvas = createFakeCanvas(256 * scale, 256 * scale)
  paintVectorTile(canvas, tile, { pixelRatio: scale, style, tileSize: 256, zoom: z })
  return canvas.calls
}

describe('painting in the worker', () => {
  it('returns the worker bitmap and draws exactly what the main thread would', async () => {
    const { channel, errors, mainCanvases, source, style } = setup()

    const image = (await source.imageForTile(0, 0, 7, 2)) as FakeBitmap

    expect(errors).toEqual([])
    expect(mainCanvases).toHaveLength(0)
    expect(image.width).toBe(512)
    expect(image.calls).toEqual(await paintedOnMain(style, 2))
    // The bitmap moves to the main thread rather than being copied.
    expect(channel.transferredToMain.some((list) => list.includes(image as never))).toBe(true)
  })

  it('names the tile it decoded instead of sending it back', async () => {
    const { channel, source } = setup()

    await source.imageForTile(0, 0, 7, 1)
    await source.imageForTile(0, 0, 7, 2)

    const paints = channel.paintMessages()
    expect(paints).toHaveLength(2)
    expect(paints.every((message) => message.tile === undefined)).toBe(true)
  })

  it('posts a style once per style change, not once per tile', async () => {
    const { channel, source } = setup()

    await source.imageForTile(0, 0, 7, 1)
    await source.imageForTile(1, 0, 7, 1)
    expect(channel.styleMessages()).toHaveLength(1)

    source.setStyle(
      portableVectorTileStyle('river', { colors: ['#d'], widthPerOrder: 1 }, riverStyle),
    )
    await source.imageForTile(0, 0, 7, 1)
    expect(channel.styleMessages()).toHaveLength(2)
  })

  it('posts a class style once even though the overlay merges its table in', async () => {
    const channel = createChannel()
    const worker = workerCanvases()
    serveVectorTileWorker(channel.workerScope, {
      createCanvas: worker.createCanvas,
      decode: createMvtDecoder({ properties: ['si', 'so'] }),
    })
    const service = createWorkerTileService<FakeBitmap>({
      enabled: true,
      toImage: (bitmap) => bitmap as unknown as FakeBitmap,
      worker: channel.workerPort,
    })
    const paint = { color: '#123', width: 1 }
    const style: VectorTileClassStyle = {
      classTable: { classes: new Uint8Array([0, 0, 0, 1, 2]), length: 5, networkVersion: 1 },
      gaugeNotReporting: paint,
      noGauge: paint,
      paintByClass: [paint, { color: '#f00', width: 2 }, { color: '#0f0', width: 3 }],
      unknown: paint,
    }
    const source = createVectorTileOverlaySource<FakeCanvas, FakeBitmap>({
      createCanvas: createFakeCanvas,
      decode: service.decode,
      painter: service.painter,
      style,
      tileBytes: async () => twoReaches,
    })

    const image = (await source.imageForTile(0, 0, 7, 1)) as unknown as FakeBitmap
    await source.imageForTile(1, 0, 7, 1)

    expect(channel.styleMessages()).toHaveLength(1)
    expect(worker.made.length).toBeGreaterThan(0)
    expect(image.calls).toEqual(await paintedOnMain(style, 1))

    await source.setClassTable({
      classes: new Uint8Array([0, 0, 0, 2, 1]),
      length: 5,
      networkVersion: 1,
    })
    await source.imageForTile(0, 0, 7, 1)
    expect(channel.styleMessages()).toHaveLength(2)
  })

  it('paints an overzoomed child from the kept ancestor', async () => {
    const { channel, errors, mainCanvases, service, style } = setup()
    const source = createVectorTileOverlaySource<FakeCanvas, FakeBitmap>({
      createCanvas: (width, height) => {
        const canvas = createFakeCanvas(width, height)
        mainCanvases.push(canvas)
        return canvas
      },
      decode: service.decode,
      maxDataZoom: 7,
      onError: (reason) => errors.push(reason),
      painter: service.painter,
      style,
      tileBytes: async () => twoReaches,
    })

    const image = (await source.imageForTile(1, 1, 8, 1)) as FakeBitmap

    expect(errors).toEqual([])
    expect(mainCanvases).toHaveLength(0)
    const paint = channel.paintMessages().at(-1) as { overzoom?: unknown }
    expect(paint.overzoom).toEqual({ column: 1, levels: 1, row: 1 })

    const tile = (await createMvtDecoder({ properties: ['si', 'so'] })(twoReaches, {
      x: 0,
      y: 0,
      z: 7,
    })) as DecodedVectorTile
    const expected = createFakeCanvas(256, 256)
    paintVectorTile(expected, tile, {
      overzoom: { column: 1, levels: 1, row: 1 },
      pixelRatio: 1,
      style,
      tileSize: 256,
      zoom: 8,
    })
    expect(image.calls).toEqual(expected.calls)
  })
})

describe('falling back to the main thread', () => {
  it('paints a plain style function on the main thread without asking the worker', async () => {
    const { channel, mainCanvases, source } = setup()
    source.setStyle(() => ({ color: '#abc', width: 1 }))

    const image = await source.imageForTile(0, 0, 7, 1)

    expect(image).toBe(mainCanvases[0])
    expect(channel.paintMessages()).toHaveLength(0)
  })

  it('paints on the main thread once the worker says it has no canvas, and stops asking', async () => {
    const { channel, errors, mainCanvases, source } = setup({ canvas: false })

    const first = await source.imageForTile(0, 0, 7, 1)
    const second = await source.imageForTile(1, 0, 7, 1)

    expect(errors).toEqual([])
    expect(first).toBe(mainCanvases[0])
    expect(second).toBe(mainCanvases[1])
    expect(channel.paintMessages()).toHaveLength(1)
  })

  it('paints on the main thread when the worker has no factory by that name, once per style', async () => {
    const { channel, errors, mainCanvases, source } = setup()
    source.setStyle(
      portableVectorTileStyle('missing', { colors: ['#e'], widthPerOrder: 1 }, riverStyle),
    )

    await source.imageForTile(0, 0, 7, 1)
    await source.imageForTile(1, 0, 7, 1)

    expect(errors).toEqual([])
    expect(mainCanvases).toHaveLength(2)
    expect(channel.paintMessages()).toHaveLength(1)
  })

  it('sends a tile the worker evicted with the retry, and paints it there', async () => {
    const channel = createChannel()
    const worker = workerCanvases()
    // A budget of zero bytes keeps nothing: every tile is a miss.
    serveVectorTileWorker(channel.workerScope, {
      cacheBytes: 0,
      createCanvas: worker.createCanvas,
      decode: createMvtDecoder({ properties: ['si', 'so'] }),
      styles,
    })
    const service = createWorkerTileService<FakeBitmap>({
      enabled: true,
      toImage: (bitmap) => bitmap as unknown as FakeBitmap,
      worker: channel.workerPort,
    })
    const mainCanvases: FakeCanvas[] = []
    const source = createVectorTileOverlaySource<FakeCanvas, FakeBitmap>({
      createCanvas: (width, height) => {
        const canvas = createFakeCanvas(width, height)
        mainCanvases.push(canvas)
        return canvas
      },
      decode: service.decode,
      painter: service.painter,
      style: portableVectorTileStyle('river', { colors: ['#a'], widthPerOrder: 1 }, riverStyle),
      tileBytes: async () => twoReaches,
    })

    const image = await source.imageForTile(0, 0, 7, 1)

    const paints = channel.paintMessages()
    expect(paints).toHaveLength(2)
    expect(paints[0]?.tile).toBeUndefined()
    expect(paints[1]?.tile).toBeDefined()
    expect(mainCanvases).toHaveLength(0)
    expect((image as unknown as FakeBitmap).calls.length).toBeGreaterThan(0)
  })

  it('paints on the main thread when the worker never answers', async () => {
    const timers: Array<() => void> = []
    const silent = {
      addEventListener: () => {},
      postMessage: () => {},
    }
    const painter = createWorkerPainter<FakeBitmap>({
      enabled: true,
      scheduleTimeout: (run) => {
        timers.push(run)
        return () => {}
      },
      worker: silent,
    })
    const mainCanvases: FakeCanvas[] = []
    const tile = buildDecodedVectorTile(4096, [
      {
        lines: [
          [
            { x: 0, y: 0 },
            { x: 9, y: 9 },
          ],
        ],
        properties: { so: 4 },
      },
    ])
    const source = createVectorTileOverlaySource<FakeCanvas, FakeBitmap>({
      createCanvas: (width, height) => {
        const canvas = createFakeCanvas(width, height)
        mainCanvases.push(canvas)
        return canvas
      },
      decode: async () => tile,
      painter,
      style: portableVectorTileStyle('river', { colors: ['#a'], widthPerOrder: 1 }, riverStyle),
      tileBytes: async () => new Uint8Array([1]),
    })

    const pending = source.imageForTile(0, 0, 3, 1)
    await vi.waitFor(() => expect(timers).toHaveLength(1))
    timers[0]?.()

    expect(await pending).toBe(mainCanvases[0])
  })

  it('paints in-flight tiles on the main thread after dispose', async () => {
    const silent = { addEventListener: () => {}, postMessage: () => {} }
    const painter = createWorkerPainter<FakeBitmap>({ enabled: true, worker: silent })
    const tile = buildDecodedVectorTile(4096, [
      {
        lines: [
          [
            { x: 0, y: 0 },
            { x: 9, y: 9 },
          ],
        ],
        properties: { so: 4 },
      },
    ])
    const mainCanvases: FakeCanvas[] = []
    const source = createVectorTileOverlaySource<FakeCanvas, FakeBitmap>({
      createCanvas: (width, height) => {
        const canvas = createFakeCanvas(width, height)
        mainCanvases.push(canvas)
        return canvas
      },
      decode: async () => tile,
      painter,
      style: portableVectorTileStyle('river', { colors: ['#a'], widthPerOrder: 1 }, riverStyle),
      tileBytes: async () => new Uint8Array([1]),
    })

    const pending = source.imageForTile(0, 0, 3, 1)
    await vi.waitFor(() => expect(painter.pending).toBe(1))
    painter.dispose()

    expect(await pending).toBe(mainCanvases[0])
    expect(
      painter.paint(tile, { pixelRatio: 1, style: () => null, tileSize: 256, zoom: 3 }),
    ).toBeNull()
  })

  it('declines everything when disabled, as on a browser without OffscreenCanvas', () => {
    const channel = createChannel()
    const painter = createWorkerPainter({ enabled: false, worker: channel.workerPort })
    const tile = buildDecodedVectorTile(4096, [])
    const style = portableVectorTileStyle('river', { colors: ['#a'], widthPerOrder: 1 }, riverStyle)

    expect(painter.paint(tile, { pixelRatio: 1, style, tileSize: 256, zoom: 3 })).toBeNull()
    expect(channel.sentToWorker).toEqual([])
  })
})

describe('the decoded copy the main thread keeps', () => {
  it('is on buffers of its own, so the worker can keep painting from the original', async () => {
    const { source } = setup()

    await source.imageForTile(0, 0, 7, 1)
    // Tile-local (1024, 1024) of z7/0/0 lies on the first reach's diagonal.
    const fraction = 1024 / 4096 / 2 ** 7
    const coordinate = {
      latitude: (Math.atan(Math.sinh(Math.PI * (1 - 2 * fraction))) * 180) / Math.PI,
      longitude: fraction * 360 - 180,
    }
    // The hit-test still answers, synchronously, from the main thread's copy.
    const hit = source.hitTest({ coordinate, tolerancePx: 4, zoom: 7 })

    expect(source.size).toBe(1)
    expect(hit?.properties).toMatchObject({ si: 3 })
  })

  it('copies every column when the worker keeps a tile', () => {
    const tile = buildDecodedVectorTile(4096, [
      {
        lines: [
          [
            { x: 1, y: 2 },
            { x: 3, y: 4 },
          ],
        ],
        properties: { ri: 7, si: 5, so: 3 },
      },
    ])
    const copy = copyVectorTile(tile)
    for (const column of ['coordinates', 'featureLines', 'lineStarts', 'ri', 'si', 'so'] as const) {
      expect(copy[column]?.buffer).not.toBe(tile[column]?.buffer)
      expect([...(copy[column] ?? [])]).toEqual([...(tile[column] ?? [])])
    }
  })
})

describe('the image MapKit is handed', () => {
  it('falls back to the main thread when the bitmap cannot be shown', async () => {
    const channel = createChannel()
    const worker = workerCanvases()
    serveVectorTileWorker(channel.workerScope, {
      createCanvas: worker.createCanvas,
      decode: createMvtDecoder({ properties: ['si', 'so'] }),
      styles,
    })
    const service = createWorkerTileService<FakeBitmap>({
      enabled: true,
      toImage: () => {
        throw new Error('no document')
      },
      worker: channel.workerPort,
    })
    const mainCanvases: FakeCanvas[] = []
    const source = createVectorTileOverlaySource<FakeCanvas, FakeBitmap>({
      createCanvas: (width, height) => {
        const canvas = createFakeCanvas(width, height)
        mainCanvases.push(canvas)
        return canvas
      },
      decode: service.decode,
      painter: service.painter,
      style: portableVectorTileStyle('river', { colors: ['#a'], widthPerOrder: 1 }, riverStyle),
      tileBytes: async () => twoReaches,
    })

    expect(await source.imageForTile(0, 0, 7, 1)).toBe(mainCanvases[0])
  })
})

describe('portable styles', () => {
  it('describe a factory style by name and params, and a class style as itself', () => {
    const params = { colors: ['#a'], widthPerOrder: 1 }
    const style = portableVectorTileStyle('river', params, riverStyle)
    expect(vectorTileStyleSpec(style)).toEqual({ kind: 'factory', name: 'river', params })
    expect(vectorTileStyleSpec(() => null)).toBeNull()
  })
})
