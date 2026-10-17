/**
 * NeMessageProse's public shape. Separate from the SFC so a page that wraps
 * the component can type its props without importing it.
 */

/** `block` renders paragraphs, lists, code and tables; `inline` renders one line. */
export type NeMessageProseMode = 'block' | 'inline'

export interface NeMessageProseProps {
  /**
   * Block mode only: the most lines the message shows before a Show more /
   * Show less button. Measured, not guessed: the button exists only once the
   * text is seen to overflow. Default: no clamp. A value that is not a
   * positive number is no clamp.
   */
  clamp?: number
  /** `block` (default), or `inline` for a title, option, table cell or log line. */
  mode?: NeMessageProseMode
  /** What the agent or bot wrote: markdown, as plain text. `null` and `undefined` render nothing. */
  text?: string | null
}
