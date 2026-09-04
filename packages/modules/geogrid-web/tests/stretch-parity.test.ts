import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

import type { GridBBox, GridScale, GridValueRange } from '../src/core/models.js'
import type { GridBinaryHeader, GridScalarDataset } from '../src/core/decode/grid.js'
import {
  boundsSampleGeometry,
  defaultViewportPercentileStretch,
  GRID_STRETCH_TARGET_SAMPLE_COUNT,
  gridExtremes,
  gridIndexRange,
  gridPercentiles,
  GridStretchController,
  paddedRange,
  percentileHF7,
  sampleGridValues,
  stretchDisplayRange,
  stretchStride,
  viewportBBox,
  type GridDisplayRangeMeta,
  type GridRangeStretch,
} from '../src/core/stretch.js'

/**
 * The dynamic-range contract, checked against its two references rather than
 * against itself.
 *
 * `core/stretch.ts` is one half of a cross-platform pin: GeoGridKit
 * `Sources/GeoGridCore/Stretch.swift` (`b13d61d`) is the other. A drift here is
 * not a local bug, it is the Swift and web clients disagreeing about what range
 * the same grid is displayed over — which shows up as two screenshots of the
 * same date that do not match, and as nothing at all in CI.
 *
 * So three separate things are pinned separately:
 *
 * 1. **numpy** owns the percentile method. `grid-stretch-parity-v1.json` is what
 *    it answers, and its first eight cases are *byte-identical* to the fixture
 *    GeoGridKit's own `StretchTests` reads — same generator code, same seed,
 *    same draw order (see `generate_stretch_parity.py`).
 * 2. **GeoGridKit's `StretchTests`** owns everything numpy has no opinion about:
 *    the stride rule, the cell-center sampling window, the gap rule, the tier
 *    thresholds, the dispatch table. Every vector in this file's Swift-mirror
 *    blocks was read out of that test and is asserted on the same inputs.
 * 3. **The controller** is web-only — GeoGridKit's overlay owns its own — so it
 *    is pinned to the three numbers in the lane brief: 250 ms, 2%, frozen.
 */

interface PercentileProbe {
  percent: number
  value: number
}
interface PercentileCase {
  name: string
  values: number[]
  /**
   * The unfiltered plane, with gaps written as `"NaN"` / `"Infinity"` /
   * `"-Infinity"` — JSON has no non-finite literal, so the alternative is a file
   * `JSON.parse` refuses.
   */
  rawValues?: Array<number | string>
  percentiles: PercentileProbe[]
}
interface PadCase {
  name: string
  range: [number, number]
  pad: number
  scale: GridScale
  expected: [number, number]
}
interface StretchParityFixture {
  format: string
  percentileFormat: string
  numpyVersion: string
  sharedCaseCount: number
  cases: PercentileCase[]
  padCases: PadCase[]
}

const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/grid-stretch-parity-v1.json', import.meta.url), 'utf8'),
) as StretchParityFixture

/** The eight cases GeoGridKit's fixture carries, in its order. */
const GEOGRIDKIT_CASE_NAMES = [
  'single',
  'pair',
  'ten-ascending',
  'eleven-ascending',
  'duplicates',
  'negatives',
  'kd490-like',
  'sst-like',
]

// ---------------------------------------------------------------------------
// Grid builders — the Swift test helpers, in TypeScript
// ---------------------------------------------------------------------------

function makeHeader(
  width: number,
  height: number,
  lon0: number,
  lat0: number,
  dx: number,
  dy: number,
): GridBinaryHeader {
  return {
    layer: 'test',
    variables: ['value'],
    planeCount: 1,
    bbox: null,
    width,
    height,
    lon0,
    lat0,
    dx,
    dy,
    units: '1',
    scale: 'linear',
    valueRange: { lowerBound: 0, upperBound: 255 },
    renderMode: 'scalar',
    validTime: null,
    missing: 'NaN',
    releaseId: null,
    generationId: null,
    provenanceCounts: null,
    extra: {},
  }
}

/**
 * A dataset with the mask `decodeGridBinary` would have built for it, so the
 * sampler is exercised through the same gap rule production data arrives with
 * rather than through a hand-set mask that could be more generous.
 */
function makeDataset(
  width: number,
  height: number,
  lon0: number,
  lat0: number,
  dx: number,
  dy: number,
  values: Float32Array,
): GridScalarDataset {
  const mask = new Uint8Array(values.length)
  for (let i = 0; i < values.length; i += 1) mask[i] = Number.isFinite(values[i]!) ? 1 : 0
  return {
    header: makeHeader(width, height, lon0, lat0, dx, dy),
    planes: [values],
    masks: [mask],
    stride: null,
  }
}

/**
 * A grid whose values are the cell's own row-major index — so every percentile
 * and extreme is an exact integer and a wrong answer is legible rather than
 * plausible.
 *
 * The deltas are binary-exact (0.25, 1/16) for the reason GeoGridKit's helper
 * spells out: a delta like `360/699` puts the grid's own computed bounds half an
 * ULP inside the last cell center, and the viewport intersection would then drop
 * an edge row for reasons that have nothing to do with the code under test.
 */
function makeRampDataset(width: number, height: number): GridScalarDataset {
  const values = new Float32Array(width * height)
  for (let i = 0; i < values.length; i += 1) values[i] = i
  return makeDataset(width, height, -100, 30, 0.25, -0.0625, values)
}

function boundsOf(dataset: GridScalarDataset): GridBBox {
  const { lon0, lat0, dx, dy, width, height } = dataset.header
  const lastLon = lon0 + (width - 1) * dx
  const lastLat = lat0 + (height - 1) * dy
  return [
    Math.min(lon0, lastLon),
    Math.min(lat0, lastLat),
    Math.max(lon0, lastLon),
    Math.max(lat0, lastLat),
  ]
}

// ---------------------------------------------------------------------------
// 1. Hyndman-Fan type 7
// ---------------------------------------------------------------------------

describe('percentileHF7', () => {
  it('matches the hand-computed table GeoGridKit spells out', () => {
    // r = p/100 * (n - 1) = p/100 * 9.
    // p = 0   -> r = 0     -> v[0] = 0
    // p = 50  -> r = 4.5   -> v[4] + 0.5 * (v[5] - v[4]) = 4.5
    // p = 100 -> r = 9     -> v[9] = 9
    // p = 2   -> r = 0.18  -> v[0] + 0.18 * (v[1] - v[0]) = 0.18
    // p = 98  -> r = 8.82  -> v[8] + 0.82 * (v[9] - v[8]) = 8.82
    const values = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
    expect(percentileHF7(values, 0)).toBeCloseTo(0, 12)
    expect(percentileHF7(values, 50)).toBeCloseTo(4.5, 12)
    expect(percentileHF7(values, 100)).toBeCloseTo(9, 12)
    expect(percentileHF7(values, 2)).toBeCloseTo(0.18, 12)
    expect(percentileHF7(values, 98)).toBeCloseTo(8.82, 12)

    // A single sample is its own every percentile.
    expect(percentileHF7([4.25], 37)).toBe(4.25)
  })

  it('clamps a percentile outside 0…100 rather than indexing off the end', () => {
    const values = [1, 2, 3, 4]
    expect(percentileHF7(values, -50)).toBe(1)
    expect(percentileHF7(values, 250)).toBe(4)
  })

  it('answers NaN for an empty sample', () => {
    expect(Number.isNaN(percentileHF7([], 50))).toBe(true)
  })

  /**
   * A fixture *shape* check, and deliberately nothing more.
   *
   * It asserts the schema marker, the shared case names in GeoGridKit's own
   * order, and that the web extras are still there — so a truncated or reordered
   * regeneration is caught. It does **not** prove the shared cases carry
   * GeoGridKit's numbers: this repository has no copy of that file to compare
   * against. That claim holds by construction (identical generator code, seed,
   * and draw order — see `generate_stretch_parity.py`) and is verified out of
   * band, and it is named that way here so nobody mistakes a green name check
   * for a byte comparison.
   */
  it('has the fixture shape both languages agree on', () => {
    expect(fixture.percentileFormat).toBe('narduk-percentile-hf7-v1')
    expect(fixture.cases.slice(0, fixture.sharedCaseCount).map((c) => c.name)).toEqual(
      GEOGRIDKIT_CASE_NAMES,
    )
    expect(fixture.cases.length).toBeGreaterThanOrEqual(16)
    expect(fixture.padCases.length).toBeGreaterThanOrEqual(10)
    // Every case actually carries probes. An empty list would make the parity
    // loop below iterate over nothing and pass while asserting exactly nothing.
    for (const testCase of fixture.cases) {
      expect(testCase.values.length).toBeGreaterThan(0)
      expect(testCase.percentiles.length).toBeGreaterThanOrEqual(9)
    }
  })

  it('agrees with numpy on every probe of every case', () => {
    let worst = 0
    for (const testCase of fixture.cases) {
      const sorted = [...testCase.values].sort((a, b) => a - b)
      for (const probe of testCase.percentiles) {
        const actual = percentileHF7(sorted, probe.percent)
        const deviation = Math.abs(actual - probe.value)
        worst = Math.max(worst, deviation)
        // The tolerance GeoGridKit's own StretchTests uses, and for the reason
        // named in the generator: numpy's `_lerp` computes `a + (b-a)*t` below
        // t = 0.5 and `b - (b-a)*(1-t)` at or above it, so byte-exact agreement
        // with numpy is unavailable to any implementation of the documented
        // closed form -- Swift's included.
        expect(deviation).toBeLessThanOrEqual(1e-9)
      }
    }
    // Not an assertion about numpy so much as about this port: the closed form
    // lands on numpy's answer to within a rounding of the last bit, not merely
    // inside a loose tolerance that would also pass a subtly different method.
    expect(worst).toBeLessThan(1e-14)
  })

  it('keeps exactly the finite samples a gap-laden plane offers', () => {
    let checked = 0
    for (const testCase of fixture.cases) {
      if (!testCase.rawValues) continue
      const plane = testCase.rawValues.map((value) =>
        typeof value === 'string' ? Number(value) : value,
      )
      // Every sentinel decoded to something genuinely non-finite, so the case is
      // testing the filter rather than a list of ordinary numbers.
      expect(plane.some((value) => !Number.isFinite(value))).toBe(true)
      expect(plane.filter((value) => Number.isFinite(value))).toEqual(testCase.values)
      checked += 1
    }
    expect(checked).toBeGreaterThanOrEqual(2)
  })
})

// ---------------------------------------------------------------------------
// 2. Stride — per axis, ceiling included
// ---------------------------------------------------------------------------

describe('stretchStride', () => {
  it('follows the ceiling-of-the-square-root rule GeoGridKit pins', () => {
    expect(stretchStride(0)).toBe(1)
    expect(stretchStride(GRID_STRETCH_TARGET_SAMPLE_COUNT)).toBe(1)
    // The ceiling is literal: one cell past the target already strides.
    expect(stretchStride(65_537)).toBe(2)
    // 4x the target population strides by 2 on each axis, which is 4x fewer cells.
    expect(stretchStride(262_144)).toBe(2)
    expect(stretchStride(262_145)).toBe(3)
    expect(stretchStride(589_824)).toBe(3)
    expect(stretchStride(6_553_600)).toBe(10)
  })

  it('is not fooled by a negative or non-finite candidate count', () => {
    expect(stretchStride(-1)).toBe(1)
    expect(stretchStride(Number.NaN)).toBe(1)
    expect(stretchStride(Number.POSITIVE_INFINITY)).toBe(1)
  })

  /**
   * The failure this exists to catch: a stride applied to one axis only.
   *
   * That reading passes every scalar test of `stretchStride` itself and still
   * disagrees with Swift about the sample population by a factor of the stride,
   * which moves a percentile. The arithmetic that makes the two-axis reading the
   * only self-consistent one is the square root: `sqrt(n/target)` per axis caps
   * the product near `target`, where one-axis striding would leave it at
   * `n/sqrt(n/target)` — larger than the target by the stride itself.
   */
  it('caps the sampled population near the target on both axes together', () => {
    const dataset = makeRampDataset(700, 700)
    const sample = sampleGridValues(dataset, boundsOf(dataset))
    expect(sample).not.toBeNull()
    expect(sample!.stride).toBe(3)
    const perAxis = Math.floor((700 + 2) / 3)
    expect(sample!.values.length).toBe(perAxis * perAxis)
    expect(sample!.values.length).toBeLessThanOrEqual(GRID_STRETCH_TARGET_SAMPLE_COUNT)
    // One-axis striding would have produced this instead — 3x too many.
    expect(sample!.values.length).not.toBe(perAxis * 700)
  })
})

// ---------------------------------------------------------------------------
// 3. Sampling window, gaps, determinism, tiers
// ---------------------------------------------------------------------------

describe('sampleGridValues', () => {
  it('is deterministic across runs', () => {
    const dataset = makeRampDataset(700, 700)
    const first = sampleGridValues(dataset, boundsOf(dataset))
    const second = sampleGridValues(dataset, boundsOf(dataset))
    expect(first).not.toBeNull()
    expect(second!.values).toEqual(first!.values)
    expect(second!.stride).toBe(first!.stride)
  })

  it('samples only the cells whose centers fall inside the viewport', () => {
    // 11x1 grid of centers at longitude 0, 1, … 10; value == column index.
    const values = new Float32Array(11)
    for (let i = 0; i < 11; i += 1) values[i] = i
    const dataset = makeDataset(11, 1, 0, 0, 1, -1, values)

    const sample = sampleGridValues(dataset, [2.5, -1, 5.5, 1])
    expect(sample?.values).toEqual([3, 4, 5])

    expect(sampleGridValues(dataset, [40, -1, 50, 1])).toBeNull()
  })

  it('excludes gaps, and answers nothing for an all-gap viewport', () => {
    const values = new Float32Array([0, 1, 2, 3, Number.NaN, 5, 6, 7, 8])
    const dataset = makeDataset(3, 3, 0, 1, 1, -1, values)
    const sample = sampleGridValues(dataset, boundsOf(dataset))
    expect(sample?.values).toEqual([0, 1, 2, 3, 5, 6, 7, 8])

    const empty = makeDataset(3, 3, 0, 1, 1, -1, new Float32Array(9).fill(Number.NaN))
    expect(sampleGridValues(empty, boundsOf(empty))).toBeNull()
    expect(gridPercentiles(empty, boundsOf(empty))).toBeNull()
  })

  /**
   * Where this deliberately outruns Swift, and why that is not a drift.
   *
   * GeoGridKit's sampler tests `isFinite` alone, because its decoder never
   * applies a numeric `nodata` sentinel — `GridHeader.missing` is a `String` it
   * stores and ignores. This decoder does apply one, through the per-plane mask.
   * On every grid whose `missing` is `NaN` the two rules are the same rule; on
   * one that names `-9999` the mask is the only thing standing between a
   * percentile floor and a number nobody measured.
   */
  it('honors a numeric nodata sentinel through the mask', () => {
    const values = new Float32Array([1, 2, 3, -9999, 5, 6, 7, 8, 9])
    const dataset = makeDataset(3, 3, 0, 1, 1, -1, values)
    dataset.header.missing = -9999
    dataset.masks[0]![3] = 0

    const sample = sampleGridValues(dataset, boundsOf(dataset))
    expect(sample?.values).toEqual([1, 2, 3, 5, 6, 7, 8, 9])
    expect(gridExtremes(dataset, boundsOf(dataset))?.range).toEqual({
      lowerBound: 1,
      upperBound: 9,
    })
  })

  it('answers nothing for a plane whose length disagrees with the geometry', () => {
    const dataset = makeDataset(3, 3, 0, 1, 1, -1, new Float32Array(9).fill(1))
    dataset.planes[0] = new Float32Array(8)
    expect(sampleGridValues(dataset, boundsOf(dataset))).toBeNull()
  })
})

describe('gridIndexRange', () => {
  it('handles the negative latitude delta every real grid has', () => {
    // lat0 = 30, dy = -1, 5 rows: centers 30, 29, 28, 27, 26.
    expect(gridIndexRange(30, -1, 5, 27.5, 29.5)).toEqual({ lower: 1, upper: 2 })
  })

  it('refuses a degenerate or inverted request', () => {
    expect(gridIndexRange(0, 0, 5, 0, 4)).toBeNull()
    expect(gridIndexRange(0, 1, 0, 0, 4)).toBeNull()
    expect(gridIndexRange(0, 1, 5, 4, 0)).toBeNull()
    expect(gridIndexRange(0, 1, 5, Number.NaN, 4)).toBeNull()
  })
})

describe('tiers', () => {
  it('reports exact for a viewport read whole', () => {
    const dataset = makeRampDataset(32, 32)
    const result = gridPercentiles(dataset, boundsOf(dataset))
    expect(result?.tier).toBe('exact')
    expect(result?.sampleCount).toBe(32 * 32)
  })

  it('reports subsampled once the stride bites', () => {
    const dataset = makeRampDataset(700, 700)
    const sample = sampleGridValues(dataset, boundsOf(dataset))!
    const result = gridPercentiles(dataset, boundsOf(dataset), { low: 2, high: 98 })
    expect(result?.tier).toBe('subsampled')
    expect(result?.sampleCount).toBe(sample.values.length)
  })

  it('reports insufficient rather than a useless zero-width range', () => {
    const dataset = makeDataset(3, 3, 0, 1, 1, -1, new Float32Array(9).fill(7))
    const result = gridPercentiles(dataset, boundsOf(dataset))
    expect(result?.tier).toBe('insufficient')
    expect(result?.range).toEqual({ lowerBound: 7, upperBound: 7 })
  })

  it('reports insufficient below the minimum sample count', () => {
    const values = new Float32Array([1, 2, 3])
    const dataset = makeDataset(3, 1, 0, 0, 1, -1, values)
    const result = gridPercentiles(dataset, boundsOf(dataset))
    expect(result?.sampleCount).toBe(3)
    expect(result?.tier).toBe('insufficient')
  })
})

/**
 * The same grid seen at two decimation tiers.
 *
 * The server hands back an overview by striding the publish; the client strides
 * again to cap its own sample population. Both are deterministic, and the counts
 * below are written down rather than derived so that a change to either rule has
 * to be argued for in a diff instead of absorbed.
 */
describe('stride determinism across decimation tiers', () => {
  it('produces documented, reproducible sample counts at overview and native', () => {
    const native = makeRampDataset(512, 512)
    const overview = makeRampDataset(128, 128)

    const nativeSample = sampleGridValues(native, boundsOf(native))!
    const overviewSample = sampleGridValues(overview, boundsOf(overview))!

    // 512 * 512 = 262_144 candidates -> ceil(sqrt(262144/65536)) = 2.
    expect(nativeSample.stride).toBe(2)
    expect(nativeSample.values.length).toBe(256 * 256)
    // 128 * 128 = 16_384 candidates, under the target -> stride 1, read whole.
    expect(overviewSample.stride).toBe(1)
    expect(overviewSample.values.length).toBe(128 * 128)

    // Re-running either is byte-identical, tier to tier and run to run.
    expect(sampleGridValues(native, boundsOf(native))!.values).toEqual(nativeSample.values)
    expect(sampleGridValues(overview, boundsOf(overview))!.values).toEqual(overviewSample.values)
  })
})

// ---------------------------------------------------------------------------
// 4. Padding, in the layer's own scale
// ---------------------------------------------------------------------------

describe('paddedRange', () => {
  it('matches the CPython reference table for every case', () => {
    expect(fixture.padCases.length).toBeGreaterThanOrEqual(10)
    for (const padCase of fixture.padCases) {
      const actual = paddedRange(
        { lowerBound: padCase.range[0], upperBound: padCase.range[1] },
        padCase.pad,
        padCase.scale,
      )
      expect(actual.lowerBound).toBeCloseTo(padCase.expected[0], 12)
      expect(actual.upperBound).toBeCloseTo(padCase.expected[1], 12)
    }
  })

  it('pads linearly for a linear layer', () => {
    const padded = paddedRange({ lowerBound: 10, upperBound: 30 }, 0.1, 'linear')
    expect(padded.lowerBound).toBeCloseTo(8, 12)
    expect(padded.upperBound).toBeCloseTo(32, 12)
  })

  it('pads in log space for a log layer', () => {
    // 0.01…1 spans two decades; a 50% pad widens by one decade on each side.
    const padded = paddedRange({ lowerBound: 0.01, upperBound: 1 }, 0.5, 'log')
    expect(padded.lowerBound).toBeCloseTo(0.001, 12)
    expect(padded.upperBound).toBeCloseTo(10, 12)

    // The distinguishing property: a log pad is ratio-symmetric where a linear
    // pad on the same range is not.
    const linear = paddedRange({ lowerBound: 0.01, upperBound: 1 }, 0.5, 'linear')
    expect(linear.lowerBound).toBeCloseTo(-0.485, 12)
    expect(linear.upperBound).toBeCloseTo(1.495, 12)
  })

  it('declines to touch a non-positive range on a log layer, or a zero pad', () => {
    const range: GridValueRange = { lowerBound: -1, upperBound: 5 }
    expect(paddedRange(range, 0.2, 'log')).toEqual(range)
    expect(paddedRange(range, 0, 'linear')).toEqual(range)
  })
})

// ---------------------------------------------------------------------------
// 5. Dispatch
// ---------------------------------------------------------------------------

describe('stretchDisplayRange', () => {
  const dataset = makeRampDataset(16, 16)
  const viewport = boundsOf(dataset)

  it('covers every case the Swift dispatch covers', () => {
    expect(
      stretchDisplayRange({ mode: 'fixed' }, { dataset, viewport, scale: 'linear' }),
    ).toBeNull()

    const manualRange: GridValueRange = { lowerBound: 3, upperBound: 4 }
    const manual = stretchDisplayRange(
      { mode: 'manual', range: manualRange },
      { dataset, viewport, scale: 'linear' },
    )
    expect(manual).toEqual({ range: manualRange, tier: 'exact', sampleCount: 0 })

    const extremes = stretchDisplayRange(
      { mode: 'viewport-minmax', pad: 0 },
      { dataset, viewport, scale: 'linear' },
    )
    expect(extremes!.range.lowerBound).toBeCloseTo(0, 9)
    expect(extremes!.range.upperBound).toBeCloseTo(255, 9)

    const percentile = stretchDisplayRange(defaultViewportPercentileStretch(), {
      dataset,
      viewport,
      scale: 'linear',
    })
    expect(percentile!.range.lowerBound).toBeGreaterThan(extremes!.range.lowerBound)
    expect(percentile!.range.upperBound).toBeLessThan(extremes!.range.upperBound)

    // A null viewport falls back to the grid's own bounds.
    const noViewport = stretchDisplayRange(
      { mode: 'viewport-minmax', pad: 0 },
      { dataset, viewport: null, scale: 'linear' },
    )
    expect(noViewport!.range).toEqual(extremes!.range)
  })

  it('reads the whole date regardless of viewport for date-percentile', () => {
    const elsewhere: GridBBox = [20, 0, 21, 1]
    expect(sampleGridValues(dataset, elsewhere)).toBeNull()

    const wholeDate = stretchDisplayRange(
      { mode: 'date-percentile', lo: 0, hi: 100 },
      { dataset, viewport: elsewhere, scale: 'linear' },
    )
    expect(wholeDate!.range.lowerBound).toBeCloseTo(0, 9)
    expect(wholeDate!.range.upperBound).toBeCloseTo(255, 9)
  })

  /**
   * The server-stats shortcut, and the reason it is a shortcut rather than a
   * behavior: narduk-data publishes no per-date percentile table on `/grid`
   * today, so a caller that supplies none gets exactly GeoGridKit's answer.
   */
  it('prefers a supplied date statistics table, and falls back when it is short', () => {
    const stats = [
      { percent: 2, value: 11 },
      { percent: 98, value: 88 },
    ]
    const fromStats = stretchDisplayRange(
      { mode: 'date-percentile', lo: 2, hi: 98 },
      { dataset, viewport: null, scale: 'linear', dateStatistics: stats },
    )
    expect(fromStats).toEqual({
      range: { lowerBound: 11, upperBound: 88 },
      tier: 'exact',
      sampleCount: 0,
    })

    // A table that does not carry both requested percentiles is not partially
    // used — the scan runs, because half a stretch is worse than none.
    const scanned = stretchDisplayRange(
      { mode: 'date-percentile', lo: 5, hi: 98 },
      { dataset, viewport: null, scale: 'linear', dateStatistics: stats },
    )
    expect(scanned!.sampleCount).toBe(16 * 16)
  })

  /**
   * A published table is someone else's output, so it can be wrong. An inverted
   * or zero-width pair is reported `insufficient` — the same answer a degenerate
   * scan gets — rather than handed to the renderer as a range that would blank
   * the layer on a bad row.
   */
  it('rejects an inverted or zero-width published pair', () => {
    for (const bad of [
      [
        { percent: 2, value: 90 },
        { percent: 98, value: 10 },
      ],
      [
        { percent: 2, value: 42 },
        { percent: 98, value: 42 },
      ],
    ]) {
      const result = stretchDisplayRange(
        { mode: 'date-percentile', lo: 2, hi: 98 },
        { dataset, viewport: null, scale: 'linear', dateStatistics: bad },
      )
      expect(result?.tier).toBe('insufficient')
    }
  })

  it('orders the two percentiles rather than trusting their names', () => {
    const swapped = stretchDisplayRange(
      { mode: 'viewport-percentile', lo: 98, hi: 2 },
      { dataset, viewport, scale: 'linear' },
    )
    const ordered = stretchDisplayRange(
      { mode: 'viewport-percentile', lo: 2, hi: 98 },
      { dataset, viewport, scale: 'linear' },
    )
    expect(swapped!.range).toEqual(ordered!.range)
  })

  /**
   * Asserted as the ratio-symmetry property rather than against a literal.
   *
   * A grid plane is `Float32Array`, so `0.01` is stored as `0.009999999776…`
   * and a literal expectation would be pinning float32 storage error to twelve
   * places rather than pinning the pad. The exact vectors live in the
   * `paddedRange` block above, where the inputs are float64 by construction.
   */
  it('pads a log layer in log space through the dispatch, not only in isolation', () => {
    const values = new Float32Array([0.01, 0.1, 1, 10])
    const logDataset = makeDataset(4, 1, 0, 0, 1, -1, values)
    const range = stretchDisplayRange(
      { mode: 'viewport-minmax', pad: 0.5 },
      { dataset: logDataset, viewport: null, scale: 'log' },
    )!.range
    const low = values[0]!
    const high = values[3]!
    const decades = Math.log(high / low)
    // 0.01…10 spans three decades; a 50% pad adds 1.5 decades on each side.
    expect(Math.log(low / range.lowerBound)).toBeCloseTo(decades * 0.5, 9)
    expect(Math.log(range.upperBound / high)).toBeCloseTo(decades * 0.5, 9)

    // The same pad, read linearly, would have put the floor below zero — which
    // is the whole reason the pad space follows the layer's scale.
    const linear = stretchDisplayRange(
      { mode: 'viewport-minmax', pad: 0.5 },
      { dataset: logDataset, viewport: null, scale: 'linear' },
    )!.range
    expect(linear.lowerBound).toBeLessThan(0)
    expect(range.lowerBound).toBeGreaterThan(0)
  })

  /**
   * The brief's named case: a percentile stretch, a pad, and a log layer at
   * once. Each is covered alone above; this is the one that catches a pad
   * applied to the *unpadded* percentile result, or applied in linear space on
   * the way through the percentile branch specifically.
   */
  it('pads a viewport-percentile result in log space on a log layer', () => {
    const values = new Float32Array([0.01, 0.02, 0.05, 0.1, 0.3, 0.8, 2, 5, 8, 10])
    const logDataset = makeDataset(10, 1, 0, 0, 1, -1, values)

    const unpadded = stretchDisplayRange(
      { mode: 'viewport-percentile', lo: 2, hi: 98 },
      { dataset: logDataset, viewport: null, scale: 'log' },
    )!.range
    const padded = stretchDisplayRange(
      { mode: 'viewport-percentile', lo: 2, hi: 98, pad: 0.25 },
      { dataset: logDataset, viewport: null, scale: 'log' },
    )!.range

    // The pad widened the percentile range, not the raw extremes.
    expect(padded.lowerBound).toBeLessThan(unpadded.lowerBound)
    expect(padded.upperBound).toBeGreaterThan(unpadded.upperBound)
    expect(padded.lowerBound).toBeGreaterThan(0)

    // …and it widened it ratio-symmetrically: 25% of the decade span each side.
    const decades = Math.log(unpadded.upperBound / unpadded.lowerBound)
    expect(Math.log(unpadded.lowerBound / padded.lowerBound)).toBeCloseTo(decades * 0.25, 9)
    expect(Math.log(padded.upperBound / unpadded.upperBound)).toBeCloseTo(decades * 0.25, 9)

    // A linear pad of the same fraction is a different, larger-at-the-bottom
    // answer — so this is not silently taking the linear branch.
    const linearPadded = stretchDisplayRange(
      { mode: 'viewport-percentile', lo: 2, hi: 98, pad: 0.25 },
      { dataset: logDataset, viewport: null, scale: 'linear' },
    )!.range
    expect(linearPadded.lowerBound).toBeLessThan(padded.lowerBound)
  })

  /**
   * A relocated plane must be *sampled* where it is *drawn*.
   *
   * `setScalarFrame`'s `bbox` option tells the renderer to place these cells
   * somewhere other than the header says. A stretch that kept reading the
   * header's `lon0`/`dx` would answer a perfectly plausible range computed from
   * the wrong cells, and the discrepancy grows without bound as the override
   * moves away from the header.
   */
  it('samples through an overriding bbox rather than the header geometry', () => {
    // Header places 10 cells at longitude 0…9; values are the column index.
    const values = new Float32Array(10)
    for (let i = 0; i < 10; i += 1) values[i] = i
    const relocated = makeDataset(10, 1, 0, 0, 1, -1, values)

    // The renderer is told the plane actually spans longitude 100…109.
    const bounds: GridBBox = [100, -1, 109, 1]
    const geometry = boundsSampleGeometry(bounds, 10, 1, 'cell-center', {
      lon0: 0,
      lat0: 0,
      dx: 1,
      dy: -1,
    })
    expect(geometry.lon0).toBe(100)
    expect(geometry.dx).toBe(1)

    // A viewport over the relocated half sees the cells that are drawn there…
    const viewport: GridBBox = [104.5, -1, 109, 1]
    expect(
      stretchDisplayRange(
        { mode: 'viewport-minmax', pad: 0 },
        { dataset: relocated, viewport, scale: 'linear', geometry },
      )!.range,
    ).toEqual({ lowerBound: 5, upperBound: 9 })

    // …where reading the header's geometry finds nothing there at all, which is
    // how the old behavior silently fell back to a whole-grid range instead.
    expect(
      stretchDisplayRange(
        { mode: 'viewport-minmax', pad: 0 },
        { dataset: relocated, viewport, scale: 'linear' },
      ),
    ).toBeNull()
  })

  it('derives a cell-edge geometry half a step in from the edge', () => {
    // 4 cells covering 0…4 by their outer edges: step 1, first center at 0.5.
    const edge = boundsSampleGeometry([0, 0, 4, 4], 4, 4, 'cell-edge', {
      lon0: 0,
      lat0: 0,
      dx: 1,
      dy: -1,
    })
    expect(edge.lon0).toBe(0.5)
    expect(edge.dx).toBe(1)
    // Rows run north to south, so the first center is half a step *below* north.
    expect(edge.lat0).toBe(3.5)
    expect(edge.dy).toBe(-1)

    // The same rectangle read as cell centers spans 3 gaps, not 4.
    const center = boundsSampleGeometry([0, 0, 4, 4], 4, 4, 'cell-center', {
      lon0: 0,
      lat0: 0,
      dx: 1,
      dy: -1,
    })
    expect(center.lon0).toBe(0)
    expect(center.dx).toBeCloseTo(4 / 3, 12)
  })

  it('keeps the header step on a single-cell axis, which implies none', () => {
    const fallback = { lon0: -95, lat0: 30, dx: 0.25, dy: -0.25 }
    const single = boundsSampleGeometry([-95, 30, -95, 30], 1, 1, 'cell-center', fallback)
    expect(single).toEqual(fallback)
  })

  it('reads the requested plane, not always the first', () => {
    const first = new Float32Array([1, 2, 3, 4])
    const second = new Float32Array([100, 200, 300, 400])
    const multi = makeDataset(4, 1, 0, 0, 1, -1, first)
    multi.header.planeCount = 2
    multi.header.variables = ['a', 'b']
    multi.planes.push(second)
    multi.masks.push(new Uint8Array([1, 1, 1, 1]))

    expect(gridExtremes(multi, boundsOf(multi), 1)?.range).toEqual({
      lowerBound: 100,
      upperBound: 400,
    })
  })
})

describe('viewportBBox', () => {
  it('is the rectangle the viewport itself covers', () => {
    expect(
      viewportBBox({
        center: { latitude: 28.5, longitude: -91.5 },
        span: { latitudeDelta: 3, longitudeDelta: 7 },
      }),
    ).toEqual([-95, 27, -88, 30])
  })
})

// ---------------------------------------------------------------------------
// 6. The controller
// ---------------------------------------------------------------------------

/**
 * A 101-column ramp: value == column index, one degree per column starting at
 * longitude 0. A viewport of `[0, w]` therefore has a display range of exactly
 * `0…w`, which makes the hysteresis arithmetic legible in the test instead of
 * being an artifact of some grid's statistics.
 *
 * Its whole-grid range is `0…100`, which is the baseline every controller test
 * below starts from — `setSource` with no viewport reads the grid's own bounds,
 * exactly as Swift's `viewport ?? dataset.header.bounds` does.
 */
function makeRulerDataset(): GridScalarDataset {
  const values = new Float32Array(101)
  for (let i = 0; i < 101; i += 1) values[i] = i
  return makeDataset(101, 1, 0, 0, 1, -1, values)
}

interface Emission {
  range: GridValueRange
  meta: GridDisplayRangeMeta
}

function makeController(stretch: GridRangeStretch): {
  controller: GridStretchController
  emissions: Emission[]
} {
  const controller = new GridStretchController({
    valueRange: { lowerBound: -1000, upperBound: 1000 },
    scale: 'linear',
    stretch,
  })
  const emissions: Emission[] = []
  controller.onDisplayRangeChange((range, meta) => emissions.push({ range, meta }))
  controller.setSource({ dataset: makeRulerDataset() })
  return { controller, emissions }
}

const MINMAX: GridRangeStretch = { mode: 'viewport-minmax', pad: 0 }

describe('GridStretchController', () => {
  it('establishes its baseline from the grid when no viewport is set yet', () => {
    const { controller, emissions } = makeController(MINMAX)
    expect(emissions).toHaveLength(1)
    expect(emissions[0]!.meta.reason).toBe('source')
    expect(controller.currentDisplayRange()).toEqual({ lowerBound: 0, upperBound: 100 })
    expect(controller.currentResult()?.tier).toBe('exact')
    expect(controller.currentResult()?.sampleCount).toBe(101)
    controller.destroy()
  })

  it('debounces a viewport move by 250 ms', () => {
    vi.useFakeTimers()
    try {
      const { controller, emissions } = makeController(MINMAX)
      emissions.length = 0

      controller.setViewport([0, -1, 50, 1])
      expect(emissions).toHaveLength(0)
      vi.advanceTimersByTime(249)
      expect(emissions).toHaveLength(0)
      vi.advanceTimersByTime(1)
      expect(emissions).toHaveLength(1)
      expect(emissions[0]!.range).toEqual({ lowerBound: 0, upperBound: 50 })
      expect(emissions[0]!.meta.reason).toBe('viewport')
      controller.destroy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('coalesces a burst of viewport moves into one recompute', () => {
    vi.useFakeTimers()
    try {
      const { controller, emissions } = makeController(MINMAX)
      emissions.length = 0

      for (const east of [90, 80, 70, 50]) {
        controller.setViewport([0, -1, east, 1])
        vi.advanceTimersByTime(100)
      }
      expect(emissions).toHaveLength(0)
      vi.advanceTimersByTime(250)
      expect(emissions).toHaveLength(1)
      expect(emissions[0]!.range.upperBound).toBe(50)
      controller.destroy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('holds still for a 1% move and applies a 5% one', () => {
    vi.useFakeTimers()
    try {
      const { controller, emissions } = makeController(MINMAX)
      emissions.length = 0
      expect(controller.currentDisplayRange()).toEqual({ lowerBound: 0, upperBound: 100 })

      // Span is 100, so the threshold is 2. An endpoint moving by 1 is drift.
      controller.setViewport([0, -1, 99, 1])
      vi.advanceTimersByTime(250)
      expect(emissions).toHaveLength(0)
      expect(controller.currentDisplayRange()).toEqual({ lowerBound: 0, upperBound: 100 })

      // 5 is a change the operator can see.
      controller.setViewport([0, -1, 95, 1])
      vi.advanceTimersByTime(250)
      expect(emissions).toHaveLength(1)
      expect(controller.currentDisplayRange()).toEqual({ lowerBound: 0, upperBound: 95 })
      controller.destroy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not apply hysteresis to an explicit stretch change', () => {
    vi.useFakeTimers()
    try {
      const { controller, emissions } = makeController(MINMAX)
      emissions.length = 0

      // A 1-unit move: below the hysteresis threshold, and applied anyway,
      // because the operator asked for it rather than drifting into it.
      controller.setStretch({ mode: 'manual', range: { lowerBound: 0, upperBound: 99 } })
      expect(emissions).toHaveLength(1)
      expect(emissions[0]!.meta.reason).toBe('stretch')
      expect(controller.currentDisplayRange()).toEqual({ lowerBound: 0, upperBound: 99 })
      controller.destroy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('freezes while playing and thaws on pause', () => {
    vi.useFakeTimers()
    try {
      const { controller, emissions } = makeController(MINMAX)
      emissions.length = 0

      controller.setPlaying(true)
      controller.setViewport([0, -1, 50, 1])
      vi.advanceTimersByTime(5_000)
      expect(emissions).toHaveLength(0)
      expect(controller.currentDisplayRange()).toEqual({ lowerBound: 0, upperBound: 100 })

      controller.setPlaying(false)
      expect(emissions).toHaveLength(1)
      expect(emissions[0]!.meta.reason).toBe('playback')
      expect(controller.currentDisplayRange()).toEqual({ lowerBound: 0, upperBound: 50 })
      controller.destroy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('defers an explicit setStretch made during playback until the pause', () => {
    vi.useFakeTimers()
    try {
      const { controller, emissions } = makeController(MINMAX)
      emissions.length = 0

      controller.setPlaying(true)
      controller.setStretch({ mode: 'manual', range: { lowerBound: 2, upperBound: 3 } })
      vi.advanceTimersByTime(5_000)
      expect(emissions).toHaveLength(0)
      expect(controller.currentDisplayRange()).toEqual({ lowerBound: 0, upperBound: 100 })

      controller.setPlaying(false)
      expect(emissions).toHaveLength(1)
      expect(emissions[0]!.meta.reason).toBe('stretch')
      expect(controller.currentDisplayRange()).toEqual({ lowerBound: 2, upperBound: 3 })
      controller.destroy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('applies the operator request rather than a pan when both were made mid-playback', () => {
    vi.useFakeTimers()
    try {
      const { controller, emissions } = makeController(MINMAX)
      emissions.length = 0

      controller.setPlaying(true)
      controller.setViewport([0, -1, 50, 1])
      controller.setStretch({ mode: 'manual', range: { lowerBound: 7, upperBound: 8 } })
      controller.setPlaying(false)

      expect(emissions).toHaveLength(1)
      expect(controller.currentDisplayRange()).toEqual({ lowerBound: 7, upperBound: 8 })
      controller.destroy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('reports the wire domain as the fallback when a stretch is unusable', () => {
    const controller = new GridStretchController({
      valueRange: { lowerBound: -1000, upperBound: 1000 },
      scale: 'linear',
      stretch: MINMAX,
    })
    const emissions: Emission[] = []
    controller.onDisplayRangeChange((range, meta) => emissions.push({ range, meta }))

    // A flat grid: min == max, so the tier is `insufficient` and there is no
    // usable stretch to apply.
    controller.setSource({ dataset: makeDataset(3, 3, 0, 1, 1, -1, new Float32Array(9).fill(7)) })
    expect(controller.currentDisplayRange()).toBeNull()
    expect(controller.effectiveDisplayRange()).toEqual({ lowerBound: -1000, upperBound: 1000 })
    expect(emissions).toHaveLength(0)

    controller.setSource({ dataset: makeRulerDataset() })
    expect(emissions).toHaveLength(1)
    expect(emissions[0]!.meta.fallback).toBe(false)

    // …and back to the flat grid: the fallback is announced, not silent.
    controller.setSource({ dataset: makeDataset(3, 3, 0, 1, 1, -1, new Float32Array(9).fill(7)) })
    expect(emissions).toHaveLength(2)
    expect(emissions[1]!.meta.fallback).toBe(true)
    expect(emissions[1]!.range).toEqual({ lowerBound: -1000, upperBound: 1000 })
    controller.destroy()
  })

  it('never emits for a fixed stretch, whatever the viewport does', () => {
    vi.useFakeTimers()
    try {
      const { controller, emissions } = makeController({ mode: 'fixed' })
      controller.setViewport([0, -1, 100, 1])
      vi.advanceTimersByTime(1_000)
      expect(emissions).toHaveLength(0)
      expect(controller.currentDisplayRange()).toBeNull()
      controller.destroy()
    } finally {
      vi.useRealTimers()
    }
  })

  /**
   * Reviewer case B: a pan that has not finished debouncing when playback starts
   * must survive the freeze. Dropping the timer without recording the request
   * lost it forever, so pausing afterwards recomputed nothing — the freeze
   * contract promises deferral, not deletion.
   */
  it('defers a still-debouncing pan across a freeze instead of dropping it', () => {
    vi.useFakeTimers()
    try {
      const { controller, emissions } = makeController(MINMAX)
      emissions.length = 0

      controller.setViewport([0, -1, 50, 1])
      vi.advanceTimersByTime(100) // inside the 250 ms window
      controller.setPlaying(true)
      vi.advanceTimersByTime(5_000)
      expect(emissions).toHaveLength(0)

      controller.setPlaying(false)
      expect(emissions).toHaveLength(1)
      expect(controller.currentDisplayRange()).toEqual({ lowerBound: 0, upperBound: 50 })
      controller.destroy()
    } finally {
      vi.useRealTimers()
    }
  })

  /**
   * Reviewer case C: the same, with the pan and the freeze in the same tick, so
   * no timer time elapses at all before the freeze.
   */
  it('defers a pan frozen in the same tick it was requested', () => {
    vi.useFakeTimers()
    try {
      const { controller, emissions } = makeController(MINMAX)
      emissions.length = 0

      controller.setViewport([0, -1, 40, 1])
      controller.setPlaying(true)
      vi.advanceTimersByTime(5_000)
      expect(emissions).toHaveLength(0)

      controller.setPlaying(false)
      expect(emissions).toHaveLength(1)
      expect(emissions[0]!.meta.reason).toBe('playback')
      expect(controller.currentDisplayRange()).toEqual({ lowerBound: 0, upperBound: 40 })
      controller.destroy()
    } finally {
      vi.useRealTimers()
    }
  })

  /**
   * The hysteresis boundary, stated as the contract states it: *more than* 2%.
   *
   * A move of exactly the threshold does not apply. This is the test that fails
   * if `>` is ever relaxed to `>=` — without it the 2% figure is decorative,
   * because every other hysteresis test sits comfortably on one side or the
   * other of it.
   */
  it('treats a move of exactly the threshold as drift, not as a change', () => {
    vi.useFakeTimers()
    try {
      const { controller, emissions } = makeController(MINMAX)
      emissions.length = 0
      // Baseline 0…100: span 100, threshold exactly 2.
      controller.setViewport([0, -1, 98, 1])
      vi.advanceTimersByTime(250)
      expect(emissions).toHaveLength(0)
      expect(controller.currentDisplayRange()).toEqual({ lowerBound: 0, upperBound: 100 })

      // One unit past the threshold does apply.
      controller.setViewport([0, -1, 97, 1])
      vi.advanceTimersByTime(250)
      expect(emissions).toHaveLength(1)
      expect(controller.currentDisplayRange()).toEqual({ lowerBound: 0, upperBound: 97 })
      controller.destroy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('applies a manual stretch before any frame has arrived', () => {
    const controller = new GridStretchController({
      valueRange: { lowerBound: 0, upperBound: 1 },
      scale: 'linear',
    })
    const emissions: Emission[] = []
    controller.onDisplayRangeChange((range, meta) => emissions.push({ range, meta }))
    // No `setSource` at all: `manual` needs no data, and GeoGridKit's dispatch
    // ignores the dataset for that case.
    controller.setStretch({ mode: 'manual', range: { lowerBound: 4, upperBound: 9 } })
    expect(emissions).toHaveLength(1)
    expect(controller.currentDisplayRange()).toEqual({ lowerBound: 4, upperBound: 9 })
    controller.destroy()
  })

  it('forgets its applied range on destroy', () => {
    const { controller } = makeController(MINMAX)
    expect(controller.currentDisplayRange()).not.toBeNull()
    controller.destroy()
    expect(controller.currentDisplayRange()).toBeNull()
    expect(controller.currentResult()).toBeNull()
  })

  it('stops recomputing once destroyed', () => {
    vi.useFakeTimers()
    try {
      const { controller, emissions } = makeController(MINMAX)
      emissions.length = 0
      controller.setViewport([0, -1, 50, 1])
      controller.destroy()
      vi.advanceTimersByTime(1_000)
      expect(emissions).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('re-runs when the layer scale changes, because the pad space changed with it', () => {
    const controller = new GridStretchController({
      valueRange: { lowerBound: 0.001, upperBound: 100 },
      scale: 'linear',
      stretch: { mode: 'viewport-minmax', pad: 0.5 },
    })
    const emissions: Emission[] = []
    controller.onDisplayRangeChange((range, meta) => emissions.push({ range, meta }))
    controller.setSource({
      dataset: makeDataset(4, 1, 0, 0, 1, -1, new Float32Array([0.01, 0.1, 1, 10])),
    })
    expect(emissions).toHaveLength(1)
    const linear = emissions[0]!.range
    // A 50% linear pad on 0.01…10 reaches below zero, which is unrenderable on
    // a log ramp — the exact thing the scale-aware pad exists to avoid.
    expect(linear.lowerBound).toBeLessThan(0)

    controller.setStyle({ lowerBound: 0.001, upperBound: 100 }, 'log')
    expect(emissions).toHaveLength(2)
    expect(emissions[1]!.meta.reason).toBe('style')
    const log = emissions[1]!.range
    expect(log.lowerBound).toBeGreaterThan(0)
    // Ratio-symmetric: 1.5 decades added on each side of a three-decade span.
    expect(Math.log(0.01 / log.lowerBound)).toBeCloseTo(Math.log(10 / 0.01) * 0.5, 6)
    controller.destroy()
  })
})
