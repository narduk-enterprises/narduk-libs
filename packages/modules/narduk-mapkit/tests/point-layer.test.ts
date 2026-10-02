import {
  POINT_CLASS_NO_DATA,
  POINT_CLASS_NOT_REPORTING,
  POINT_LAYER_NATIONAL_TILE_BUDGET_MS,
  createPointLayer,
  paintPointLayerTile,
  pointLayerTilesForPoint,
  projectToTilePoint,
} from '../src/client/index.js'

import type {
  PointClassTable,
  PointLayerCanvas,
  PointLayerCanvasContext,
  PointPositions,
} from '../src/client/index.js'

const NATIONAL_POINT_COUNT = 23_597
const ST_PAUL = { latitude: 44.9442, longitude: -93.0936 }

type PaintCall =
  | { op: 'clearRect'; args: number[] }
  | { op: 'arc'; args: number[] }
  | { op: 'fill'; fillStyle: string }
  | { op: 'stroke'; lineWidth: number; strokeStyle: string }

interface FakeCanvas extends PointLayerCanvas {
  calls: PaintCall[]
}

function createFakeCanvas(width: number, height: number): FakeCanvas {
  const calls: PaintCall[] = []
  const context: PointLayerCanvasContext = {
    fillStyle: '',
    lineWidth: 0,
    strokeStyle: '',
    arc: (...args) => calls.push({ op: 'arc', args }),
    beginPath: () => {},
    clearRect: (...args) => calls.push({ op: 'clearRect', args }),
    fill: () => calls.push({ op: 'fill', fillStyle: String(context.fillStyle) }),
    stroke: () =>
      calls.push({
        op: 'stroke',
        lineWidth: context.lineWidth,
        strokeStyle: String(context.strokeStyle),
      }),
  }
  return { calls, height, width, getContext: () => context }
}

function reservedStyle(overrides: Partial<PointClassTable[typeof POINT_CLASS_NO_DATA]> = {}) {
  return {
    fill: '#94a3b8',
    order: 0,
    radius: 3,
    stroke: '#475569',
    ...overrides,
  }
}

function statusStyle(overrides: Partial<PointClassTable[typeof POINT_CLASS_NO_DATA]> = {}) {
  return {
    fill: '#2563eb',
    order: 2,
    radius: 3.5,
    stroke: '#1e3a8a',
    ...overrides,
  }
}

function styleTable(
  extras: { [classByte: number]: PointClassTable[typeof POINT_CLASS_NO_DATA] } = {},
): PointClassTable {
  return {
    [POINT_CLASS_NO_DATA]: reservedStyle(),
    [POINT_CLASS_NOT_REPORTING]: reservedStyle({
      fill: '#e2e8f0',
      order: 1,
      stroke: '#94a3b8',
    }),
    ...extras,
  }
}

function lonLat(longitude: number, latitude: number, type: 'f32' | 'f64' = 'f64'): PointPositions {
  return type === 'f32'
    ? new Float32Array([longitude, latitude])
    : new Float64Array([longitude, latitude])
}

function layerAt(
  positions: PointPositions,
  classes: Uint8Array,
  extras: { [classByte: number]: PointClassTable[typeof POINT_CLASS_NO_DATA] } = {},
  flags?: Uint8Array,
) {
  return createPointLayer({
    classes,
    createCanvas: createFakeCanvas,
    ...(flags ? { flags } : {}),
    positions,
    style: styleTable(extras),
  })
}

function worldOf(longitude: number, latitude: number) {
  const point = projectToTilePoint({ latitude, longitude }, 0, 1)
  const x = (point.x + point.tileX) % 1
  return { x: x < 0 ? x + 1 : x, y: point.y + point.tileY }
}

function shiftLongitude(longitude: number, latitude: number, pixels: number, zoom: number) {
  const world = worldOf(longitude, latitude)
  const dWorld = pixels / (256 * 2 ** zoom)
  return (world.x + dWorld) * 360 - 180
}

function coordinateAtTileFraction(
  tileX: number,
  tileY: number,
  zoom: number,
  fractionX: number,
  fractionY: number,
) {
  const n = 2 ** zoom
  const worldX = (tileX + fractionX) / n
  const worldY = (tileY + fractionY) / n
  const nMerc = Math.PI - 2 * Math.PI * worldY
  return {
    latitude: (180 / Math.PI) * Math.atan(Math.sinh(nMerc)),
    longitude: worldX * 360 - 180,
  }
}

describe('point-layer input validation', () => {
  it('rejects an array of objects or a plain number list', () => {
    const classes = new Uint8Array([1])
    const style = styleTable({ 1: statusStyle() })

    expect(() =>
      createPointLayer({
        classes,
        createCanvas: createFakeCanvas,
        positions: [{ latitude: 44.9, longitude: -93.1 }] as unknown as PointPositions,
        style,
      }),
    ).toThrow(/Float32Array or Float64Array/)

    expect(() =>
      createPointLayer({
        classes,
        createCanvas: createFakeCanvas,
        positions: [-93.1, 44.9] as unknown as PointPositions,
        style,
      }),
    ).toThrow(/Float32Array or Float64Array/)
  })

  it('rejects an odd-length position buffer and a class column of the wrong length', () => {
    expect(() =>
      createPointLayer({
        classes: new Uint8Array([1]),
        createCanvas: createFakeCanvas,
        positions: new Float64Array([-93.1]),
        style: styleTable({ 1: statusStyle() }),
      }),
    ).toThrow(/even/)

    expect(() =>
      createPointLayer({
        classes: new Uint8Array([1, 2]),
        createCanvas: createFakeCanvas,
        positions: lonLat(-93.1, 44.9),
        style: styleTable({ 1: statusStyle() }),
      }),
    ).toThrow(/classes length \(2\) must equal the point count \(1\)/)
  })

  it('rejects a flags column that is not a Uint8Array of the point count', () => {
    expect(() =>
      createPointLayer({
        classes: new Uint8Array([1]),
        createCanvas: createFakeCanvas,
        flags: [0] as unknown as Uint8Array,
        positions: lonLat(-93.1, 44.9),
        style: styleTable({ 1: statusStyle() }),
      }),
    ).toThrow(/flags must be a Uint8Array/)

    expect(() =>
      createPointLayer({
        classes: new Uint8Array([1]),
        createCanvas: createFakeCanvas,
        flags: new Uint8Array([0, 1]),
        positions: lonLat(-93.1, 44.9),
        style: styleTable({ 1: statusStyle() }),
      }),
    ).toThrow(/flags length \(2\) must equal the point count \(1\)/)
  })

  it('accepts Float32Array and Float64Array positions', async () => {
    const extras = { 1: statusStyle() }
    const from64 = layerAt(
      lonLat(ST_PAUL.longitude, ST_PAUL.latitude, 'f64'),
      new Uint8Array([1]),
      extras,
    )
    const from32 = layerAt(
      lonLat(ST_PAUL.longitude, ST_PAUL.latitude, 'f32'),
      new Uint8Array([1]),
      extras,
    )
    const zoom = 7
    const tile = projectToTilePoint(ST_PAUL, zoom, 1)

    expect(await from64.imageForTile(tile.tileX, tile.tileY, zoom, 1)).not.toBeNull()
    expect(await from32.imageForTile(tile.tileX, tile.tileY, zoom, 1)).not.toBeNull()
  })

  it('rejects a non-finite coordinate rather than storing it as class 0', () => {
    expect(() =>
      layerAt(new Float64Array([Number.NaN, 44.9]), new Uint8Array([POINT_CLASS_NO_DATA])),
    ).toThrow(/finite longitude\/latitude/)
  })

  it('rejects a missing reserved class instead of defaulting it to zero', () => {
    expect(() =>
      createPointLayer({
        classes: new Uint8Array([0]),
        createCanvas: createFakeCanvas,
        positions: lonLat(-93.1, 44.9),
        style: {
          [POINT_CLASS_NOT_REPORTING]: reservedStyle({ fill: '#e2e8f0', stroke: '#94a3b8' }),
          0: statusStyle({ fill: '#16a34a' }),
        } as unknown as PointClassTable,
      }),
    ).toThrow(/reserved class 255 \(no data\); nothing defaults to zero/)
  })
})

describe('point-layer reserved classes', () => {
  it('keeps no-data, not-reporting and the lowest real class visually distinct', () => {
    const alike = reservedStyle()
    expect(() =>
      createPointLayer({
        classes: new Uint8Array([POINT_CLASS_NO_DATA]),
        createCanvas: createFakeCanvas,
        positions: lonLat(-93.1, 44.9),
        style: {
          [POINT_CLASS_NO_DATA]: alike,
          [POINT_CLASS_NOT_REPORTING]: alike,
        },
      }),
    ).toThrow(/no-data and not-reporting styles must be visually distinct/)

    expect(() =>
      createPointLayer({
        classes: new Uint8Array([0]),
        createCanvas: createFakeCanvas,
        positions: lonLat(-93.1, 44.9),
        style: {
          [POINT_CLASS_NO_DATA]: reservedStyle({ fill: '#111111', stroke: '#000000' }),
          [POINT_CLASS_NOT_REPORTING]: reservedStyle({ fill: '#eeeeee', stroke: '#cccccc' }),
          0: statusStyle({ fill: '#111111', order: 2, stroke: '#000000' }),
        },
      }),
    ).toThrow(/distinct from the lowest real class/)
  })

  it('paints the three non-data states as three different fills, never as class 0', async () => {
    const positions = new Float64Array([
      ST_PAUL.longitude,
      ST_PAUL.latitude,
      ST_PAUL.longitude + 0.2,
      ST_PAUL.latitude,
      ST_PAUL.longitude + 0.4,
      ST_PAUL.latitude,
      ST_PAUL.longitude + 0.6,
      ST_PAUL.latitude,
    ])
    const classes = new Uint8Array([POINT_CLASS_NO_DATA, POINT_CLASS_NOT_REPORTING, 0, 7])
    const layer = layerAt(positions, classes, {
      0: statusStyle({ fill: '#16a34a', order: 2, stroke: '#14532d' }),
      7: statusStyle({ fill: '#dc2626', order: 8, stroke: '#7f1d1d' }),
    })
    const zoom = 4
    const tile = projectToTilePoint(ST_PAUL, zoom, 1)
    const canvas = await layer.imageForTile(tile.tileX, tile.tileY, zoom, 1)
    const fills = canvas?.calls.filter((call) => call.op === 'fill').map((call) => call.fillStyle)

    expect(fills).toEqual(['#94a3b8', '#e2e8f0', '#16a34a', '#dc2626'])
    expect(new Set(fills).size).toBe(4)
  })

  it('does not paint an unmapped class as class 0', async () => {
    const unmapped = { latitude: 10, longitude: 20 }
    const positions = new Float64Array([
      ST_PAUL.longitude,
      ST_PAUL.latitude,
      unmapped.longitude,
      unmapped.latitude,
    ])
    const layer = layerAt(positions, new Uint8Array([0, 9]), {
      0: statusStyle({ fill: '#16a34a', stroke: '#14532d' }),
    })
    const zoom = 4
    const tile = projectToTilePoint(ST_PAUL, zoom, 1)
    const canvas = await layer.imageForTile(tile.tileX, tile.tileY, zoom, 1)
    const fills = canvas?.calls.filter((call) => call.op === 'fill').map((call) => call.fillStyle)

    expect(fills).toEqual(['#16a34a'])
    expect(layer.nearestPoint(unmapped, 32, zoom)).toBeNull()
  })
})

describe('point-layer tile assignment', () => {
  it('assigns a point in the middle of a tile to that tile only', () => {
    const zoom = 6
    const tile = projectToTilePoint(ST_PAUL, zoom, 1)
    const centre = coordinateAtTileFraction(tile.tileX, tile.tileY, zoom, 0.5, 0.5)
    const tiles = pointLayerTilesForPoint(centre, zoom, 3)

    expect(tiles).toEqual([{ x: tile.tileX, y: tile.tileY }])
  })

  it('draws a point that straddles a tile edge in both tiles', async () => {
    const zoom = 6
    const tile = projectToTilePoint(ST_PAUL, zoom, 1)
    const radius = 4
    const justInside = coordinateAtTileFraction(tile.tileX, tile.tileY, zoom, 1 - 1.5 / 256, 0.5)
    const tiles = pointLayerTilesForPoint(justInside, zoom, radius)
    const east = { x: (tile.tileX + 1) % 2 ** zoom, y: tile.tileY }

    expect(tiles).toEqual(expect.arrayContaining([{ x: tile.tileX, y: tile.tileY }, east]))
    expect(tiles).toHaveLength(2)

    const layer = layerAt(lonLat(justInside.longitude, justInside.latitude), new Uint8Array([1]), {
      1: statusStyle({ radius }),
    })
    const home = await layer.imageForTile(tile.tileX, tile.tileY, zoom, 1)
    const neighbour = await layer.imageForTile(east.x, east.y, zoom, 1)

    expect(home?.calls.some((call) => call.op === 'arc')).toBe(true)
    expect(neighbour?.calls.some((call) => call.op === 'arc')).toBe(true)
  })

  it('wraps a straddle across the antimeridian', () => {
    const zoom = 3
    const n = 2 ** zoom
    const tiles = pointLayerTilesForPoint({ latitude: 10, longitude: 179.99 }, zoom, 8)

    expect(tiles.some((tile) => tile.x === n - 1)).toBe(true)
    expect(tiles.some((tile) => tile.x === 0)).toBe(true)
  })
})

describe('point-layer restyle without re-projection', () => {
  it('paints the new class column after the caller mutates the original positions', async () => {
    const positions = lonLat(ST_PAUL.longitude, ST_PAUL.latitude)
    const layer = layerAt(positions, new Uint8Array([1]), {
      1: statusStyle({ fill: '#2563eb' }),
      2: statusStyle({ fill: '#dc2626', order: 8 }),
    })
    const zoom = 7
    const tile = projectToTilePoint(ST_PAUL, zoom, 1)

    positions[0] = 0
    positions[1] = 0
    layer.setClasses(new Uint8Array([2]))

    const canvas = await layer.imageForTile(tile.tileX, tile.tileY, zoom, 1)
    const origin = await layer.imageForTile(4, 4, zoom, 1)

    expect(canvas?.calls.find((call) => call.op === 'fill')).toMatchObject({ fillStyle: '#dc2626' })
    expect(origin).toBeNull()
    expect(layer.nearestPoint(ST_PAUL, 16, zoom)).toBe(0)
    expect(layer.nearestPoint({ latitude: 0, longitude: 0 }, 16, zoom)).toBeNull()
  })

  it('setStyle restyles from the same projection', async () => {
    const layer = layerAt(lonLat(ST_PAUL.longitude, ST_PAUL.latitude), new Uint8Array([1]), {
      1: statusStyle({ fill: '#2563eb' }),
    })
    const zoom = 7
    const tile = projectToTilePoint(ST_PAUL, zoom, 1)

    layer.setStyle(
      styleTable({
        1: statusStyle({ fill: '#f59e0b', order: 4, stroke: '#92400e' }),
      }),
    )
    const canvas = await layer.imageForTile(tile.tileX, tile.tileY, zoom, 1)

    expect(canvas?.calls.find((call) => call.op === 'fill')).toMatchObject({ fillStyle: '#f59e0b' })
  })
})

describe('point-layer nearestPoint', () => {
  it('returns the index of the nearer dot and null on a miss', () => {
    const zoom = 8
    const otherLon = shiftLongitude(ST_PAUL.longitude, ST_PAUL.latitude, 20, zoom)
    const layer = layerAt(
      new Float64Array([ST_PAUL.longitude, ST_PAUL.latitude, otherLon, ST_PAUL.latitude]),
      new Uint8Array([1, 1]),
      { 1: statusStyle() },
    )

    expect(layer.nearestPoint(ST_PAUL, 8, zoom)).toBe(0)
    expect(layer.nearestPoint({ latitude: ST_PAUL.latitude, longitude: otherLon }, 8, zoom)).toBe(1)
    expect(
      layer.nearestPoint(
        {
          latitude: ST_PAUL.latitude,
          longitude: shiftLongitude(ST_PAUL.longitude, ST_PAUL.latitude, 80, zoom),
        },
        8,
        zoom,
      ),
    ).toBeNull()
  })

  it('honours draw order when two dots overlap at the tap', () => {
    const zoom = 8
    const lowLon = shiftLongitude(ST_PAUL.longitude, ST_PAUL.latitude, 2, zoom)
    const layer = layerAt(
      new Float64Array([ST_PAUL.longitude, ST_PAUL.latitude, lowLon, ST_PAUL.latitude]),
      new Uint8Array([8, 1]),
      {
        1: statusStyle({ fill: '#16a34a', order: 2, radius: 8 }),
        8: statusStyle({ fill: '#dc2626', order: 10, radius: 8 }),
      },
    )

    // Tap sits on the lower-severity centre, which is still inside the
    // higher-severity disc. The painted top wins.
    expect(layer.nearestPoint({ latitude: ST_PAUL.latitude, longitude: lowLon }, 16, zoom)).toBe(0)
  })

  it('picks the nearer centre when the tap is not inside either disc', () => {
    const zoom = 8
    const otherLon = shiftLongitude(ST_PAUL.longitude, ST_PAUL.latitude, 12, zoom)
    const layer = layerAt(
      new Float64Array([ST_PAUL.longitude, ST_PAUL.latitude, otherLon, ST_PAUL.latitude]),
      new Uint8Array([8, 1]),
      {
        1: statusStyle({ order: 2, radius: 3 }),
        8: statusStyle({ order: 10, radius: 3 }),
      },
    )
    const midway = shiftLongitude(ST_PAUL.longitude, ST_PAUL.latitude, 8, zoom)

    expect(layer.nearestPoint({ latitude: ST_PAUL.latitude, longitude: midway }, 16, zoom)).toBe(1)
  })
})

describe('point-layer paint', () => {
  it('maps a point onto the canvas at the device pixel ratio and paints higher order last', () => {
    const canvas = createFakeCanvas(512, 512)
    const worldX = new Float64Array([0.5, 0.5])
    const worldY = new Float64Array([0.5, 0.5])
    const painted = paintPointLayerTile(canvas, {
      classes: new Uint8Array([1, 8]),
      indexes: [0, 1],
      pixelRatio: 2,
      style: [
        undefined,
        { fill: '#16a34a', order: 2, radius: 3, stroke: '#14532d', strokeWidth: 1 },
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { fill: '#dc2626', order: 10, radius: 4, stroke: '#7f1d1d', strokeWidth: 1 },
      ],
      tileSize: 256,
      tileX: 0,
      tileY: 0,
      worldX,
      worldY,
      zoom: 0,
    })

    expect(painted).toBe(true)
    expect(canvas.calls[0]).toEqual({ op: 'clearRect', args: [0, 0, 512, 512] })
    const fills = canvas.calls.filter((call) => call.op === 'fill')
    expect(fills[0]).toMatchObject({ fillStyle: '#16a34a' })
    expect(fills[1]).toMatchObject({ fillStyle: '#dc2626' })
    const arcs = canvas.calls.filter((call) => call.op === 'arc')
    expect(arcs[0]).toMatchObject({ args: [256, 256, 6, 0, Math.PI * 2] })
    expect(arcs[1]).toMatchObject({ args: [256, 256, 8, 0, Math.PI * 2] })
  })

  it('paints the eastern hemisphere on the single zoom-0 tile instead of wrapping it west', async () => {
    const layer = layerAt(lonLat(90, 0), new Uint8Array([1]), { 1: statusStyle() })
    const canvas = await layer.imageForTile(0, 0, 0, 1)
    const arc = canvas?.calls.find((call) => call.op === 'arc')

    expect(arc?.args[0]).toBeCloseTo(192, 5)
    expect(arc?.args[1]).toBeCloseTo(128, 5)
  })

  it('sizes imageForTile for the requested scale and returns null for an empty tile', async () => {
    const layer = layerAt(lonLat(ST_PAUL.longitude, ST_PAUL.latitude), new Uint8Array([1]), {
      1: statusStyle(),
    })
    const zoom = 7
    const tile = projectToTilePoint(ST_PAUL, zoom, 1)
    const retina = await layer.imageForTile(tile.tileX, tile.tileY, zoom, 2)
    const empty = await layer.imageForTile((tile.tileX + 4) % 128, tile.tileY, zoom, 2)

    expect(retina?.width).toBe(512)
    expect(empty).toBeNull()
  })
})

describe('point-layer national paint budget', () => {
  it(`paints ${NATIONAL_POINT_COUNT} points at zoom 3–4 within ${POINT_LAYER_NATIONAL_TILE_BUDGET_MS}ms per tile`, async () => {
    const positions = new Float64Array(NATIONAL_POINT_COUNT * 2)
    const classes = new Uint8Array(NATIONAL_POINT_COUNT)
    for (let index = 0; index < NATIONAL_POINT_COUNT; index += 1) {
      // Spread across CONUS so the index, not a single scan, does the work.
      const longitude =
        -124.7 + ((index * 17) % NATIONAL_POINT_COUNT) * (57.8 / NATIONAL_POINT_COUNT)
      const latitude = 25.1 + ((index * 31) % NATIONAL_POINT_COUNT) * (24.3 / NATIONAL_POINT_COUNT)
      positions[index * 2] = longitude
      positions[index * 2 + 1] = latitude
      const lane = index % 5
      classes[index] =
        lane === 0
          ? POINT_CLASS_NO_DATA
          : lane === 1
            ? POINT_CLASS_NOT_REPORTING
            : lane === 2
              ? 0
              : 4
    }

    const layer = createPointLayer({
      classes,
      createCanvas: createFakeCanvas,
      positions,
      style: styleTable({
        0: statusStyle({ fill: '#16a34a', order: 2, stroke: '#14532d' }),
        4: statusStyle({ fill: '#dc2626', order: 8, stroke: '#7f1d1d' }),
      }),
    })

    // Warm the lazy per-zoom index so the timed pass is paint, not first build.
    await layer.imageForTile(1, 3, 3, 1)
    await layer.imageForTile(3, 6, 4, 2)

    // Untimed occupancy walk: find the densest tile at each zoom/scale. A
    // single wall-clock sample per tile is load-sensitive (failed at 67–132ms
    // on a host at load ~37; isolated it was 8.95ms). The budget is asserted
    // on the mean of a tight loop over that densest tile instead.
    let paintedTiles = 0
    const busiest: Array<{ arcs: number; scale: number; x: number; y: number; zoom: number }> = []
    for (const zoom of [3, 4]) {
      const n = 2 ** zoom
      for (const scale of [1, 2]) {
        let best: { arcs: number; scale: number; x: number; y: number; zoom: number } | undefined
        for (let y = 0; y < n; y += 1) {
          for (let x = 0; x < n; x += 1) {
            const canvas = await layer.imageForTile(x, y, zoom, scale)
            if (!canvas) continue
            paintedTiles += 1
            const arcs = canvas.calls.filter((call) => call.op === 'arc').length
            if (!best || arcs > best.arcs) best = { arcs, scale, x, y, zoom }
          }
        }
        if (best) busiest.push(best)
      }
    }

    expect(paintedTiles).toBeGreaterThan(0)
    expect(busiest.length).toBeGreaterThan(0)

    const iterations = 20
    let reported = ''
    for (const tile of busiest) {
      const started = performance.now()
      for (let pass = 0; pass < iterations; pass += 1) {
        await layer.imageForTile(tile.x, tile.y, tile.zoom, tile.scale)
      }
      const meanMs = (performance.now() - started) / iterations
      expect(meanMs).toBeLessThan(POINT_LAYER_NATIONAL_TILE_BUDGET_MS)
      const label = `${tile.zoom}/${tile.x}/${tile.y}@${tile.scale}x`
      reported += `${label} ${meanMs.toFixed(2)}ms (${tile.arcs} dots); `
    }
    console.log(
      `point-layer national paint budget: mean of ${iterations} paints — ${reported}cap ${POINT_LAYER_NATIONAL_TILE_BUDGET_MS}ms`,
    )
  })
})
