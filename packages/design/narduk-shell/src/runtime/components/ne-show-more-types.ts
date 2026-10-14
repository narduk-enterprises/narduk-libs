/**
 * NeShowMore's public shape. Separate from the SFC so a page that wraps the
 * control can type its props without importing a component.
 */
export interface NeShowMoreProps {
  /**
   * The id of the list the control reveals (`aria-controls`). Optional, but it
   * is what tells a screen reader which list "Show all 24" acts on.
   */
  controls?: string
  /**
   * How many rows are still cut. When given, the control renders nothing at
   * `0` or less, so a caller can leave it in the template and bind
   * `useRowLimit().hidden`. Omit it to render unconditionally and use `v-if`.
   */
  hidden?: number
  /** Replaces the whole label. Default `Show all <total>`. */
  label?: string
  /** What the rows are, appended to the default label: `Show all 24 runners`. */
  noun?: string
  /** The whole list's length, for the default label. */
  total: number
}

/** The default label: `Show all 24`, or `Show all 24 runners` with a noun. */
export function showMoreLabel(total: number | string, noun?: string): string {
  return noun ? `Show all ${total} ${noun}` : `Show all ${total}`
}
