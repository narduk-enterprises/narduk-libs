import type { GridScale, RampStop } from '../core/models.js'
import { normalizeValue, toValueRangeTuple, type ValueRangeInput } from './normalize.js'

/** Eight-bit `[r, g, b, a]`, the one color representation this engine speaks. */
export type RGBA8 = [r: number, g: number, b: number, a: number]

/**
 * A catalog wire stop: 8-bit channels at a **raw data value**, not a position.
 *
 * This is the shape `catalog.py::ramp_descriptor` emits into `dataset.ramp` and
 * `dataset.rampSets`. `a` is optional only because older catalog snapshots
 * predate it; a missing alpha means opaque.
 */
export interface RampStopWire {
  value: number
  r: number
  g: number
  b: number
  a?: number
}

/** Fully transparent — "no color here", the server's `TRANSPARENT`. */
const TRANSPARENT: RGBA8 = [0, 0, 0, 0]

/**
 * Round half to even ("banker's rounding"), the rule Python's built-in `round`
 * applies and therefore the rule every published pixel was quantized with.
 *
 * `Math.round` is half **up** and disagrees on every exact `.5`, which is not
 * rare here: interpolating between two 8-bit channels at a segment midpoint
 * lands on `.5` whenever the two endpoints differ by an odd amount. That is a
 * one-count channel difference — invisible in isolation, and precisely the kind
 * of drift that makes a cross-language parity fixture worth having.
 *
 * The subtraction below is exact for every double in the 8-bit channel domain,
 * so the tie test is a true tie test rather than a tolerance.
 *
 * @throws RangeError on a non-finite input. Python's `round()` — the reference
 * this ports — raises on `NaN` (`ValueError`) and `Infinity`
 * (`OverflowError`); `Math.floor`/arithmetic on a non-finite double instead
 * quietly answers `NaN` or `Infinity`, which is not a rounding result at all.
 * Every internal call site (the channel interpolation in {@link sampleRamp01})
 * only ever passes an interpolated 8-bit channel value, which is always
 * finite, so this is purely a public-export contract fix.
 */
export function roundHalfToEven(value: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError('roundHalfToEven requires a finite number')
  }
  const lower = Math.floor(value)
  const fraction = value - lower
  if (fraction > 0.5) return lower + 1
  if (fraction < 0.5) return lower
  return lower % 2 === 0 ? lower : lower + 1
}

/**
 * Sample a ramp at an already-normalized position — the port of `interpolate`
 * in narduk-data `shared/colorramp.py`.
 *
 * Clamping is implicit and deliberately expressed the way the server expresses
 * it: a position at or below the first stop returns that stop's color verbatim,
 * and a position past the last segment returns the last stop's color verbatim.
 * Neither endpoint is re-rounded. This matters for a ramp whose stops do not
 * span the full unit interval — the CDL ramp's last stop sits at `254/255`, so
 * position `1.0` is "past the end" rather than "at the end".
 *
 * An empty ramp samples fully transparent rather than throwing, matching the
 * server, so a truecolor layer (which carries no stops) degrades quietly.
 */
export function sampleRamp01(stops: readonly RampStop[], position: number): RGBA8 {
  const first = stops[0]
  if (!first) return [...TRANSPARENT]
  if (position <= first.position) return [...first.rgba]

  for (let index = 1; index < stops.length; index += 1) {
    const left = stops[index - 1]!
    const right = stops[index]!
    if (position <= right.position) {
      const span = right.position - left.position
      const t = span <= 0 ? 0 : (position - left.position) / span
      return [
        roundHalfToEven(left.rgba[0] + (right.rgba[0] - left.rgba[0]) * t),
        roundHalfToEven(left.rgba[1] + (right.rgba[1] - left.rgba[1]) * t),
        roundHalfToEven(left.rgba[2] + (right.rgba[2] - left.rgba[2]) * t),
        roundHalfToEven(left.rgba[3] + (right.rgba[3] - left.rgba[3]) * t),
      ]
    }
  }

  return [...stops[stops.length - 1]!.rgba]
}

/**
 * Color a raw data value — normalize, then sample. Port of `ColorRamp.rgba`.
 *
 * A value outside the sampling domain (non-finite, or non-positive on a log
 * scale) is fully transparent. Note that transparent is not by itself a
 * "missing" marker: a ramp stop may legitimately be transparent, as the FRONT
 * ramp's first stop is. Consumers that must tell the two apart should call
 * {@link normalizeValue} and branch on `null`.
 */
export function sampleRampValue(
  stops: readonly RampStop[],
  value: number,
  range: ValueRangeInput,
  scale: GridScale,
): RGBA8 {
  const position = normalizeValue(value, range, scale)
  if (position === null) return [...TRANSPARENT]
  return sampleRamp01(stops, position)
}

/**
 * Bake a ramp into `count * 4` RGBA bytes, ready for `texImage2D` or a CPU
 * index lookup. Entry `i` samples position `i / (count - 1)`.
 *
 * `Uint8Array` rather than an array of tuples because every consumer of this is
 * a GPU upload or a per-pixel inner loop, and neither wants `count` heap
 * allocations. The deprecated `core/color.ts` `rampLut` returns `RGB[]` over a
 * *value* domain and is a different function; it stays for 0.1.x consumers.
 */
export function rampLut(stops: readonly RampStop[], count = 256): Uint8Array {
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new RangeError('ramp LUT count must be a positive integer')
  }
  const lut = new Uint8Array(count * 4)
  for (let index = 0; index < count; index += 1) {
    const position = count === 1 ? 0 : index / (count - 1)
    const rgba = sampleRamp01(stops, position)
    const offset = index * 4
    lut[offset] = rgba[0]
    lut[offset + 1] = rgba[1]
    lut[offset + 2] = rgba[2]
    lut[offset + 3] = rgba[3]
  }
  return lut
}

/**
 * How to read the `value` field of a set of wire stops.
 *
 * - `value` (the default) — raw data values, the documented catalog contract.
 * - `normalized` — the stops already carry `0…1` positions; pass them through.
 * - `auto` — decide from the layer's value range (see {@link normalizeWireStops}).
 */
export type WireStopDomain = 'value' | 'normalized' | 'auto'

export interface NormalizeWireStopsOptions {
  /** Defaults to `'value'`, the catalog's own contract. */
  domain?: WireStopDomain
}

/**
 * Convert catalog wire stops into the canonical normalized-position model.
 *
 * Catalog stops live in data-value space (a KD490 ramp's stops run `0.01…6.6`),
 * and a ramp sampled without this conversion puts every color in the wrong
 * place — on a log layer, catastrophically so. This is the same conversion
 * GeoGridKit's `CatalogClient.colorRamp(id:stops:dataset:)` performs before it
 * builds a LUT, and it is the exact inverse of the pipeline's
 * `catalog.py::ramp_stop_value`.
 *
 * A stop that falls outside the sampling domain (a non-positive value on a log
 * layer) normalizes to `0`, matching GeoGridKit's `?? 0.0`. Alpha is preserved;
 * GeoGridKit drops it because its `ColorStop` is RGB-only, but ramps like FRONT
 * carry meaning in alpha and this engine is the canonical one.
 *
 * ## On detecting already-normalized input
 *
 * The tempting heuristic — "every value is `<= 1`, so these must be positions"
 * — is wrong, and wrong in the direction that silently corrupts a real layer.
 * Plenty of published layers have a value range entirely inside `0…1`: a
 * chlorophyll layer ranged `0.01…0.5` on a log scale has every wire stop value
 * below `1.0` while every one of them is a data value. Treating those as
 * positions leaves the ramp compressed into its bottom decile.
 *
 * So `'auto'` decides from the **value range**, not from the stop values:
 * stops are read as positions only when they all lie within `0…1` *and* the
 * layer's own range does not, which is the one configuration where the data
 * -value reading is impossible. When the range itself lies within `0…1` the two
 * readings are indistinguishable from the numbers alone, and the producer
 * contract — data values — wins. (For a linear `0…1` range the question is
 * moot: normalization is the identity.)
 *
 * `'auto'` is opt-in. The default stays `'value'` because a reference engine
 * should not guess about the thing it is the reference for.
 *
 * @throws RangeError when the value range is degenerate (`lo >= hi`), unless
 * the stops are being passed through as already-normalized.
 */
export function normalizeWireStops(
  stops: readonly RampStopWire[],
  valueRange: ValueRangeInput,
  scale: GridScale,
  options: NormalizeWireStopsOptions = {},
): RampStop[] {
  const domain = options.domain ?? 'value'
  const alreadyNormalized =
    domain === 'normalized' || (domain === 'auto' && stopsLookNormalized(stops, valueRange))

  const converted = stops.map((stop): RampStop => {
    const position = alreadyNormalized
      ? Math.min(1, Math.max(0, stop.value))
      : (normalizeValue(stop.value, valueRange, scale) ?? 0)
    return {
      position,
      rgba: [stop.r, stop.g, stop.b, stop.a ?? 255],
    }
  })

  // A no-op for every real catalog ramp, whose stops arrive sorted and stay
  // sorted (both normalizations are monotonic). It only earns its keep against
  // a malformed producer, where an unsorted ramp otherwise samples as garbage.
  return converted.sort((left, right) => left.position - right.position)
}

function stopsLookNormalized(stops: readonly RampStopWire[], valueRange: ValueRangeInput): boolean {
  if (stops.length === 0) return false
  const [lo, hi] = toValueRangeTuple(valueRange)
  const rangeInsideUnitInterval = lo >= 0 && hi <= 1
  if (rangeInsideUnitInterval) return false
  return stops.every((stop) => stop.value >= 0 && stop.value <= 1)
}
