/**
 * NeSegmented's public shape, kept apart from the SFC so a page that wraps the
 * control can type its options without importing a component.
 */
export type NeSegmentValue = string | number

export interface NeSegmentOption<T extends NeSegmentValue = NeSegmentValue> {
  value: T
  label: string
  /** A small count after the label (results in a filter, say). */
  count?: number | string
  /** Offered but not choosable. Disabled options are skipped by the arrow keys. */
  disabled?: boolean
  /** Why it is disabled, shown as its title. Disabled is never hidden. */
  disabledReason?: string
}

export interface NeSegmentedProps<T extends NeSegmentValue = NeSegmentValue> {
  /** The chosen value; `null` lights no segment (a custom range is in use, say). */
  modelValue: T | null
  options: ReadonlyArray<NeSegmentOption<T>>
  /** Accessible name, when no visible heading names the group. */
  label?: string
  /** Id of a visible heading that names the group; preferred over `label`. */
  labelledby?: string
  /**
   * `track` (default): segments joined in one tray, the chosen one raised.
   * `chips`: separate pills, the chosen one in solid ink.
   */
  variant?: 'track' | 'chips'
  /**
   * `fill` (default): segments share the width. `scroll`: segments keep their
   * size and the row scrolls sideways on a narrow screen. `wrap`: segments
   * wrap onto more rows.
   */
  layout?: 'fill' | 'scroll' | 'wrap'
  /** Figures (speeds, years) read in tabular mono. */
  mono?: boolean
}
