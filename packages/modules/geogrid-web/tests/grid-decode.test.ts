import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  decimatedGridUrl,
  decodeGridBinary,
  GRID_DECODE_LIMITS,
  GridDecodeError,
  gridBounds,
  planeIndexOf,
  readGridStride,
} from '../src/core/decode/grid.js'

/**
 * The fourth leg of the `/grid` wire contract.
 *
 * `grid_header_kd490.bin` is the exact byte output of narduk-data's real
 * `publish_grid()`; `grid_header_kd490_gonogo_ts.bin` is the same logical grid
 * from gonogo-api's independent TypeScript encoder. Both are copied
 * byte-for-byte from `GeoGridKit/Tests/GeoGridCoreTests/Fixtures/`, and the
 * assertions below are the same ones GeoGridKit's `GridHeaderConformanceTests`
 * makes. Python producer, TypeScript producer, Swift consumer, and now this
 * decoder all agree on one set of bytes, or CI says so.
 */

const FIXTURES = {
  python: {
    file: 'grid_header_kd490.bin',
    byteCount: 320,
    sha256: 'dad3f1533329a0a86a7cc1e72c4dd17108c86ebea14e6f32ea8f5eee2d3924e9',
    headerBytes: 268,
  },
  gonogoTypeScript: {
    file: 'grid_header_kd490_gonogo_ts.bin',
    byteCount: 304,
    sha256: 'b1f047c03f2c3568b76286a126d8d6afa3c2b5ca254d4fde47217d41e1f977f1',
    headerBytes: 252,
  },
} as const

const EXPECTED_PLANE = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]

function loadFixture(name: string): ArrayBuffer {
  const path = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))
  const bytes = readFileSync(path)
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

/** Assemble a wire-shaped payload: LE header length, JSON header, LE float planes. */
function buildGrid(header: Record<string, unknown>, planes: number[][]): ArrayBuffer {
  const headerBytes = new TextEncoder().encode(JSON.stringify(header))
  const valueCount = planes.reduce((total, plane) => total + plane.length, 0)
  const buffer = new ArrayBuffer(4 + headerBytes.byteLength + valueCount * 4)
  const view = new DataView(buffer)
  view.setUint32(0, headerBytes.byteLength, true)
  new Uint8Array(buffer).set(headerBytes, 4)
  let offset = 4 + headerBytes.byteLength
  for (const plane of planes) {
    for (const value of plane) {
      view.setFloat32(offset, value, true)
      offset += 4
    }
  }
  return buffer
}

function baseHeader(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    layer: 'kd490',
    variables: ['KD490'],
    planeCount: 1,
    bbox: [-2, 0, 1, 2],
    width: 2,
    height: 2,
    lon0: -2,
    lat0: 2,
    dx: 1,
    dy: -1,
    units: 'm-1',
    scale: 'log',
    valueRange: [0.01, 6.6],
    renderMode: 'scalar',
    validTime: '2026-06-27T00:00:00Z',
    missing: 'NaN',
    ...overrides,
  }
}

describe('checked-in fixtures still match their GeoGridKit pins', () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    it(name, () => {
      const buffer = loadFixture(fixture.file)
      expect(buffer.byteLength).toBe(fixture.byteCount)
      expect(createHash('sha256').update(new Uint8Array(buffer)).digest('hex')).toBe(
        fixture.sha256,
      )
      // Envelope layout: 4-byte length prefix + header JSON + 48 payload bytes.
      expect(buffer.byteLength).toBe(4 + fixture.headerBytes + 48)
    })
  }
})

describe('decodeGridBinary matches the documented cross-language contract', () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    it(name, () => {
      const dataset = decodeGridBinary(loadFixture(fixture.file))
      const header = dataset.header

      expect(header.layer).toBe('kd490')
      expect(header.variables).toEqual(['KD490'])
      expect(header.planeCount).toBe(1)
      expect(header.bbox).toEqual([-2, 0, 1, 2])
      expect(header.width).toBe(4)
      expect(header.height).toBe(3)
      expect(header.lon0).toBe(-2)
      expect(header.lat0).toBe(2)
      expect(header.dx).toBe(1)
      expect(header.dy).toBe(-1)
      expect(header.units).toBe('m-1')
      expect(header.scale).toBe('log')
      expect(header.valueRange).toEqual({ lowerBound: 0.01, upperBound: 6.6 })
      expect(header.renderMode).toBe('scalar')
      expect(header.validTime).toBe('2026-06-27T00:00:00Z')
      expect(header.missing).toBe('NaN')

      // 1 plane, 3 rows x 4 columns, row-major, row 0 northernmost.
      expect(dataset.planes).toHaveLength(1)
      expect(Array.from(dataset.planes[0]!)).toEqual(EXPECTED_PLANE)
      expect(Array.from(dataset.masks[0]!)).toEqual(EXPECTED_PLANE.map(() => 1))
      expect(dataset.stride).toBeNull()
      expect(planeIndexOf(dataset, 'KD490')).toBe(0)
      expect(planeIndexOf(dataset, 'nope')).toBeNull()

      // GeoGridKit asserts its derived `header.bounds` here and cross-checks it
      // against the bbox the header carries independently. Same assertion, same
      // numbers: GeoBounds(minLon: -2, maxLon: 1, minLat: 0, maxLat: 2).
      expect(gridBounds(header)).toEqual([-2, 0, 1, 2])
      expect(gridBounds(header)).toEqual(header.bbox)
    })
  }

  it('decodes both producers to identical planes', () => {
    const python = decodeGridBinary(loadFixture(FIXTURES.python.file))
    const typescript = decodeGridBinary(loadFixture(FIXTURES.gonogoTypeScript.file))
    expect(Array.from(typescript.planes[0]!)).toEqual(Array.from(python.planes[0]!))
  })
})

describe('payload alignment', () => {
  it('decodes a payload the JSON header leaves unaligned', () => {
    // Pad until the float payload starts at a byte offset that is not a
    // multiple of 4 — the shape live /grid responses routinely have, and the
    // one `new Float32Array(buffer, offset)` cannot view.
    let padding = ''
    let buffer = buildGrid(baseHeader({ pad: padding }), [[1, 2, 3, 4]])
    while ((4 + new DataView(buffer).getUint32(0, true)) % 4 === 0) {
      padding += 'x'
      buffer = buildGrid(baseHeader({ pad: padding }), [[1, 2, 3, 4]])
    }

    const payloadStart = 4 + new DataView(buffer).getUint32(0, true)
    expect(payloadStart % 4).not.toBe(0)
    // Proof the hazard is real and this test exercises it.
    expect(() => new Float32Array(buffer, payloadStart, 4)).toThrow(RangeError)

    const dataset = decodeGridBinary(buffer)
    expect(Array.from(dataset.planes[0]!)).toEqual([1, 2, 3, 4])
  })

  it('decodes an odd width whose rows do not align to 4 floats', () => {
    const buffer = buildGrid(baseHeader({ width: 3, height: 3 }), [[0, 1, 2, 3, 4, 5, 6, 7, 8]])
    const dataset = decodeGridBinary(buffer)
    expect(dataset.header.width).toBe(3)
    expect(Array.from(dataset.planes[0]!)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
  })
})

describe('gridBounds', () => {
  it('orders each axis regardless of step sign', () => {
    // dy is negative on every real grid, so the derived extent must sort.
    const northUp = decodeGridBinary(
      buildGrid(baseHeader({ width: 4, height: 3, lon0: -2, lat0: 2, dx: 1, dy: -1 }), [
        Array.from({ length: 12 }, (_, index) => index),
      ]),
    )
    expect(gridBounds(northUp.header)).toEqual([-2, 0, 1, 2])

    const southUp = decodeGridBinary(
      buildGrid(baseHeader({ width: 4, height: 3, lon0: 1, lat0: 0, dx: -1, dy: 1 }), [
        Array.from({ length: 12 }, (_, index) => index),
      ]),
    )
    expect(gridBounds(southUp.header)).toEqual([-2, 0, 1, 2])
  })

  it('gives a single-cell grid a zero-area extent at its own center', () => {
    const dataset = decodeGridBinary(
      buildGrid(baseHeader({ width: 1, height: 1, lon0: -95, lat0: 29, dx: 1, dy: -1 }), [[1]]),
    )
    expect(gridBounds(dataset.header)).toEqual([-95, 29, -95, 29])
  })

  it('supplies an extent for a header that carries no bbox at all', () => {
    const dataset = decodeGridBinary(
      buildGrid(
        { layer: 'x', planeCount: 1, width: 4, height: 3, lon0: -2, lat0: 2, dx: 1, dy: -1 },
        [Array.from({ length: 12 }, (_, index) => index)],
      ),
    )
    expect(dataset.header.bbox).toBeNull()
    expect(gridBounds(dataset.header)).toEqual([-2, 0, 1, 2])
  })
})

describe('multi-plane grids', () => {
  it('indexes planes named by planeOrder', () => {
    const buffer = buildGrid(
      baseHeader({
        variables: undefined,
        planeOrder: ['kd490', 'chlor', 'sst'],
        planeCount: 3,
        layer: 'water_quality_source_mask',
      }),
      [
        [1, 1, 1, 1],
        [2, 2, 2, 2],
        [3, 3, 3, 3],
      ],
    )
    const dataset = decodeGridBinary(buffer)

    expect(dataset.header.variables).toEqual(['kd490', 'chlor', 'sst'])
    expect(dataset.planes).toHaveLength(3)
    expect(planeIndexOf(dataset, 'chlor')).toBe(1)
    expect(Array.from(dataset.planes[planeIndexOf(dataset, 'sst')!]!)).toEqual([3, 3, 3, 3])
  })

  it('prefers variables when a publisher writes both keys', () => {
    const buffer = buildGrid(
      baseHeader({ variables: ['a', 'b'], planeOrder: ['x', 'y'], planeCount: 2 }),
      [
        [1, 1, 1, 1],
        [2, 2, 2, 2],
      ],
    )
    expect(decodeGridBinary(buffer).header.variables).toEqual(['a', 'b'])
  })

  it('accepts an unnamed grid, as GeoGridKit does', () => {
    const buffer = buildGrid(baseHeader({ variables: undefined }), [[1, 2, 3, 4]])
    const dataset = decodeGridBinary(buffer)
    expect(dataset.header.variables).toEqual([])
    expect(planeIndexOf(dataset, 'KD490')).toBeNull()
  })

  it('rejects names that do not cover every plane exactly once', () => {
    expect(() =>
      decodeGridBinary(
        buildGrid(baseHeader({ variables: ['a'], planeCount: 2 }), [
          [1, 1, 1, 1],
          [2, 2, 2, 2],
        ]),
      ),
    ).toThrow(/name every plane exactly once/)
  })

  it('rejects duplicate plane names', () => {
    expect(() =>
      decodeGridBinary(
        buildGrid(baseHeader({ variables: ['a', 'a'], planeCount: 2 }), [
          [1, 1, 1, 1],
          [2, 2, 2, 2],
        ]),
      ),
    ).toThrow(/duplicate/)
  })
})

describe('finite masks', () => {
  it('marks NaN cells missing', () => {
    const buffer = buildGrid(baseHeader(), [[1, Number.NaN, 3, Number.NaN]])
    const dataset = decodeGridBinary(buffer)
    expect(Array.from(dataset.masks[0]!)).toEqual([1, 0, 1, 0])
    expect(Number.isNaN(dataset.planes[0]![1]!)).toBe(true)
  })

  it('marks infinities missing', () => {
    const buffer = buildGrid(baseHeader(), [
      [1, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 4],
    ])
    expect(Array.from(decodeGridBinary(buffer).masks[0]!)).toEqual([1, 0, 0, 1])
  })

  it('honours a numeric nodata sentinel', () => {
    const buffer = buildGrid(baseHeader({ nodata: -999 }), [[1, -999, 3, -999]])
    const dataset = decodeGridBinary(buffer)
    expect(dataset.header.missing).toBe(-999)
    expect(Array.from(dataset.masks[0]!)).toEqual([1, 0, 1, 0])
  })

  it('builds one mask per plane', () => {
    const buffer = buildGrid(baseHeader({ variables: ['a', 'b'], planeCount: 2 }), [
      [1, 2, 3, 4],
      [Number.NaN, Number.NaN, Number.NaN, Number.NaN],
    ])
    const dataset = decodeGridBinary(buffer)
    expect(Array.from(dataset.masks[0]!)).toEqual([1, 1, 1, 1])
    expect(Array.from(dataset.masks[1]!)).toEqual([0, 0, 0, 0])
  })
})

describe('fails closed on a malformed payload', () => {
  it('rejects a buffer with no header length', () => {
    expect(() => decodeGridBinary(new ArrayBuffer(2))).toThrow(GridDecodeError)
    expect(() => decodeGridBinary(new ArrayBuffer(2))).toThrow(/missing its header length/)
  })

  it('rejects a header length that runs off the end', () => {
    const buffer = new ArrayBuffer(64)
    new DataView(buffer).setUint32(0, 4_000_000_000, true)
    // Caught by the size cap before the read is even attempted.
    expect(() => decodeGridBinary(buffer)).toThrow(/header length is out of range/)
  })

  it('rejects an oversized header', () => {
    const buffer = new ArrayBuffer(64)
    new DataView(buffer).setUint32(0, GRID_DECODE_LIMITS.maxHeaderBytes + 1, true)
    expect(() => decodeGridBinary(buffer)).toThrow(/header length is out of range/)
  })

  it('rejects a header truncated inside the declared length', () => {
    const buffer = new ArrayBuffer(64)
    new DataView(buffer).setUint32(0, 500, true)
    expect(() => decodeGridBinary(buffer)).toThrow(/header is truncated/)
  })

  it('rejects a header that is not JSON', () => {
    const bytes = new TextEncoder().encode('not json at all')
    const buffer = new ArrayBuffer(4 + bytes.byteLength)
    new DataView(buffer).setUint32(0, bytes.byteLength, true)
    new Uint8Array(buffer).set(bytes, 4)
    expect(() => decodeGridBinary(buffer)).toThrow(/not valid UTF-8 JSON/)
  })

  it('rejects a header that is not an object', () => {
    const bytes = new TextEncoder().encode('[1,2,3]')
    const buffer = new ArrayBuffer(4 + bytes.byteLength)
    new DataView(buffer).setUint32(0, bytes.byteLength, true)
    new Uint8Array(buffer).set(bytes, 4)
    expect(() => decodeGridBinary(buffer)).toThrow(/must be a JSON object/)
  })

  it('rejects a truncated float payload', () => {
    const full = buildGrid(baseHeader(), [[1, 2, 3, 4]])
    expect(() => decodeGridBinary(full.slice(0, full.byteLength - 4))).toThrow(
      /payload is truncated/,
    )
  })

  it('rejects trailing bytes by default and accepts them on request', () => {
    const full = buildGrid(baseHeader(), [[1, 2, 3, 4]])
    const padded = new ArrayBuffer(full.byteLength + 8)
    new Uint8Array(padded).set(new Uint8Array(full))

    expect(() => decodeGridBinary(padded)).toThrow(/payload length mismatch/)
    const lenient = decodeGridBinary(padded, { allowTrailingBytes: true })
    expect(Array.from(lenient.planes[0]!)).toEqual([1, 2, 3, 4])
  })

  it('rejects invalid geometry', () => {
    expect(() => decodeGridBinary(buildGrid(baseHeader({ width: 0 }), [[]]))).toThrow(
      /width must be a positive integer/,
    )
    expect(() =>
      decodeGridBinary(buildGrid(baseHeader({ height: -1 }), [[1, 2, 3, 4]])),
    ).toThrow(/height must be a positive integer/)
    expect(() =>
      decodeGridBinary(buildGrid(baseHeader({ dx: 0, width: 2 }), [[1, 2, 3, 4]])),
    ).toThrow(/dx cannot be zero/)
    expect(() =>
      decodeGridBinary(buildGrid(baseHeader({ dy: 0, height: 2 }), [[1, 2, 3, 4]])),
    ).toThrow(/dy cannot be zero/)
    expect(() => decodeGridBinary(buildGrid(baseHeader({ lon0: 'west' }), [[1, 2, 3, 4]]))).toThrow(
      /lon0 must be a finite number/,
    )
  })

  it('rejects an inverted bbox', () => {
    expect(() =>
      decodeGridBinary(buildGrid(baseHeader({ bbox: [1, 2, -2, 0] }), [[1, 2, 3, 4]])),
    ).toThrow(/bbox is inverted/)
  })

  it('caps plane count and total values before allocating', () => {
    expect(() =>
      decodeGridBinary(
        buildGrid(baseHeader({ planeCount: GRID_DECODE_LIMITS.maxPlanes + 1 }), [[1, 2, 3, 4]]),
      ),
    ).toThrow(/planeCount exceeds/)
    expect(() =>
      decodeGridBinary(buildGrid(baseHeader({ width: 100_000, height: 100_000 }), [[]])),
    ).toThrow(/exceeds 10000000 values/)
  })
})

describe('optional metadata is lenient', () => {
  it('decodes a header carrying only the core geometry', () => {
    const buffer = buildGrid(
      {
        layer: 'kd490',
        planeCount: 1,
        width: 2,
        height: 2,
        lon0: -2,
        lat0: 2,
        dx: 1,
        dy: -1,
      },
      [[1, 2, 3, 4]],
    )
    const dataset = decodeGridBinary(buffer)
    expect(dataset.header.units).toBeNull()
    expect(dataset.header.scale).toBeNull()
    expect(dataset.header.valueRange).toBeNull()
    expect(dataset.header.renderMode).toBeNull()
    expect(dataset.header.bbox).toBeNull()
    expect(dataset.header.releaseId).toBeNull()
    expect(dataset.header.generationId).toBeNull()
    expect(dataset.header.provenanceCounts).toBeNull()
    expect(Array.from(dataset.planes[0]!)).toEqual([1, 2, 3, 4])
  })

  it('surfaces release metadata and provenance counts when present', () => {
    const buffer = buildGrid(
      baseHeader({
        releaseId: 'rel-2026-08-28',
        generationId: 'gen-42',
        provenanceCounts: { '0': 10, '1': 20, '2': 5, bogus: 'no' },
      }),
      [[1, 2, 3, 4]],
    )
    const header = decodeGridBinary(buffer).header
    expect(header.releaseId).toBe('rel-2026-08-28')
    expect(header.generationId).toBe('gen-42')
    expect(header.provenanceCounts).toEqual({ '0': 10, '1': 20, '2': 5 })
  })

  it('keeps unknown header keys reachable', () => {
    const buffer = buildGrid(baseHeader({ someFutureField: 'kept' }), [[1, 2, 3, 4]])
    expect(decodeGridBinary(buffer).header.extra).toEqual({ someFutureField: 'kept' })
  })

  it('ignores an unusable scale or renderMode rather than failing the decode', () => {
    const buffer = buildGrid(baseHeader({ scale: 'sqrt', renderMode: 'vector' }), [[1, 2, 3, 4]])
    const header = decodeGridBinary(buffer).header
    expect(header.scale).toBeNull()
    expect(header.renderMode).toBeNull()
  })
})

describe('decimation helpers', () => {
  it('builds a /grid URL', () => {
    expect(decimatedGridUrl('https://data.example', 'kd490')).toBe(
      'https://data.example/grid?layer=kd490',
    )
  })

  it('serializes bbox at four decimal places and passes maxCells through', () => {
    const url = new URL(
      decimatedGridUrl('https://data.example', 'kd490', {
        bbox: [-97.5, 27.25, -88, 30.5],
        date: '2026-08-28',
        maxCells: 250_000,
      }),
    )
    expect(url.searchParams.get('bbox')).toBe('-97.5000,27.2500,-88.0000,30.5000')
    expect(url.searchParams.get('date')).toBe('2026-08-28')
    expect(url.searchParams.get('maxCells')).toBe('250000')
  })

  it('rejects a nonsensical cell budget', () => {
    expect(() => decimatedGridUrl('https://data.example', 'kd490', { maxCells: 0 })).toThrow(
      RangeError,
    )
  })

  it('reads X-Grid-Stride from a Headers object or a plain record', () => {
    expect(readGridStride(new Headers({ 'X-Grid-Stride': '2' }))).toBe(2)
    expect(readGridStride({ 'X-Grid-Stride': '3' })).toBe(3)
    expect(readGridStride({ 'x-grid-stride': '4' })).toBe(4)
  })

  it('answers null when the response was not decimated', () => {
    expect(readGridStride(new Headers())).toBeNull()
    expect(readGridStride({ 'X-Grid-Stride': 'nonsense' })).toBeNull()
    expect(readGridStride({ 'X-Grid-Stride': '0' })).toBeNull()
  })

  it('records the stride on the decoded dataset', () => {
    const dataset = decodeGridBinary(loadFixture(FIXTURES.python.file), { stride: 2 })
    expect(dataset.stride).toBe(2)
  })
})
