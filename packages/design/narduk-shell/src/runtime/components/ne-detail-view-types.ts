/**
 * `NeDetailView`'s caller-built shapes (narduk-libs#264).
 *
 * Kept in a plain module so the package root can re-export them as type-only
 * exports without compiling the SFC.
 */
import type { NeDateInput } from '../../format'

/**
 * Which `./format` function prints the value. `relative` is deliberately
 * absent: it needs a caller-supplied `now`, and a detail panel that read the
 * ambient clock would fail hydration. Format the relative string at the call
 * site and pass it as a pre-formatted value with no `format`.
 */
export type NeDetailFormat =
  'compact' | 'date' | 'datetime' | 'duration' | 'money' | 'number' | 'percent' | 'quantity'

export interface NeDetailItem {
  /**
   * ISO-4217 code. Required when `format` is `'money'` — there is no house
   * currency. Ignored for every other format.
   */
  currency?: string
  /**
   * Per-row override of the panel's `unavailableMessage` (and of the
   * formatter empty placeholder). Use it for a field whose missing reading
   * is a different sentence from the panel default.
   */
  empty?: string
  /**
   * Which `./format` function prints a present value. Omit it for a string
   * that is already formatted, or for a number that should go through
   * `formatNumber`.
   */
  format?: NeDetailFormat
  /** The field's name. Always visible, so the row never depends on colour. */
  label: string
  /**
   * IANA zone for `date` / `datetime`. Falls back to the panel's `timeZone`.
   * There is no host-zone default: a missing zone is treated as unavailable
   * rather than as "whatever the Worker and the browser disagree on".
   */
  timeZone?: string
  /**
   * Sanctioned `Intl` unit or any other string (`cfs`, `ft`). Required for
   * `format: 'quantity'`. Ignored otherwise.
   */
  unit?: string
  /**
   * The reading. `null` / `undefined` / a non-finite number render the
   * unavailable message rather than `0` or an empty cell — that is the
   * unknown-is-not-zero class this panel exists to keep off the page.
   */
  value?: NeDateInput | number | string | null
}

export interface NeDetailViewProps {
  items: readonly NeDetailItem[]
  /**
   * IANA zone used by every `date` / `datetime` row that does not set its
   * own. Required in spirit for those formats; omit it only when no row
   * asks for a date.
   */
  timeZone?: string
  /**
   * What a missing reading prints. Defaults to the `./format` empty
   * placeholder (`—`). The plan's riverstatus trust panel is
   * `unavailable-message="No reading"`.
   */
  unavailableMessage?: string
}
