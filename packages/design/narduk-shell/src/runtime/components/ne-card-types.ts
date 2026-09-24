/**
 * `NeCard`'s caller-built shapes (narduk-libs#264).
 *
 * Kept in a plain module for the same reason as `ne-pager-types.ts`: the
 * package root re-exports these as type-only exports, and a plain `.ts` file
 * is what a non-Vue-aware tool can read a named interface out of.
 */
import type { NeStatusTone } from '../utils/status-map'

/** One measured row under the title — a label, a value, an optional unit. */
export interface NeCardStat {
  /** The row's name, shown muted beside the value. */
  label: string
  /**
   * A `number` is formatted through `./format` (`formatQuantity` when `unit`
   * is set, otherwise `formatNumber`). A `string` is a caller-formatted
   * value rendered as-is. `null`/`undefined` render the empty placeholder.
   */
  value: number | string | null | undefined
  /** Appended through `formatQuantity` when `value` is a number. */
  unit?: string
}

/**
 * A status chip on the card. A string is a neutral label; the object form
 * is what `NeStatusBadge` already takes (`defineStatusMap` output).
 */
export type NeCardBadge = string | { label: string; tone: NeStatusTone }

export interface NeCardProps {
  /**
   * Status chip in the header, opposite the title. Colour is never the only
   * signal: `NeStatusBadge` speaks the tone in its accessible name.
   */
  badge?: NeCardBadge
  /** Image URL for the media slot. Prefer the `#media` slot for anything else. */
  media?: string
  /**
   * Accessible name of `media`. Required in spirit whenever `media` is set;
   * defaults to `title` so a card whose title already names the subject does
   * not invent a second string.
   */
  mediaAlt?: string
  /** Measured rows under the title. Omit for a card that is only title + actions. */
  stats?: readonly NeCardStat[]
  /** The card's name. The `#title` slot overrides it. */
  title?: string
}
