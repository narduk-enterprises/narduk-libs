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
