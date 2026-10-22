/**
 * NeRelativeTime's public shape. Separate from the SFC so a page that wraps the
 * component can type its props without importing it.
 */
import type { NeDateInput } from '../../format'

export interface NeRelativeTimeProps {
  /** The instant: a `Date`, epoch milliseconds or anything `Date.parse` reads. */
  value: NeDateInput
  /**
   * IANA zone for the date and the day arithmetic. Required, as in `./format`:
   * the market's zone, the gauge's zone, `'UTC'`. Never the browser's.
   */
  timeZone: string
  /** BCP-47 tag. Default `en-US`. */
  locale?: string
  /**
   * A fixed instant to measure against instead of the shared 30-second clock.
   * For a server snapshot, a screenshot test or a card that must not move.
   */
  now?: NeDateInput
  /**
   * Milliseconds from now beyond which the text is an absolute date. Default
   * 7 days. `Infinity` keeps it relative; `0` is always absolute.
   */
  absoluteAfter?: number
  /** Rendered when `value` is missing or unparseable. Default `—`. */
  empty?: string
  /** Replaces the hover tooltip. Default: the full date, time and zone name. */
  title?: string
}
