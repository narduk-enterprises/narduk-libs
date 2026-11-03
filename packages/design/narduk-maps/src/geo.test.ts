// Ported from earth-web (apps/web/tests/unit/geo.test.ts and water.test.ts) with the code they test.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

import { describe, expect, it } from 'vitest'

import {
  bilinear,
  cadenceDays,
  dayNumber,
  decodePlayhead,
  decodePng,
  decodeTerrarium,
  decodeUv,
  encodePlayhead,
  fieldTicks,
  formatFieldValue,
  frameAt,
  frameMs,
  frameSpacing,
  type GeoLayer,
  indexUrl,
  isBetween,
  longDate,
  parseCatalog,
  parseIndex,
  playheadTime,
  prefetchFrames,
  RAMP_SIZE,
  rampTexture,
  registerPmtilesProtocol,
  setupMapLibre,
  shortDate,
  texelIn,
  tilesCovering,
  tileZoomFor,
} from './geo'

const CATALOG_URL = 'https://tiles.example/geo/sst/catalog.json'
const SST_FILLED = 'sst_filled'
const H06 = '2026-11-01T06Z'
const OCT15 = '2026-10-15'

// ---------- A tiny PNG encoder for the decoder tests ----------

function crc32(bytes: Uint8Array): number {
  let c = ~0
  for (const b of bytes) {
    c ^= b
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, body.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(body, 8)
  view.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)))
  return out
}

function paethOf(a: number, b: number, c: number) {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  return pb <= pc ? b : c
}

function predictor(filter: number, a: number, b: number, c: number) {
  return [0, a, b, (a + b) >> 1, paethOf(a, b, c)][filter]!
}

function filterRow(filter: number, row: Uint8Array, prev: Uint8Array | null, bpp: number) {
  const out = new Uint8Array(row.length)
  for (let i = 0; i < row.length; i++) {
    const a = i >= bpp ? row[i - bpp]! : 0
    const b = prev ? prev[i]! : 0
    const c = prev && i >= bpp ? prev[i - bpp]! : 0
    out[i] = (row[i]! - predictor(filter, a, b, c)) & 255
  }
  return out
}

function encodePng(
  width: number,
  height: number,
  colorType: number,
  bitDepth: number,
  rows: Uint8Array[],
  extra: Uint8Array[] = [],
): Uint8Array {
  const ihdr = new Uint8Array(13)
  const v = new DataView(ihdr.buffer)
  v.setUint32(0, width)
  v.setUint32(4, height)
  ihdr[8] = bitDepth
  ihdr[9] = colorType
  const bpp = Math.max(1, ((colorType === 6 ? 4 : colorType === 2 ? 3 : 1) * bitDepth) >> 3)
  const raw: number[] = []
  for (const [y, row] of rows.entries()) {
    const filter = y % 5 // every filter type, row by row
    raw.push(filter, ...filterRow(filter, row, y ? rows[y - 1]! : null, bpp))
  }
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    ...extra,
    chunk('IDAT', new Uint8Array(deflateSync(new Uint8Array(raw)))),
    chunk('IEND', new Uint8Array()),
  ]
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

describe('PNG decode (exact bytes)', () => {
  it('round-trips RGBA through all five scanline filters', async () => {
    const w = 7
    const h = 10
    const rows = Array.from({ length: h }, (_, y) =>
      Uint8Array.from({ length: w * 4 }, (_, i) => (i * 37 + y * 91 + ((i * y) % 13)) & 255),
    )
    const img = await decodePng(encodePng(w, h, 6, 8, rows))
    expect(img.width).toBe(w)
    expect(img.height).toBe(h)
    for (const [y, row] of rows.entries())
      expect([...img.data.subarray(y * w * 4, (y + 1) * w * 4)]).toEqual([...row])
  })

  it('expands 1-bit palette with tRNS transparency', async () => {
    const plte = chunk('PLTE', new Uint8Array([10, 20, 30, 200, 210, 220]))
    const trns = chunk('tRNS', new Uint8Array([0]))
    const img = await decodePng(
      encodePng(3, 1, 3, 1, [new Uint8Array([0b0100_0000])], [plte, trns]),
    )
    expect([...img.data]).toEqual([10, 20, 30, 0, 200, 210, 220, 255, 10, 20, 30, 0])
  })

  it('decodes a real production terrarium tile: land is no data, the Gulf reads as warm water', async () => {
    const bytes = readFileSync(
      fileURLToPath(new URL('./testing/fixtures/sst-terrarium-z3-2-3.png', import.meta.url)),
    )
    const img = await decodePng(new Uint8Array(bytes))
    expect(img.width).toBe(256)
    let nodata = 0
    for (let i = 3; i < img.data.length; i += 4) if (img.data[i] === 0) nodata++
    expect(nodata).toBeGreaterThan(1000) // North America, Cuba, the Yucatán
    const t = { z: 3, x: 2, y: 3 }
    const gulf = texelIn(t, -90, 25)
    const s = bilinear(img, gulf.px, gulf.py)
    expect(s.coverage).toBe(1)
    expect(s.value).toBeGreaterThan(20)
    expect(s.value).toBeLessThan(32)
    const kansas = texelIn(t, -98, 38)
    expect(bilinear(img, kansas.px, kansas.py).coverage).toBe(0)
  })
})

describe('terrarium and uv', () => {
  it('decodes v = R·256 + G + B/256 − 32768 exactly, alpha 0 is no data', () => {
    expect(decodeTerrarium(128, 0, 0, 255)).toBe(0)
    expect(decodeTerrarium(128, 20, 128, 255)).toBe(20.5)
    expect(decodeTerrarium(127, 254, 0, 255)).toBe(-2)
    expect(decodeTerrarium(128, 20, 128, 0)).toBeNull()
  })

  it('bilinear weights only texels with data', () => {
    // 2×1: left = 10, right = no data. Halfway between centres still reads 10, coverage 0.5.
    const data = new Uint8Array([128, 10, 0, 255, 128, 99, 0, 0])
    const s = bilinear({ data, width: 2, height: 1 }, 1, 0.5)
    expect(s.value).toBe(10)
    expect(s.coverage).toBeCloseTo(0.5)
    const full = new Uint8Array([128, 10, 0, 255, 128, 20, 0, 255])
    expect(bilinear({ data: full, width: 2, height: 1 }, 1, 0.5).value).toBeCloseTo(15)
  })

  it('decodes uv int16 pairs with the scale, −32768 is no data', () => {
    // u = 250 → 2.5 m/s, v = −100 → −1 m/s
    expect(decodeUv(0, 250, 0xff, 0x9c)).toEqual({ u: 2.5, v: -1 })
    expect(decodeUv(0x80, 0, 0, 0)).toBeNull()
  })
})

describe('ramp texture', () => {
  const stops = [
    { value: 0, r: 0, g: 0, b: 0, a: 255 },
    { value: 10, r: 200, g: 100, b: 50, a: 155 },
    { value: 20, r: 255, g: 255, b: 255, a: 255 },
  ]

  it('is RAMP_SIZE texels, linear in stored units across the range', () => {
    const px = rampTexture(stops, [0, 20])
    expect(px.length).toBe(RAMP_SIZE * 4)
    expect([...px.subarray(0, 4)]).toEqual([0, 0, 0, 255])
    expect([...px.subarray((RAMP_SIZE - 1) * 4)]).toEqual([255, 255, 255, 255])
    // Texel k sits at value 20·k/255; texel 64 ≈ 5.02 → about halfway to the middle stop.
    expect(px[64 * 4]).toBe(Math.round((200 * (20 * 64)) / 255 / 10))
  })

  it('clamps outside the stops', () => {
    const px = rampTexture(stops, [-10, 30])
    expect([...px.subarray(0, 4)]).toEqual([0, 0, 0, 255])
    expect([...px.subarray((RAMP_SIZE - 1) * 4)]).toEqual([255, 255, 255, 255])
  })
})

// ---------- Catalog v2 ----------

const goodLayer = {
  id: SST_FILLED,
  title: 'Sea temperature (gap-filled)',
  group: 'temperature',
  kind: 'field',
  completeness: 'filled',
  twin: 'sst_observed',
  units: '°C',
  bbox: [-180, -80, 180, 80],
  minZoom: 0,
  maxZoom: 5,
  field: {
    encoding: 'terrarium',
    transform: 'linear',
    range: [-2, 32],
    ramp: [
      { value: 32, r: 255, g: 0, b: 0 },
      { value: -2, r: 0, g: 0, b: 255, a: 200 },
    ],
    display: { units: '°F', scale: 1.8, offset: 32 },
  },
  frames: [
    { time: '2026-11-02', url: 'sst_filled/2026-11-02.pmtiles' },
    { time: '2026-11-01', url: 'sst_filled/2026-11-01.pmtiles' },
    { time: 'yesterday', url: 'bad.pmtiles' },
  ],
  cadence: 'P1D',
  source: { name: 'A very long source sentence.', attribution: 'NOAA CoastWatch' },
}

const catalogBody = {
  schema: 'narduk-geo-catalog/v2',
  product: 'sst-global',
  title: 'Sea surface temperature',
  attribution: 'NOAA',
  layers: [
    goodLayer,
    { ...goodLayer, id: 'sst_observed', completeness: 'observed', twin: SST_FILLED },
    { ...goodLayer, id: 'broken_bbox', bbox: [10, 0, -10, 5] },
    { ...goodLayer, id: 'mesh', kind: 'mesh' },
    { ...goodLayer, id: 'wind', field: { ...goodLayer.field, encoding: 'uv' } },
    { ...goodLayer, id: 'no_ramp', field: { ...goodLayer.field, ramp: [] } },
    { ...goodLayer, id: 'no_frames', frames: [] },
    {
      id: 'contours',
      title: 'Depth contours',
      group: 'seafloor',
      kind: 'vector',
      vector: { layers: ['contours'], geometry: 'line' },
      archives: [{ url: 'contours/2026-11-02.pmtiles', minZoom: 5, maxZoom: 12 }],
      caveats: ['Not for navigation.', 42],
      bbox: [-98.5, 17.5, -80.5, 31],
      minZoom: 5,
      maxZoom: 12,
    },
    'not even an object',
  ],
}

describe('catalog v2 parsing', () => {
  const cat = parseCatalog(catalogBody, CATALOG_URL)

  it('keeps the catalog and skips each malformed or unknown layer with a reason', () => {
    expect(cat.layers.map(l => l.id)).toEqual([SST_FILLED, 'sst_observed', 'wind', 'contours'])
    const skipped = Object.fromEntries(cat.skipped.map(s => [s.id, s.reason]))
    expect(skipped.broken_bbox).toBe('bad bbox')
    expect(skipped.mesh).toMatch(/kind mesh/)
    expect(skipped.wind).toBeUndefined()
    expect(skipped.no_ramp).toBe('bad ramp')
    expect(skipped.no_frames).toBe('no frames')
    expect(skipped['?']).toBe('no id')
  })

  it('resolves frame URLs against the catalog, sorts oldest first, drops bad times', () => {
    const l = cat.layers[0]!
    expect(l.frames.map(f => f.time)).toEqual(['2026-11-01', '2026-11-02'])
    expect(l.frames[0]!.archives[0]!.url).toBe(
      'https://tiles.example/geo/sst/sst_filled/2026-11-01.pmtiles',
    )
  })

  it('sorts the ramp and treats a missing alpha as 255', () => {
    const ramp = cat.layers[0]!.field!.ramp
    expect(ramp.map(s => s.value)).toEqual([-2, 32])
    expect(ramp[0]!.a).toBe(200)
    expect(ramp[1]!.a).toBe(255)
  })

  it('reads static vector layers with caveats', () => {
    const v = cat.layers.find(l => l.kind === 'vector')!
    expect(v.kind).toBe('vector')
    expect(v.vector?.layers).toEqual(['contours'])
    expect(v.frames).toHaveLength(1)
    expect(v.frames[0]!.time).toBeNull()
    expect(v.caveats).toEqual(['Not for navigation.'])
  })

  it('refuses a catalog of another schema', () => {
    expect(() =>
      parseCatalog({ ...catalogBody, schema: 'narduk-geo-catalog/v9' }, CATALOG_URL),
    ).toThrow()
  })

  it('reads the index with either group or groups, relative to the index', () => {
    const entries = parseIndex(
      {
        schema: 'narduk-geo-index/v1',
        products: [
          {
            id: 'sst-global',
            title: 'SST',
            groups: ['temperature'],
            catalog: 'sst-global/catalog.json',
          },
          { id: 'x', group: 'biology', catalog: 'x/catalog.json' },
          { id: 'broken' },
        ],
      },
      'https://tiles.nard.uk/geo/index.json',
    )
    expect(entries.map(e => [e.id, e.group, e.catalog])).toEqual([
      ['sst-global', 'temperature', 'https://tiles.nard.uk/geo/sst-global/catalog.json'],
      ['x', 'biology', 'https://tiles.nard.uk/geo/x/catalog.json'],
    ])
    expect(indexUrl('https://tiles.nard.uk/geo/')).toBe('https://tiles.nard.uk/geo/index.json')
    expect(indexUrl('/geo-fixture', 'http://127.0.0.1:3000/x')).toBe(
      'http://127.0.0.1:3000/geo-fixture/index.json',
    )
  })
})

describe('display units and legend', () => {
  const sst = parseCatalog(catalogBody, CATALOG_URL).layers[0]!
  const chl: GeoLayer = {
    ...sst,
    id: 'chl',
    units: 'mg m-3',
    field: { ...sst.field!, transform: 'log10', range: [-1.6, 2], display: undefined },
  }

  it('reads °C as °F first, °C beside', () => {
    expect(formatFieldValue(sst, 25)).toEqual({ primary: '77.0 °F', secondary: '25.0 °C' })
  })

  it('reads log10 chlorophyll as mg/m³ to two significant digits', () => {
    expect(formatFieldValue(chl, Math.log10(0.3843)).primary).toBe('0.38 mg/m³')
    expect(formatFieldValue(chl, Math.log10(12.7)).primary).toBe('13 mg/m³')
  })

  it('ticks in display units', () => {
    const t = fieldTicks(sst)
    expect(t.map(x => x.label)).toEqual(['40°', '60°', '80°'])
    // 80 °F = 26.67 °C → (26.67 + 2) / 34
    expect(t.at(-1)!.at).toBeCloseTo((80 - 32) / 1.8 / 34 + 2 / 34)
    const l = fieldTicks(chl)
    // Over three decades: one tick per decade, so a 200 px legend stays readable.
    expect(l.map(x => x.label)).toEqual(['0.1', '1', '10', '100'])
    expect(l.find(x => x.label === '1')!.at).toBeCloseTo(1.6 / 3.6)
  })
})

describe('frame time and selection', () => {
  it('reads daily and hourly frame times as fractional UTC days', () => {
    expect(dayNumber(H06) - dayNumber('2026-11-01')).toBeCloseTo(0.25)
    expect(frameMs(H06)).toBe(Date.parse('2026-11-01T06:00:00Z'))
    expect(shortDate(H06, 'UTC')).toBe('Sun 06:00')
    expect(longDate(H06, 'UTC')).toBe('Sun, Nov 1, 06:00 UTC')
    expect(playheadTime(dayNumber(H06) + 0.5 / 24)).toBe('2026-11-01T06:30Z')
    expect(longDate('2026-11-01')).toBe('Sun, Nov 1')
  })

  it('finds the typical spacing and cadence', () => {
    const days = ['2026-11-01T00Z', H06, '2026-11-01T12Z', '2026-11-02T00Z'].map(dayNumber)
    expect(frameSpacing(days)).toBeCloseTo(0.25)
    expect(cadenceDays('PT6H')).toBeCloseTo(0.25)
    expect(cadenceDays('P1D')).toBe(1)
    expect(cadenceDays(undefined)).toBe(1)
  })

  it('selects frames a and b and the cross-fade fraction between hourly frames', () => {
    const days = ['2026-11-01T00Z', H06, '2026-11-01T18Z'].map(dayNumber)
    const f = frameAt(days, days[1]! + 0.25) // 12Z, halfway across a 12 h gap
    expect(f).toMatchObject({ a: 1, b: 2 })
    expect(f.t).toBeCloseTo(0.5)
  })

  it('picks the tile zoom for a 256 px pyramid and covers a view', () => {
    expect(tileZoomFor(4.3, 0, 5)).toBe(5)
    expect(tileZoomFor(9, 0, 5)).toBe(5)
    expect(tileZoomFor(0.2, 2, 7)).toBe(2)
    expect(tilesCovering([-98, 18, -80, 31], 3)).toEqual({ x0: 1, x1: 2, y0: 3, y1: 3 })
    expect(tilesCovering([10, 0, 5, 1], 3)).toBeNull()
  })
})

describe('frame time across a gap', () => {
  const days = ['2026-10-14', OCT15, '2026-10-18'].map(dayNumber)

  it('finds the bracketing frames and the fraction, across a gap', () => {
    const f = frameAt(days, days[1]! + 1.5)
    expect(f).toMatchObject({ a: 1, b: 2, span: 3 })
    expect(f.t).toBeCloseTo(0.5)
    expect(isBetween(f)).toBe(true)
  })

  it('clamps at the ends', () => {
    expect(frameAt(days, days[0]! - 4)).toMatchObject({ a: 0, b: 0, t: 0 })
    expect(frameAt(days, days[2]! + 4)).toMatchObject({ a: 2, b: 2, t: 0 })
  })

  it('round-trips the playhead through the URL as a date and UTC hour', () => {
    expect(encodePlayhead(dayNumber(OCT15))).toBe(OCT15)
    expect(encodePlayhead(dayNumber(OCT15) + 0.5)).toBe('2026-10-15T12')
    expect(decodePlayhead('2026-10-15T06')).toBeCloseTo(dayNumber(OCT15) + 0.25)
    expect(decodePlayhead('nonsense')).toBeUndefined()
  })
})

describe('prefetch policy', () => {
  it('loads the next two frames after frame b', () => {
    expect(prefetchFrames({ a: 3, b: 4, t: 0.5, span: 1 })).toEqual([5, 6])
    expect(prefetchFrames({ a: 0, b: 0, t: 0, span: 0 }, 3)).toEqual([1, 2, 3])
    expect(prefetchFrames({ a: 0, b: 0, t: 0, span: 0 }, 0)).toEqual([])
  })
})

describe('MapLibre setup', () => {
  it('names the worker and registers pmtiles:// once per MapLibre module', () => {
    const calls: string[] = []
    const maplibre = {
      addProtocol: ((name: string) => {
        calls.push(`protocol:${name}`)
      }) as never,
      setWorkerUrl: ((url: string) => {
        calls.push(`worker:${url}`)
      }) as never,
    }
    setupMapLibre(maplibre, { workerUrl: '/w.mjs' })
    setupMapLibre(maplibre, { workerUrl: '/w.mjs' })
    registerPmtilesProtocol(maplibre)
    expect(calls).toEqual(['worker:/w.mjs', 'protocol:pmtiles', 'worker:/w.mjs'])
  })
})
