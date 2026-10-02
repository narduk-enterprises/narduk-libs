import { describe, expect, it, vi } from 'vitest'

import {
  buildDecodedVectorTile,
  createVectorTileOverlaySource,
  paintVectorTile,
} from '../../src/client/index.js'

import { createFakeCanvas } from './fake-canvas.js'

import type {
  DecodedVectorTile,
  VectorTileClassStyle,
  VectorTileOverlaySourceOptions,
  VectorTileStyle,
} from '../../src/client/index.js'
import type { FakeCanvas } from './fake-canvas.js'

/** Zoom-12 tile 100/200: one river across its middle, one running corner to corner. */
function ancestorTile(): DecodedVectorTile {
  return buildDecodedVectorTile(4096, [
    {
      lines: [
        [
          { x: 512, y: 512 },
          { x: 1536, y: 512 },
        ],
      ],
      properties: {},
      ri: 1,
      si: 0,
      so: 1,
    },
    {
      lines: [
        [
          { x: 0, y: 2048 },
          { x: 4096, y: 2048 },
        ],
      ],
      properties: {},
      ri: 0,
      si: 1,
      so: 3,
    },
  ])
}

function setup(
  extra: Partial<VectorTileOverlaySourceOptions<FakeCanvas>> = {},
  tile: DecodedVectorTile = ancestorTile(),
) {
  const tileBytes = vi.fn(async (_z: number, _x: number, _y: number) => new Uint8Array([1]))
  const decode = vi.fn(async () => tile)
  const overlay = createVectorTileOverlaySource<FakeCanvas>({
    createCanvas: createFakeCanvas,
    decode,
    maxDataZoom: 12,
    style: (_properties, _zoom) => ({ color: '#2563eb', width: 1 }),
    tileBytes,
    ...extra,
  })
  return { decode, overlay, tileBytes }
}

function points(canvas: FakeCanvas | null) {
  return (canvas?.calls ?? [])
    .filter((call) => call.op === 'moveTo' || call.op === 'lineTo')
    .map((call) => [call.op, ...(call as { args: number[] }).args] as const)
}

describe('overzoom', () => {
  it('paints zoom-14 tiles from one read and one decode of the zoom-12 ancestor', async () => {
    const { decode, overlay, tileBytes } = setup()

    // Four children of 12/100/200, at zoom 14.
    const children = await Promise.all([
      overlay.imageForTile(400, 800, 14, 1),
      overlay.imageForTile(401, 800, 14, 1),
      overlay.imageForTile(400, 801, 14, 1),
      overlay.imageForTile(403, 803, 14, 1),
    ])

    expect(tileBytes).toHaveBeenCalledTimes(1)
    expect(tileBytes.mock.calls[0]?.slice(0, 3)).toEqual([12, 100, 200])
    expect(decode).toHaveBeenCalledTimes(1)
    expect(decode).toHaveBeenCalledWith(expect.anything(), { x: 100, y: 200, z: 12 })
    expect(overlay.size).toBe(1)
    expect(children[0]).not.toBeNull()

    // A later child comes from the cache, not the archive.
    await overlay.imageForTile(402, 802, 14, 1)
    expect(tileBytes).toHaveBeenCalledTimes(1)
    expect(decode).toHaveBeenCalledTimes(1)
  })

  it('scales the ancestor into the child and clips a line that crosses its edge', async () => {
    const { overlay } = setup()

    // Child (col 0, row 0) shows ancestor units 0..1024; 256px for 1024 units.
    // The river runs 512 -> 1536 at y 512: it starts inside, leaves the right edge.
    const west = await overlay.imageForTile(400, 800, 14, 1)
    const westPoints = points(west)
    expect(westPoints[0]).toEqual(['moveTo', 128, 128])
    // Cut one line-width past the 256px edge (1px), not run on to 384.
    expect(westPoints[1]).toEqual(['lineTo', 257, 128])

    // Child (col 1, row 0) shows 1024..2048: the same river enters at its left
    // edge (a pixel early, for the stroke) and ends at 1536 -> 128px.
    const east = await overlay.imageForTile(401, 800, 14, 1)
    expect(points(east)).toEqual([
      ['moveTo', -1, 128],
      ['lineTo', 128, 128],
    ])

    // A child the river never reaches draws nothing, not a blank square.
    expect(await overlay.imageForTile(403, 800, 14, 1)).toBeNull()

    // The long river along y=2048 is the top edge of row 2, and starts at the ancestor's own edge (px 0) and is cut a pixel past the child's right edge.
    const row2 = await overlay.imageForTile(400, 802, 14, 1)
    expect(points(row2)).toEqual([
      ['moveTo', 0, 0],
      ['lineTo', 257, 0],
    ])
  })

  it('scales with the device pixel ratio', async () => {
    const { overlay } = setup()
    const retina = await overlay.imageForTile(400, 800, 14, 2)
    expect(retina?.width).toBe(512)
    expect(points(retina)[0]).toEqual(['moveTo', 256, 256])
  })

  it('keeps line width, casing and draw order as at the data zoom', async () => {
    const paints: Record<string, VectorTileStyle> = {
      thin: { casing: { color: '#000000', extraWidth: 2 }, color: '#111111', width: 1.5 },
    }
    const { overlay } = setup({
      style: (_properties, _zoom) => paints.thin as VectorTileStyle,
    })
    const canvas = await overlay.imageForTile(401, 802, 14, 1)
    const strokes = canvas?.calls.filter((call) => call.op === 'stroke') ?? []
    // casing under, then the line, at the same widths a data-zoom tile uses.
    expect(strokes.map((call) => (call.op === 'stroke' ? call.lineWidth : 0))).toEqual([3.5, 1.5])

    // Draw order: stream order ascending (so 1 before so 3), widths from the paint.
    const ordered = setup({
      style: {
        classTable: { classes: new Uint8Array([5, 9]), length: 2, networkVersion: 1 },
        gaugeNotReporting: paints.thin as VectorTileStyle,
        noGauge: paints.thin as VectorTileStyle,
        paintByClass: Object.assign(new Array<VectorTileStyle | undefined>(10), {
          5: { color: '#aa0000', width: 2 },
          9: { color: '#00bb00', width: 4 },
        }),
        tileNetwork: { length: 2, version: 1 },
        unknown: paints.thin as VectorTileStyle,
      },
    })
    // Zoom 13, column 0 row 0 of the ancestor holds both rivers.
    const both = await ordered.overlay.imageForTile(200, 400, 13, 1)
    const drawn = (both?.calls ?? []).flatMap((call) => (call.op === 'stroke' ? [call] : []))
    expect(drawn.map((call) => call.strokeStyle)).toEqual(['#00bb00', '#aa0000'])
    expect(drawn.map((call) => call.lineWidth)).toEqual([4, 2])
  })

  it('picks the class column by display zoom, reading the columns from the ancestor', async () => {
    // Feature A: si 0, ri 1. Feature B: si 1, ri 0. Classes by id: 0 -> 5, 1 -> 9.
    const classTable = { classes: new Uint8Array([5, 9]), length: 2, networkVersion: 1 }
    const style = (threshold: number): VectorTileClassStyle => ({
      classTable,
      gaugeNotReporting: { color: '#ff00ff', width: 1 },
      noGauge: { color: '#00ffff', width: 1 },
      paintByClass: Object.assign(new Array<VectorTileStyle | undefined>(10), {
        5: { color: '#aa0000', width: 1 },
        9: { color: '#00bb00', width: 1 },
      }),
      tileNetwork: { length: 2, version: 1 },
      unknown: { color: '#777777', width: 1 },
      zoomThreshold: threshold,
    })

    // Threshold 13: display zoom 14 is "from" -> ri. The data zoom (12) would pick si.
    const fromRi = setup({ style: style(13) })
    const viaRi = await fromRi.overlay.imageForTile(400, 800, 14, 1)
    // Only feature A (ri 1 -> class 9) reaches child (0,0): green, not the red si gives.
    expect(
      viaRi?.calls
        .filter((call) => call.op === 'stroke')
        .map((call) => (call.op === 'stroke' ? call.strokeStyle : '')),
    ).toEqual(['#00bb00'])

    // Threshold 15: display zoom 14 is "below" -> si. Feature A: si 0 -> class 5.
    const belowSi = setup({ style: style(15) })
    const viaSi = await belowSi.overlay.imageForTile(400, 800, 14, 1)
    expect(
      viaSi?.calls
        .filter((call) => call.op === 'stroke')
        .map((call) => (call.op === 'stroke' ? call.strokeStyle : '')),
    ).toEqual(['#aa0000'])
  })

  it('hands the style function the display zoom, not the data zoom', async () => {
    const zooms: number[] = []
    const { overlay } = setup({
      style: (_properties, zoom) => {
        zooms.push(zoom)
        return { color: '#2563eb', width: 1 }
      },
    })
    await overlay.imageForTile(400, 800, 14, 1)
    expect(new Set(zooms)).toEqual(new Set([14]))
  })

  it('answers a line tap at zoom 14 from the ancestor tile', async () => {
    const { overlay } = setup()
    await overlay.imageForTile(400, 802, 14, 1)

    // The long river runs across the ancestor at y = 2048 of 4096: tile row 200.5.
    const unproject = (tileX: number, tileY: number, zoom: number) => {
      const n = 2 ** zoom
      return {
        latitude: (Math.atan(Math.sinh(Math.PI * (1 - (2 * tileY) / n))) * 180) / Math.PI,
        longitude: (tileX / n) * 360 - 180,
      }
    }
    const onLine = unproject(100.3, 200.5, 12)
    const hit = overlay.hitTest({ coordinate: onLine, zoom: 14 })
    expect(hit).not.toBeNull()
    expect(hit?.distancePx).toBeCloseTo(0, 1)
    expect(hit?.tile).toEqual({ x: 100, y: 200, z: 12 })
    expect(hit?.properties).toEqual({})

    // 3 screen px away at zoom 14 (a zoom-14 tile is a quarter of the ancestor).
    const threePx = unproject(100.3, 200.5 + 3 / 256 / 4, 12)
    const near = overlay.hitTest({ coordinate: threePx, zoom: 14 })
    expect(near?.distancePx).toBeCloseTo(3, 1)

    // 20 px is past the 8px fingertip at zoom 14, though only 1.2 px at zoom 12.
    const far = unproject(100.3, 200.5 + 20 / 256 / 4, 12)
    expect(overlay.hitTest({ coordinate: far, zoom: 14 })).toBeNull()
    expect(overlay.hitTest({ coordinate: far, zoom: 12 })?.distancePx).toBeCloseTo(20 / 4, 1)

    // Cache-only: a zoom-14 probe over an ancestor that never loaded is a miss.
    expect(overlay.hitTest({ coordinate: unproject(300.3, 200.5, 12), zoom: 14 })).toBeNull()
  })

  it('reads the default max data zoom from the archive, and an explicit one wins', async () => {
    const viaArchive = setup({
      archive: { getMaxZoom: async () => 12 },
    })
    // No explicit option on this one.
    const archived = createVectorTileOverlaySource<FakeCanvas>({
      archive: { getMaxZoom: async () => 12 },
      createCanvas: createFakeCanvas,
      decode: viaArchive.decode,
      style: () => ({ color: '#2563eb', width: 1 }),
      tileBytes: viaArchive.tileBytes,
    })
    await archived.imageForTile(401, 800, 14, 1)
    expect(viaArchive.tileBytes).toHaveBeenCalledWith(12, 100, 200, expect.any(AbortSignal))

    const noneBytes = vi.fn(async (_z: number, _x: number, _y: number) => new Uint8Array([1]))
    const none = createVectorTileOverlaySource<FakeCanvas>({
      createCanvas: createFakeCanvas,
      decode: async () => ancestorTile(),
      style: () => ({ color: '#2563eb', width: 1 }),
      tileBytes: noneBytes,
    })
    await none.imageForTile(401, 800, 14, 1)
    // No archive, no option: no overzoom, so the zoom-14 tile is read as asked.
    expect(noneBytes.mock.calls[0]?.slice(0, 3)).toEqual([14, 401, 800])

    const explicit = createVectorTileOverlaySource<FakeCanvas>({
      archive: { getMaxZoom: async () => 8 },
      createCanvas: createFakeCanvas,
      decode: async () => ancestorTile(),
      maxDataZoom: 12,
      style: () => ({ color: '#2563eb', width: 1 }),
      tileBytes: viaArchive.tileBytes,
    })
    viaArchive.tileBytes.mockClear()
    await explicit.imageForTile(401, 800, 14, 1)
    expect(viaArchive.tileBytes.mock.calls[0]?.slice(0, 3)).toEqual([12, 100, 200])
  })

  it('paints at or below the data zoom exactly as before', async () => {
    const { overlay, tileBytes } = setup()
    const canvas = await overlay.imageForTile(100, 200, 12, 1)
    expect(tileBytes.mock.calls[0]?.slice(0, 3)).toEqual([12, 100, 200])
    // No clipping: the whole line, at tile scale (4096 -> 256).
    expect(points(canvas)).toContainEqual(['lineTo', 256, 128])
  })

  it('does not drop the ancestor when the map moves between zooms above the data zoom', async () => {
    const reads: Array<{ finish: () => void; signal?: AbortSignal | undefined }> = []
    const overlay = createVectorTileOverlaySource<FakeCanvas>({
      createCanvas: createFakeCanvas,
      decode: async () => ancestorTile(),
      maxDataZoom: 12,
      style: () => ({ color: '#2563eb', width: 1 }),
      tileBytes: (_z, _x, _y, signal) =>
        new Promise((resolve) => {
          reads.push({ finish: () => resolve(new Uint8Array([1])), signal })
        }),
    })
    const at13 = overlay.imageForTile(200, 400, 13, 1)
    const at14 = overlay.imageForTile(400, 800, 14, 1)
    // Both want 12/100/200; one read, never aborted.
    expect(reads).toHaveLength(1)
    expect(reads[0]?.signal?.aborted).toBe(false)
    reads[0]?.finish()
    expect(await at13).not.toBeNull()
    expect(await at14).not.toBeNull()
  })

  it('paintVectorTile takes an overzoom directly', () => {
    const canvas = createFakeCanvas(256, 256)
    const painted = paintVectorTile(canvas, ancestorTile(), {
      overzoom: { column: 0, levels: 2, row: 0 },
      pixelRatio: 1,
      style: () => ({ color: '#2563eb', width: 1 }),
      tileSize: 256,
      zoom: 14,
    })
    expect(painted).toBe(true)
    expect(points(canvas)[0]).toEqual(['moveTo', 128, 128])
  })
})
