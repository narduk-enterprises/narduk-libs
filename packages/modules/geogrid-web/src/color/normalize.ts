import type { GridScale, GridValueRange } from '../core/models.js'

/**
 * A value range accepted either as the structured GeoGridKit shape or as the
 * `[lo, hi]` tuple the catalog and grid headers put on the wire. Both are
 * common at call sites; normalizing them here keeps every caller from writing
 * the same two-line adapter.
 */
export type ValueRangeInput = GridValueRange | readonly [number, number]

export function toValueRangeTuple(range: ValueRangeInput): readonly [number, number] {
  return Array.isArray(range)
    ? (range as readonly [number, number])
    : [(range as GridValueRange).lowerBound, (range as GridValueRange).upperBound]
}

/**
 * Normalize a raw data value into the ramp's `0…1` position domain.
 *
 * This is a line-for-line port of `normalize_value` in narduk-data
 * `shared/colorramp.py`, which is the engine every published tile and grid was
 * colored with. The order of the checks is part of the contract:
 *
 * 1. a non-finite value is undefined **before** the range is inspected, so
 *    `NaN` with a degenerate range still answers `null` rather than throwing;
 * 2. an inverted or degenerate range (`lo >= hi`) is a producer bug and throws;
 * 3. on a log scale a non-positive value — or a non-positive range floor — is
 *    outside the sampling domain and answers `null`;
 * 4. everything else clamps into `[0, 1]`.
 *
 * `null` means "no color": the caller renders the pixel fully transparent. That
 * is a **deliberate behavior change** from the deprecated `core/math.ts`
 * `normalizeValue` + `core/color.ts` `sampleRamp` pair, which returned the
 * ramp's first stop for a non-positive sample on a log layer. Painting zero and
 * negative retrievals with the "clearest water" color is exactly the kind of
 * fabricated-data artifact the pipeline refuses to publish, so the canonical
 * engine drops them instead.
 *
 * Log normalization uses `log10` in the same operand order as the server. Any
 * other formulation (natural log, precomputed reciprocals) is algebraically
 * equal but not bit-equal, and this engine is pinned byte-exact against the
 * server's output in `tests/color-parity.test.ts`.
 *
 * The degenerate-range guard is `lo >= hi`, matching the server's
 * `if lo >= hi: raise` verbatim — **not** `!(lo < hi)`, which looks equivalent
 * but is not: comparisons with `NaN` are always `false` in both languages, so
 * `NaN >= hi` is `false` (no throw, matching the server) while `!(NaN < hi)` is
 * `true` (throws, a producer-visible divergence a degenerate `NaN` bound would
 * hit in practice — see `tests/color-parity.test.ts`).
 *
 * @throws RangeError when `lo >= hi`, matching the server's `ValueError`.
 */
export function normalizeValue(
  value: number,
  range: ValueRangeInput,
  scale: GridScale,
): number | null {
  if (!Number.isFinite(value)) return null

  const [lo, hi] = toValueRangeTuple(range)
  if (lo >= hi) {
    throw new RangeError('value range minimum must be less than maximum')
  }

  let raw: number
  if (scale === 'log') {
    if (value <= 0 || lo <= 0) return null
    raw = (Math.log10(value) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo))
  } else {
    raw = (value - lo) / (hi - lo)
  }

  // A degenerate-but-not-rejected range (a non-finite bound, e.g. `NaN`, which
  // the guard above lets through because `NaN >= hi` is `false`) can make `raw`
  // itself `NaN`. The server's clamp is `min(1.0, max(0.0, raw))` using
  // Python's builtin `max`/`min`, which keep the **first** argument when a
  // comparison against `NaN` is involved: `max(0.0, nan)` is `0.0`, and
  // `min(1.0, 0.0)` is `0.0`. `Math.max`/`Math.min` do not have that property —
  // either one propagates `NaN` if any operand is `NaN` — so a literal
  // `Math.min(1, Math.max(0, raw))` would answer `NaN` where the server answers
  // `0`. The two comparisons below reproduce the server's exact order-sensitive
  // semantics instead.
  const clampedLow = raw > 0 ? raw : 0
  return clampedLow < 1 ? clampedLow : 1
}

/**
 * Inverse of {@link normalizeValue}: a ramp position back into data space.
 *
 * Ports `ramp_stop_value` from the earth-data pipeline's `catalog.py`, which is
 * how a ramp's normalized stops become the `value` field of every catalog wire
 * stop. {@link normalizeWireStops} runs this in reverse, so the two must stay a
 * matched pair — that round trip is pinned by the `wireStopCases` fixture.
 *
 * Note the server's own guard: it only takes the log path when **both** ends of
 * the range are positive, and otherwise falls back to linear rather than
 * producing `NaN`.
 */
export function denormalizePosition(
  position: number,
  range: ValueRangeInput,
  scale: GridScale,
): number {
  const [lo, hi] = toValueRangeTuple(range)
  if (scale === 'log' && lo > 0 && hi > 0) {
    return 10 ** (Math.log10(lo) + position * (Math.log10(hi) - Math.log10(lo)))
  }
  return lo + position * (hi - lo)
}
