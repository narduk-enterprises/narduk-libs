/**
 * NeAbsent's public shapes and its one piece of wording.
 *
 * Separate from the SFC for the same reason `ne-meter-types.ts` is: a consumer
 * that only wants the prop type, or a test that wants the accessible name,
 * should not have to import a component to get it.
 */
import { NE_UNREPORTED_TEXT } from '../utils/unreported'

/**
 * `cell`: a small hatched mark with no visible words, for a table cell, a card
 * field or a KPI value. `block`: a hatched box that names the field in words,
 * for a panel or a chart well with nothing to draw.
 */
export type NeAbsentVariant = 'cell' | 'block'

export interface NeAbsentProps {
  /**
   * The field that has no value, e.g. `90-day uptime`. It is the mark's
   * accessible name (`90-day uptime: not reported`) and its hover title, and
   * for `block` it is also the visible text. Optional, but a mark with no name
   * is announced as only `Not reported`, so set it unless the surrounding row
   * already says which field it is.
   */
  label?: string
  /** `cell` (default) or `block`; see `NeAbsentVariant`. */
  variant?: NeAbsentVariant
  /**
   * `block` only: the word after the label. Defaults to `NE_UNREPORTED_TEXT`.
   * `null` drops it, leaving the label alone.
   */
  word?: string | null
}

/**
 * The accessible name of an absent value: the field's label and the suite's
 * one word for "nothing produced this". Never blank, never `0`.
 *
 * ```ts
 * absentName('Uptime') // 'Uptime: not reported'
 * absentName()         // 'Not reported'
 * ```
 */
export function absentName(label?: string | null): string {
  return label ? `${label}: ${NE_UNREPORTED_TEXT.toLowerCase()}` : NE_UNREPORTED_TEXT
}
