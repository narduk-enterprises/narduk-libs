import { describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_VECTOR_TILE_CACHE_BYTES,
  buildDecodedVectorTile,
  createVectorTileOverlaySource,
  decodedVectorTileBytes,
} from '../../src/client/index.js'

import { createFakeCanvas } from './fake-canvas.js'

import type { DecodedVectorTile } from '../../src/client/index.js'
import type { FakeCanvas } from './fake-canvas.js'

/** A tile of one line with `points` points; its size is exact, with no properties. */
function tileOfPoints(points: number): DecodedVectorTile {
  return buildDecodedVectorTile(4096, [
    {
      lines: [Array.from({ length: points }, (_, index) => ({ x: index, y: index }))],
      properties: {},
    },
  ])
}

function source(
  options: { cacheBytes?: number; cacheSize?: number },
  pointsFor: (x: number) => number,
) {
  const reads: number[] = []
  const overlay = createVectorTileOverlaySource<FakeCanvas>({
    createCanvas: createFakeCanvas,
    decode: async (_bytes, { x }) => tileOfPoints(pointsFor(x)),
    style: () => ({ color: '#2563eb', width: 1 }),
    tileBytes: async (_z, x) => {
      reads.push(x)
      return new Uint8Array([1])
    },
    ...options,
  })
  return { overlay, reads }
}

const unit = decodedVectorTileBytes(tileOfPoints(100))

describe('decoded tile cache byte budget', () => {
  it('evicts least-recently-used tiles to stay under the byte budget', async () => {
    const { overlay, reads } = source({ cacheBytes: unit * 2 + unit / 2 }, () => 100)

    await overlay.imageForTile(0, 0, 5, 1)
    await overlay.imageForTile(1, 0, 5, 1)
    expect(overlay.size).toBe(2)
    expect(overlay.cacheBytes).toBe(unit * 2)

    // Touch tile 0, so tile 1 is now the least recently used.
    await overlay.imageForTile(0, 0, 5, 1)
    await overlay.imageForTile(2, 0, 5, 1)

    expect(overlay.size).toBe(2)
    expect(overlay.cacheBytes).toBe(unit * 2)
    expect(reads).toEqual([0, 1, 2])

    // 0 and 2 survived (no new read); 1 was evicted (read again).
    await overlay.imageForTile(0, 0, 5, 1)
    await overlay.imageForTile(2, 0, 5, 1)
    expect(reads).toEqual([0, 1, 2])
    await overlay.imageForTile(1, 0, 5, 1)
    expect(reads).toEqual([0, 1, 2, 1])
  })

  it('counts bytes, not tiles: one big tile pushes out several small ones', async () => {
    const { overlay } = source({ cacheBytes: unit * 4 }, (x) => (x === 9 ? 300 : 100))
    for (const x of [0, 1, 2]) await overlay.imageForTile(x, 0, 5, 1)
    expect(overlay.size).toBe(3)

    await overlay.imageForTile(9, 0, 5, 1)
    expect(overlay.cacheBytes).toBeLessThanOrEqual(unit * 4)
    expect(overlay.size).toBeLessThan(4)
  })

  it('still honours cacheSize as a count cap, and both hold when both are set', async () => {
    const countOnly = source({ cacheSize: 2 }, () => 100)
    for (const x of [0, 1, 2]) await countOnly.overlay.imageForTile(x, 0, 5, 1)
    expect(countOnly.overlay.size).toBe(2)

    // Plenty of bytes, few tiles allowed: the count cap bites.
    const both = source({ cacheBytes: unit * 100, cacheSize: 2 }, () => 100)
    for (const x of [0, 1, 2]) await both.overlay.imageForTile(x, 0, 5, 1)
    expect(both.overlay.size).toBe(2)

    // Plenty of tiles allowed, few bytes: the byte cap bites.
    const bytesBite = source({ cacheBytes: unit * 1.5, cacheSize: 100 }, () => 100)
    for (const x of [0, 1, 2]) await bytesBite.overlay.imageForTile(x, 0, 5, 1)
    expect(bytesBite.overlay.size).toBe(1)
  })

  it('paints a tile larger than the whole budget without retaining it', async () => {
    const { overlay, reads } = source({ cacheBytes: unit }, (x) => (x === 7 ? 1000 : 100))

    await overlay.imageForTile(0, 0, 5, 1)
    expect(overlay.size).toBe(1)

    const canvas = await overlay.imageForTile(7, 0, 5, 1)
    expect(canvas).not.toBeNull()
    expect(canvas?.calls.some((call) => call.op === 'stroke')).toBe(true)
    // Not retained, and it did not evict the small tile to make room.
    expect(overlay.size).toBe(1)
    expect(overlay.cacheBytes).toBe(unit)

    // Asking again reads again, and still paints.
    expect(await overlay.imageForTile(7, 0, 5, 1)).not.toBeNull()
    expect(reads.filter((x) => x === 7)).toHaveLength(2)
  })

  it('has a default budget, and Infinity removes the byte cap', async () => {
    expect(DEFAULT_VECTOR_TILE_CACHE_BYTES).toBeGreaterThan(0)
    const decode = vi.fn(async () => tileOfPoints(1000))
    const overlay = createVectorTileOverlaySource<FakeCanvas>({
      cacheBytes: Number.POSITIVE_INFINITY,
      cacheSize: 1000,
      createCanvas: createFakeCanvas,
      decode,
      style: () => ({ color: '#2563eb', width: 1 }),
      tileBytes: async () => new Uint8Array([1]),
    })
    for (let x = 0; x < 20; x += 1) await overlay.imageForTile(x, 0, 6, 1)
    expect(overlay.size).toBe(20)
  })
})
