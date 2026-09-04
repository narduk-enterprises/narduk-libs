import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import {
  WEB_MERCATOR_MAX_LATITUDE,
  lonLatForTilePixel,
  lonLatForTilePixelCenter,
  projectTileUv,
  tileBounds,
  tileIntersectsBBox,
  tileProjection,
} from '../src/tile/mercator.js'
import type { GridBBox } from '../src/core/models.js'

/**
 * The tile geometry is a port of GeoGridKit's `GridTileMath`, and these are the
 * numbers Swift itself produced — see the header of
 * `tests/fixtures/generate_tile_math_parity.sh` for how they were obtained and
 * how to regenerate them. Asserting a port against its own arithmetic proves
 * nothing; asserting it against the other renderer's output is the only thing
 * that keeps two clients drawing the same coastline in the same place.
 */
interface PixelRow {
  z: number
  x: number
  y: number
  side: number
  pixelX: number
  pixelY: number
  longitude: number
  latitude: number
}

interface CenterRow {
  z: number
  x: number
  y: number
  side: number
  column: number
  row: number
  longitude: number
  latitude: number
}

interface BoundsRow {
  z: number
  x: number
  y: number
  side: number
  west: number
  south: number
  east: number
  north: number
}

interface ParityTable {
  generator: string
  source: string
  geoGridKitCommit: string
  pixels: PixelRow[]
  centers: CenterRow[]
  bounds: BoundsRow[]
}

const table = JSON.parse(
  readFileSync(new URL('./fixtures/tile-math-parity-v1.json', import.meta.url), 'utf8'),
) as ParityTable

/**
 * Degrees. `atan`/`sinh` are not bit-specified across libm implementations, so
 * a last-ulp disagreement between Foundation and V8 is expected and harmless;
 * anything larger is a formula that drifted. `1e-11°` is about a micrometre.
 */
const DEGREE_TOLERANCE = 1e-11

describe('GridTileMath parity with GeoGridKit', () => {
  it('pins the fixture to a real GeoGridKit checkout', () => {
    expect(table.source).toBe('GeoGridKit Sources/GeoGridRender/GridTileMath.swift')
    expect(table.geoGridKitCommit).toMatch(/^[0-9a-f]{40}$/)
    expect(table.pixels.length).toBeGreaterThan(20)
    expect(table.bounds.length).toBeGreaterThan(5)
  })

  it.each(table.pixels)(
    'lonLatForTilePixel z$z/$x/$y side $side at ($pixelX, $pixelY)',
    (row) => {
      const coordinate = lonLatForTilePixel(
        { z: row.z, x: row.x, y: row.y, side: row.side },
        row.pixelX,
        row.pixelY,
      )
      expect(coordinate).not.toBeNull()
      expect(Math.abs(coordinate!.longitude - row.longitude)).toBeLessThanOrEqual(DEGREE_TOLERANCE)
      expect(Math.abs(coordinate!.latitude - row.latitude)).toBeLessThanOrEqual(DEGREE_TOLERANCE)
    },
  )

  it.each(table.centers)(
    'lonLatForTilePixelCenter z$z/$x/$y side $side at ($column, $row)',
    (entry) => {
      const coordinate = lonLatForTilePixelCenter(
        { z: entry.z, x: entry.x, y: entry.y, side: entry.side },
        entry.column,
        entry.row,
      )
      expect(coordinate).not.toBeNull()
      expect(Math.abs(coordinate!.longitude - entry.longitude)).toBeLessThanOrEqual(
        DEGREE_TOLERANCE,
      )
      expect(Math.abs(coordinate!.latitude - entry.latitude)).toBeLessThanOrEqual(DEGREE_TOLERANCE)
    },
  )

  it.each(table.bounds)('tileBounds z$z/$x/$y side $side', (entry) => {
    const bounds = tileBounds({ z: entry.z, x: entry.x, y: entry.y, side: entry.side })
    expect(bounds).not.toBeNull()
    const [west, south, east, north] = bounds!
    expect(Math.abs(west - entry.west)).toBeLessThanOrEqual(DEGREE_TOLERANCE)
    expect(Math.abs(south - entry.south)).toBeLessThanOrEqual(DEGREE_TOLERANCE)
    expect(Math.abs(east - entry.east)).toBeLessThanOrEqual(DEGREE_TOLERANCE)
    expect(Math.abs(north - entry.north)).toBeLessThanOrEqual(DEGREE_TOLERANCE)
  })
})

describe('tile geometry edges', () => {
  it('spans the whole Mercator world at z0', () => {
    const bounds = tileBounds({ z: 0, x: 0, y: 0, side: 256 })!
    expect(bounds[0]).toBe(-180)
    expect(bounds[2]).toBe(180)
    expect(bounds[3]).toBeCloseTo(WEB_MERCATOR_MAX_LATITUDE, 12)
    expect(bounds[1]).toBeCloseTo(-WEB_MERCATOR_MAX_LATITUDE, 12)
  })

  it('rejects a degenerate tile or a non-finite probe', () => {
    expect(lonLatForTilePixel({ z: 3, x: 1, y: 1, side: 0 }, 0, 0)).toBeNull()
    expect(lonLatForTilePixel({ z: 3, x: 1, y: 1, side: Number.NaN }, 0, 0)).toBeNull()
    expect(lonLatForTilePixel({ z: 3, x: 1, y: 1, side: 256 }, Number.NaN, 0)).toBeNull()
    expect(lonLatForTilePixel({ z: 3, x: 1, y: 1, side: 256 }, 0, Number.POSITIVE_INFINITY)).toBeNull()
    expect(tileBounds({ z: 3, x: 1, y: 1, side: 0 })).toBeNull()
  })

  it('clamps an underflowing zoom to the whole-world tile, as Swift does', () => {
    expect(tileBounds({ z: -4, x: 0, y: 0, side: 256 })).toEqual(
      tileBounds({ z: 0, x: 0, y: 0, side: 256 }),
    )
  })

  it('knows which tiles can carry a basin-sized grid', () => {
    const gulf: GridBBox = [-92, 28, -88, 32]
    expect(tileIntersectsBBox({ z: 6, x: 16, y: 26, side: 256 }, gulf)).toBe(true)
    // Same zoom, the other side of the planet.
    expect(tileIntersectsBBox({ z: 6, x: 50, y: 26, side: 256 }, gulf)).toBe(false)
    expect(tileIntersectsBBox({ z: 0, x: 0, y: 0, side: 256 }, gulf)).toBe(true)
  })
})

describe('tileProjection', () => {
  const bbox: GridBBox = [-92, 28, -88, 32]

  it('refuses a degenerate or inverted bbox rather than inventing a mapping', () => {
    expect(tileProjection({ z: 6, x: 16, y: 26, side: 256 }, [-92, 28, -92, 32])).toBeNull()
    expect(tileProjection({ z: 6, x: 16, y: 26, side: 256 }, [-92, 32, -88, 28])).toBeNull()
    expect(
      tileProjection({ z: 6, x: 16, y: 26, side: 256 }, [Number.NaN, 28, -88, 32]),
    ).toBeNull()
    expect(tileProjection({ z: 6, x: 16, y: 26, side: 0 }, bbox)).toBeNull()
  })

  /**
   * The projection is a per-tile *reformulation* of `lonLatForTilePixel` —
   * differenced ahead of time so a `highp float` shader can evaluate it without
   * catastrophic cancellation. Reformulations are where ports quietly go wrong,
   * so it is checked against the fixture-pinned function it claims to equal.
   */
  it.each([
    { z: 0, x: 0, y: 0, side: 256 },
    { z: 6, x: 16, y: 26, side: 256 },
    { z: 12, x: 1024, y: 1690, side: 512 },
    { z: 14, x: 3834, y: 6957, side: 256 },
  ])('reproduces lonLatForTilePixel for z$z/$x/$y', (tile) => {
    const projection = tileProjection(tile, bbox)!
    const [west, south, east, north] = bbox
    for (const screenU of [0, 0.125, 0.5, 0.75, 1]) {
      for (const screenV of [0, 0.3, 0.5, 1]) {
        const coordinate = lonLatForTilePixel(tile, screenU * tile.side, screenV * tile.side)!
        const expected = {
          u: (coordinate.longitude - west) / (east - west),
          v: (north - coordinate.latitude) / (north - south),
        }
        const actual = projectTileUv(projection, screenU, screenV)
        expect(Math.abs(actual.u - expected.u)).toBeLessThanOrEqual(1e-12)
        expect(Math.abs(actual.v - expected.v)).toBeLessThanOrEqual(1e-12)
      }
    }
  })
})
