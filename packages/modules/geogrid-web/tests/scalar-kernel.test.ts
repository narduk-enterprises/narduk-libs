import { describe, expect, it } from 'vitest'

import { coastalFeather, sampleScalarBilinearSoft, texelPositionFromUv } from '../src/core/math.js'

/**
 * The kernel is a literal port of GeoGridKit's `sampleScalarBilinearSoft` and
 * `sampleScalarBilinearCoastal` (`Sources/GeoGridRender/MetalGridRenderer.swift`).
 * These cases pin the properties that port turns on: which neighbors
 * contribute, that the surviving weights are renormalized rather than
 * back-filled, and how each mode turns the leftovers into coverage.
 */

/** A 3×3 grid with a hole at the center. */
const HOLE_VALUES = [1, 2, 3, 4, 999, 6, 7, 8, 9]
const HOLE_MASK = [1, 1, 1, 1, 0, 1, 1, 1, 1]

const FULL_VALUES = [0, 10, 20, 30]
const FULL_MASK = [1, 1, 1, 1]

describe('sampleScalarBilinearSoft — interior', () => {
  it('reproduces a plain bilinear mix where every neighbor is finite', () => {
    // 2×2 grid, sample dead center: the unweighted mean of all four.
    const sample = sampleScalarBilinearSoft(FULL_VALUES, FULL_MASK, 2, 2, 0.5, 0.5)
    expect(sample.value).toBeCloseTo(15, 12)
    expect(sample.coverage).toBe(1)
    expect(sample.weight).toBeCloseTo(1, 12)
  })

  it('lands exactly on a cell value at an integer position', () => {
    const sample = sampleScalarBilinearSoft(FULL_VALUES, FULL_MASK, 2, 2, 1, 1)
    expect(sample.value).toBe(30)
    expect(sample.coverage).toBe(1)
  })

  it('weights the two ends of an edge linearly', () => {
    const sample = sampleScalarBilinearSoft(FULL_VALUES, FULL_MASK, 2, 2, 0.25, 0)
    expect(sample.value).toBeCloseTo(2.5, 12)
  })
})

describe('sampleScalarBilinearSoft — edges clamp', () => {
  it('clamps a position past the last cell center rather than wrapping', () => {
    const beyond = sampleScalarBilinearSoft(FULL_VALUES, FULL_MASK, 2, 2, 5, 5)
    expect(beyond.value).toBe(30)
    expect(beyond.coverage).toBe(1)
  })

  it('clamps a negative position to the first cell', () => {
    const before = sampleScalarBilinearSoft(FULL_VALUES, FULL_MASK, 2, 2, -3, -3)
    expect(before.value).toBe(0)
    expect(before.coverage).toBe(1)
  })

  it('handles a single-cell axis instead of bailing the way Metal does', () => {
    // GeoGridKit returns zero coverage for width <= 1; a 1×N /grid response is
    // legal here, so the one cell it has takes all the weight.
    const sample = sampleScalarBilinearSoft([7, 9], [1, 1], 1, 2, 0, 0.5)
    expect(sample.value).toBeCloseTo(8, 12)
    expect(sample.coverage).toBe(1)
  })
})

describe('sampleScalarBilinearSoft — holes', () => {
  it('renormalizes over the finite neighbors instead of substituting a zero', () => {
    // Centered between cells 0,1,3,4 of the 3×3; cell 4 is the hole. The three
    // survivors carry weight 0.25 each, renormalized to 1/3 apiece.
    const sample = sampleScalarBilinearSoft(HOLE_VALUES, HOLE_MASK, 3, 3, 0.5, 0.5)
    expect(sample.value).toBeCloseTo((1 + 2 + 4) / 3, 12)
    expect(sample.weight).toBeCloseTo(0.75, 12)
    // Had the missing cell been treated as a zero, the mean would drop to 1.75.
    expect(sample.value).toBeGreaterThan(2)
  })

  it('never reads the value under a zero mask', () => {
    // 999 sits under the hole; a kernel that read it would show up immediately.
    const sample = sampleScalarBilinearSoft(HOLE_VALUES, HOLE_MASK, 3, 3, 0.9, 0.9)
    expect(sample.value).toBeLessThan(10)
  })

  it('tolerates a NaN under a zero mask without poisoning the sum', () => {
    const values = [1, 2, 4, Number.NaN]
    const sample = sampleScalarBilinearSoft(values, [1, 1, 1, 0], 2, 2, 0.5, 0.5)
    expect(Number.isFinite(sample.value)).toBe(true)
    expect(sample.value).toBeCloseTo((1 + 2 + 4) / 3, 12)
  })

  it('reports nothing at all when every contributing neighbor is missing', () => {
    const sample = sampleScalarBilinearSoft([1, 2, 3, 4], [0, 0, 0, 0], 2, 2, 0.5, 0.5)
    expect(sample.coverage).toBe(0)
    expect(sample.weight).toBe(0)
    expect(sample.value).toBe(0)
  })
})

describe('soft versus coastal coverage', () => {
  it('soft is binary: any missing contributor drops the pixel', () => {
    const sample = sampleScalarBilinearSoft(HOLE_VALUES, HOLE_MASK, 3, 3, 0.5, 0.5, 'soft')
    expect(sample.coverage).toBe(0)
    // The value is still computed — the mode only decides whether it is drawn.
    expect(sample.value).toBeCloseTo((1 + 2 + 4) / 3, 12)
  })

  it('coastal reports the surviving weight sum, so the edge can feather', () => {
    const sample = sampleScalarBilinearSoft(HOLE_VALUES, HOLE_MASK, 3, 3, 0.5, 0.5, 'coastal')
    expect(sample.coverage).toBeCloseTo(0.75, 12)
  })

  it('agrees with soft wherever the neighborhood is whole', () => {
    const soft = sampleScalarBilinearSoft(FULL_VALUES, FULL_MASK, 2, 2, 0.5, 0.5, 'soft')
    const coastal = sampleScalarBilinearSoft(FULL_VALUES, FULL_MASK, 2, 2, 0.5, 0.5, 'coastal')
    expect(coastal.coverage).toBeCloseTo(soft.coverage, 12)
    expect(coastal.value).toBe(soft.value)
  })

  it('a zero-weight missing neighbor does not suppress a soft sample', () => {
    // At fx = fy = 0 only the top-left corner has weight, so the three missing
    // neighbors around it are irrelevant. The test is on weight, not presence.
    const sample = sampleScalarBilinearSoft([5, 0, 0, 0], [1, 0, 0, 0], 2, 2, 0, 0, 'soft')
    expect(sample.coverage).toBe(1)
    expect(sample.value).toBe(5)
  })
})

describe('coastalFeather', () => {
  it('is the smoothstep GeoGridKit applies to a coastal coverage', () => {
    expect(coastalFeather(0)).toBe(0)
    expect(coastalFeather(0.55)).toBe(1)
    expect(coastalFeather(1)).toBe(1)
    expect(coastalFeather(0.275)).toBeCloseTo(0.5, 12)
  })

  it('rises monotonically across the feather band', () => {
    let previous = -1
    for (let i = 0; i <= 20; i += 1) {
      const value = coastalFeather(i / 20)
      expect(value).toBeGreaterThanOrEqual(previous)
      previous = value
    }
  })
})

describe('texelPositionFromUv', () => {
  it('cell-edge puts uv 0 half a cell before the first center', () => {
    expect(texelPositionFromUv(0, 4, 'cell-edge')).toBe(-0.5)
    expect(texelPositionFromUv(1, 4, 'cell-edge')).toBe(3.5)
  })

  it('cell-center puts uv 0 exactly on the first center', () => {
    expect(texelPositionFromUv(0, 4, 'cell-center')).toBe(0)
    expect(texelPositionFromUv(1, 4, 'cell-center')).toBe(3)
  })

  it('separates the two anchors by exactly half a cell at the edges', () => {
    const edge = texelPositionFromUv(0, 10, 'cell-edge')
    const center = texelPositionFromUv(0, 10, 'cell-center')
    expect(center - edge).toBeCloseTo(0.5, 12)
  })
})
