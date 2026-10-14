/**
 * NeMeter's public shapes and its one piece of arithmetic (narduk-libs#601).
 *
 * Separate from the SFC for the same reason `ne-search-input-types.ts` is: a
 * consumer that only wants the prop type should not have to import a component
 * to get it, and the reading below is a pure function that a unit test can
 * pin without mounting anything.
 */
import { isUnreported } from '../utils/unreported'

/**
 * `block`: the label and the figure on one line, the track full-width under
 * them — a quota panel, a settings page. `inline`: label, track and figure in
 * one row — a table cell, a list row, beside another control.
 */
export type NeMeterVariant = 'block' | 'inline'

/**
 * A segment's colour. `accent` (default) is the suite's data ink; `ok`, `warn`,
 * `error` and `info` read Nuxt UI's semantic colours; `neutral` is a quiet
 * grey. Colour is never the only cue: a segment is also separated from its
 * neighbours by a surface-coloured rule and named in the meter's accessible
 * name, so a reader who cannot tell the colours apart loses nothing.
 */
export type NeMeterTone = 'accent' | 'ok' | 'warn' | 'error' | 'info' | 'neutral'

/** One part of a multi-segment meter (`NeMeterProps.segments`). */
export interface NeMeterSegment {
  /**
   * What the part is, e.g. `Used`. Optional, but it is the part's only name in
   * the accessible text and its hover title, so set it.
   */
  label?: string
  /** Colour of the part. Default `accent`. */
  tone?: NeMeterTone
  /**
   * The part's quantity, in the same unit as `max`. `null`, `undefined` or a
   * non-finite number means nothing produced it: the part draws nothing and
   * is named "not reported" — it is not counted as `0`.
   */
  value: number | null | undefined
}

export interface NeMeterProps {
  /**
   * The meter's name, shown beside the track and used as its accessible
   * name. Optional, but a meter without one is named by its own reading, so
   * set it unless the surrounding row already says what is being measured.
   */
  label?: string
  /**
   * The ceiling `value` is read against, e.g. a rate-limit budget. A `max` of
   * zero or less (or one that is not finite) is a ceiling with no room: a
   * reported `0` renders an empty track, anything above it a full one.
   */
  max: number
  /**
   * Multi-segment mode: the track is filled by several consecutive parts that
   * together read against `max`, e.g. used, cached and free space. When given,
   * `value` is ignored and the figure is the sum of the reported parts.
   * Geometry is clamped so the parts never exceed the track; each part's real
   * value is still named in the accessible text. If no part is reported (or the
   * array is empty) the whole meter takes the unreported treatment, never an
   * empty bar. A reported part sits beside an unreported one without
   * pretending to know it: the unreported part draws nothing and is named.
   */
  segments?: readonly NeMeterSegment[]
  /**
   * The measured quantity. `null` or `undefined` — or a number that is not
   * finite — means nothing produced a figure, and renders the unreported
   * treatment (the `--ne-hatch` track and an em-dash), never an empty bar.
   * Geometry is clamped to `[0, max]`; the figure always shows the real value.
   */
  value?: number | null
  variant?: NeMeterVariant
}

/** What the meter can say about `value` against `max`. */
export type NeMeterReading =
  | {
      reported: true
      /** `max` if it has room, else `0`. What `aria-valuemax` reads. */
      ceiling: number
      /** `value` clamped to `[0, ceiling]`. What `aria-valuenow` reads. */
      now: number
      /** How much of the track is filled, `0`–`1`. */
      fraction: number
    }
  | {
      reported: false
      ceiling: number
      now: null
      fraction: null
    }

/**
 * Read `value` against `max`. The only place the meter's geometry is decided.
 *
 * ```ts
 * readMeter(4200, 5000) // { reported: true, now: 4200, ceiling: 5000, fraction: 0.84 }
 * readMeter(6000, 5000) // clamped: now 5000, fraction 1
 * readMeter(null, 5000) // { reported: false, … } — hatched, not empty
 * readMeter(3, 0)       // no room: fraction 1; readMeter(0, 0) is fraction 0
 * ```
 */
export function readMeter(value: number | null | undefined, max: number): NeMeterReading {
  const ceiling = Number.isFinite(max) && max > 0 ? max : 0
  if (isUnreported(value) || typeof value !== 'number') {
    return { reported: false, ceiling, now: null, fraction: null }
  }
  const now = Math.min(Math.max(value, 0), ceiling)
  const fraction = ceiling > 0 ? now / ceiling : value > 0 ? 1 : 0
  return { reported: true, ceiling, now, fraction }
}

/** One segment as drawn: its real value, and its clamped place on the track. */
export interface NeMeterSegmentReading {
  /** How much of the track it fills, `0`–`1`. `0` for an unreported part. */
  fraction: number
  label: string | undefined
  /** `false` when nothing produced this part's value. */
  reported: boolean
  tone: NeMeterTone
  /** The part's real, unclamped value; `null` when unreported. */
  value: number | null
}

/** What a segmented meter can say about its parts against `max`. */
export interface NeMeterSegmentsReading {
  /** `max` if it has room, else `0`. */
  ceiling: number
  /** `true` when at least one part is reported. */
  reported: boolean
  segments: NeMeterSegmentReading[]
  /** Sum of the reported parts' real values; `null` when none is reported. */
  total: number | null
}

/**
 * Read a list of parts against `max`. The only place a segmented meter's
 * geometry is decided.
 *
 * Parts fill the track in order. Each is clamped to what is left of the
 * ceiling, so an overrun shows as a full track and never spills over; the sum
 * in `total` is the real figure. A part that is not reported fills nothing and
 * does not move its neighbours.
 *
 * ```ts
 * readMeterSegments([{ value: 40 }, { value: 20 }], 100)
 * // total 60, fractions 0.4 and 0.2
 * readMeterSegments([{ value: 80 }, { value: 50 }], 100)
 * // total 130, fractions 0.8 and 0.2 (clamped)
 * readMeterSegments([{ value: null }], 100) // { reported: false, … }
 * ```
 */
export function readMeterSegments(
  segments: readonly NeMeterSegment[],
  max: number,
): NeMeterSegmentsReading {
  const ceiling = Number.isFinite(max) && max > 0 ? max : 0
  const parts: NeMeterSegmentReading[] = []
  let used = 0
  let total: number | null = null
  for (const segment of segments) {
    const tone = segment.tone ?? 'accent'
    const { label, value } = segment
    if (isUnreported(value) || typeof value !== 'number') {
      parts.push({ fraction: 0, label, reported: false, tone, value: null })
      continue
    }
    total = (total ?? 0) + value
    const want = Math.max(value, 0)
    let fraction: number
    if (ceiling > 0) {
      const take = Math.max(0, Math.min(want, ceiling - used))
      used += take
      fraction = take / ceiling
    } else {
      // No room at all: the first positive part reads as a full track.
      fraction = used === 0 && want > 0 ? 1 : 0
      used += fraction
    }
    parts.push({ fraction, label, reported: true, tone, value })
  }
  return { ceiling, reported: total !== null, segments: parts, total }
}
