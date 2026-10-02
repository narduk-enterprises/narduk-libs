import { describe, expect, it, vi } from 'vitest'

import {
  VECTOR_TILE_MISSING_ID,
  buildDecodedVectorTile,
  createVectorTileOverlaySource,
} from '../../src/client/index.js'

import { createFakeCanvas } from './fake-canvas.js'

import type {
  DecodedVectorTile,
  VectorTileHighlight,
  VectorTileOverlaySourceOptions,
  VectorTileRestyleHost,
} from '../../src/client/index.js'
import type { FakeCanvas } from './fake-canvas.js'

const HIGHLIGHT: VectorTileHighlight = {
  id: 7,
  style: { casing: { color: '#ffffff', extraWidth: 2 }, color: '#f97316', width: 4 },
}

/** Stretch 7 crosses the tile at y=1024; stretch 8 at y=3072. */
function tileFor(x: number): DecodedVectorTile {
  return buildDecodedVectorTile(4096, [
    {
      lines: [
        [
          { x: 0, y: 1024 },
          { x: 4096, y: 1024 },
        ],
      ],
      properties: { piece: x },
      si: 7,
    },
    {
      lines: [
        [
          { x: 0, y: 3072 },
          { x: 4096, y: 3072 },
        ],
      ],
      properties: { piece: x },
      si: 8,
    },
  ])
}

function setup(extra: Partial<VectorTileOverlaySourceOptions<FakeCanvas>> = {}) {
  const tileBytes = vi.fn(async (_z: number, _x: number, _y: number) => new Uint8Array([1]))
  const decode = vi.fn(async (_bytes: Uint8Array, tile: { x: number }) => tileFor(tile.x))
  const style = vi.fn(() => ({ color: '#2563eb', width: 1 }))
  const created: FakeCanvas[] = []
  const overlay = createVectorTileOverlaySource<FakeCanvas>({
    createCanvas: (width, height) => {
      const canvas = createFakeCanvas(width, height)
      created.push(canvas)
      return canvas
    },
    decode,
    maxDataZoom: 12,
    style,
    tileBytes,
    ...extra,
  })
  return { created, decode, overlay, style, tileBytes }
}

function strokes(canvas: FakeCanvas | null) {
  return (canvas?.calls ?? []).filter((call) => call.op === 'stroke')
}

function segments(canvas: FakeCanvas | null) {
  return (canvas?.calls ?? [])
    .filter((call) => call.op === 'moveTo' || call.op === 'lineTo')
    .map((call) => [call.op, ...(call as { args: number[] }).args])
}

describe('selection highlight', () => {
  it('draws one si across two tiles in the highlight style, and only that si', async () => {
    const { overlay } = setup()
    await overlay.imageForTile(100, 200, 12, 1)
    await overlay.imageForTile(101, 200, 12, 1)

    await overlay.setHighlight(HIGHLIGHT)
    expect(overlay.highlight).toEqual(HIGHLIGHT)

    const west = await overlay.highlightImageForTile(100, 200, 12, 1)
    const east = await overlay.highlightImageForTile(101, 200, 12, 1)
    for (const canvas of [west, east]) {
      // Stretch 7 at y=1024 -> 64px; stretch 8 (y=3072 -> 192px) is not drawn.
      expect(segments(canvas)).toEqual([
        ['moveTo', 0, 64],
        ['lineTo', 256, 64],
      ])
      expect(strokes(canvas)).toEqual([
        { globalAlpha: 1, lineWidth: 6, op: 'stroke', strokeStyle: '#ffffff' },
        { globalAlpha: 1, lineWidth: 4, op: 'stroke', strokeStyle: '#f97316' },
      ])
    }

    await overlay.setHighlight({ id: 8, style: { color: '#000000', width: 2 } })
    const other = await overlay.highlightImageForTile(100, 200, 12, 1)
    expect(segments(other)).toEqual([
      ['moveTo', 0, 192],
      ['lineTo', 256, 192],
    ])
  })

  it('does not read, decode or repaint a base tile when the highlight changes', async () => {
    const replace = vi.fn(async () => {})
    const host: VectorTileRestyleHost<FakeCanvas> = { layerId: 'highlight', replace }
    const baseHost: VectorTileRestyleHost<FakeCanvas> = { layerId: 'network', replace: vi.fn() }
    const { created, decode, overlay, style, tileBytes } = setup({
      highlightHost: host,
      restyleHost: baseHost,
    })
    await overlay.imageForTile(100, 200, 12, 1)
    await overlay.imageForTile(101, 200, 12, 1)
    const base = {
      canvases: created.length,
      decodes: decode.mock.calls.length,
      paints: style.mock.calls.length,
      reads: tileBytes.mock.calls.length,
    }
    expect(base).toEqual({ canvases: 2, decodes: 2, paints: 4, reads: 2 })

    await overlay.setHighlight(HIGHLIGHT)
    await overlay.highlightImageForTile(100, 200, 12, 1)
    await overlay.highlightImageForTile(101, 200, 12, 1)
    await overlay.setHighlight({ id: 8, style: HIGHLIGHT.style })
    await overlay.highlightImageForTile(100, 200, 12, 1)
    await overlay.clearHighlight()

    // Only the highlight overlay was swapped, three times; the network was not.
    expect(replace).toHaveBeenCalledTimes(3)
    expect(replace).toHaveBeenCalledWith('highlight', expect.anything(), expect.anything())
    expect(baseHost.replace).not.toHaveBeenCalled()
    expect(tileBytes).toHaveBeenCalledTimes(base.reads)
    expect(decode).toHaveBeenCalledTimes(base.decodes)
    expect(style).toHaveBeenCalledTimes(base.paints)
    // Three highlight canvases (7 on two tiles, 8 on one); no base canvas repainted.
    expect(created.length).toBe(base.canvases + 3)
  })

  it('shows the highlight on a tile that arrives after it was set', async () => {
    const replace = vi.fn(async () => {})
    const { decode, overlay, tileBytes } = setup({
      highlightHost: { layerId: 'highlight', replace },
    })
    await overlay.setHighlight(HIGHLIGHT)
    replace.mockClear()

    // The highlight overlay asks first: the tile is neither cached nor loading,
    // so it is a miss, and nothing is fetched for the highlight's sake.
    expect(await overlay.highlightImageForTile(100, 200, 12, 1)).toBeNull()
    expect(tileBytes).not.toHaveBeenCalled()
    expect(decode).not.toHaveBeenCalled()

    // The base tile arrives; the highlight overlay is refreshed for it.
    await overlay.imageForTile(100, 200, 12, 1)
    await vi.waitFor(() => expect(replace).toHaveBeenCalledTimes(1))
    const late = await overlay.highlightImageForTile(100, 200, 12, 1)
    expect(segments(late)).toEqual([
      ['moveTo', 0, 64],
      ['lineTo', 256, 64],
    ])
    expect(tileBytes).toHaveBeenCalledTimes(1)

    // A tile already cached does not trigger a refresh of its own.
    await overlay.imageForTile(100, 200, 12, 1)
    expect(replace).toHaveBeenCalledTimes(1)
  })

  it('waits for a read the base layer already started rather than starting one', async () => {
    let release!: (bytes: Uint8Array) => void
    const slowBytes = vi.fn(
      () =>
        new Promise<Uint8Array>((resolve) => {
          release = resolve
        }),
    )
    const { overlay } = setup({ tileBytes: slowBytes })
    await overlay.setHighlight(HIGHLIGHT)
    const base = overlay.imageForTile(100, 200, 12, 1)
    const highlighted = overlay.highlightImageForTile(100, 200, 12, 1)
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    release(new Uint8Array([1]))
    await base
    expect(segments(await highlighted)).toHaveLength(2)
    expect(slowBytes).toHaveBeenCalledTimes(1)
  })

  it('does not fetch a tile that has left the cache; it appears when the tile is next drawn', async () => {
    const { overlay, tileBytes } = setup({ cacheSize: 1 })
    await overlay.setHighlight(HIGHLIGHT)
    await overlay.imageForTile(100, 200, 12, 1)
    await overlay.imageForTile(101, 200, 12, 1) // evicts 100
    expect(tileBytes).toHaveBeenCalledTimes(2)

    expect(await overlay.highlightImageForTile(100, 200, 12, 1)).toBeNull()
    expect(tileBytes).toHaveBeenCalledTimes(2)

    await overlay.imageForTile(100, 200, 12, 1) // drawn again: read again
    expect(tileBytes).toHaveBeenCalledTimes(3)
    expect(segments(await overlay.highlightImageForTile(100, 200, 12, 1))).toHaveLength(2)
  })

  it('highlights an overzoomed tile from its ancestor geometry', async () => {
    const { decode, overlay, tileBytes } = setup()
    // Zoom 14 children of 12/100/200; the ancestor is read once, for the base.
    await overlay.imageForTile(400, 800, 14, 1)
    await overlay.setHighlight(HIGHLIGHT)

    // Child (col 0, row 0) shows ancestor units 0..1024 over 256px; the stretch
    // runs along y=1024, the child's bottom edge -> 256px, cut a line-width past
    // the right edge (4px line + 2px casing -> 6px margin).
    const child = await overlay.highlightImageForTile(400, 800, 14, 1)
    expect(segments(child)).toEqual([
      ['moveTo', 0, 256],
      ['lineTo', 262, 256],
    ])
    // A child the stretch never reaches draws nothing.
    expect(await overlay.highlightImageForTile(400, 802, 14, 1)).toBeNull()
    expect(tileBytes).toHaveBeenCalledTimes(1)
    expect(decode).toHaveBeenCalledTimes(1)
  })

  it('never matches VECTOR_TILE_MISSING_ID, even on a feature that has no si', async () => {
    const tile = buildDecodedVectorTile(4096, [
      {
        lines: [
          [
            { x: 0, y: 1024 },
            { x: 4096, y: 1024 },
          ],
        ],
        properties: {},
        si: 7,
      },
      {
        lines: [
          [
            { x: 0, y: 2048 },
            { x: 4096, y: 2048 },
          ],
        ],
        properties: {},
      },
    ])
    expect(tile.si?.[1]).toBe(VECTOR_TILE_MISSING_ID)
    const { overlay } = setup({ decode: async () => tile })
    await overlay.imageForTile(100, 200, 12, 1)

    await overlay.setHighlight({ id: VECTOR_TILE_MISSING_ID, style: HIGHLIGHT.style })
    expect(await overlay.highlightImageForTile(100, 200, 12, 1)).toBeNull()
  })

  it('draws nothing for a tile with no si column, and rejects a bad id', async () => {
    const tile = buildDecodedVectorTile(4096, [
      {
        lines: [
          [
            { x: 0, y: 1024 },
            { x: 4096, y: 1024 },
          ],
        ],
        properties: {},
      },
    ])
    const { overlay } = setup({ decode: async () => tile })
    await overlay.imageForTile(100, 200, 12, 1)
    await overlay.setHighlight(HIGHLIGHT)
    expect(await overlay.highlightImageForTile(100, 200, 12, 1)).toBeNull()
    expect(() => overlay.setHighlight({ id: -1, style: HIGHLIGHT.style })).toThrow(RangeError)
    expect(() => overlay.setHighlight({ id: 1.5, style: HIGHLIGHT.style })).toThrow(RangeError)
  })

  it('clears the highlight everywhere', async () => {
    const replace = vi.fn(async () => {})
    const { overlay } = setup({ highlightHost: { layerId: 'highlight', replace } })
    await overlay.imageForTile(100, 200, 12, 1)
    await overlay.imageForTile(101, 200, 12, 1)
    await overlay.setHighlight(HIGHLIGHT)
    expect(await overlay.highlightImageForTile(100, 200, 12, 1)).not.toBeNull()

    await overlay.clearHighlight()
    expect(overlay.highlight).toBeNull()
    expect(await overlay.highlightImageForTile(100, 200, 12, 1)).toBeNull()
    expect(await overlay.highlightImageForTile(101, 200, 12, 1)).toBeNull()
    // The cleared overlay is swapped in without waiting for a first image.
    expect(replace).toHaveBeenLastCalledWith(
      'highlight',
      expect.anything(),
      expect.objectContaining({ activateWhen: 'immediate' }),
    )
  })

  it('coalesces a burst of highlight changes and leaves the latest in force', async () => {
    const replace = vi.fn(async () => {})
    const { overlay } = setup({ highlightHost: { layerId: 'highlight', replace } })
    await overlay.imageForTile(100, 200, 12, 1)
    await Promise.all([
      overlay.setHighlight({ id: 7, style: HIGHLIGHT.style }),
      overlay.setHighlight({ id: 8, style: HIGHLIGHT.style }),
      overlay.setHighlight({ id: 7, style: HIGHLIGHT.style }),
    ])
    expect(replace).toHaveBeenCalledTimes(1)
    expect(overlay.highlight?.id).toBe(7)
  })
})
