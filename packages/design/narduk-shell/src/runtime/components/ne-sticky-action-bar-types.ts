/**
 * NeStickyActionBar's public shape. Separate from the SFC so a page that wraps
 * the bar can type its props without importing a component.
 */
export interface NeStickyActionBarProps {
  /** The bar's accessible name (it is a `group`). Default `Actions`. */
  label?: string
  /**
   * Show the bar below the `md` breakpoint (48rem) only, and on a wider screen
   * remove both it and its reserved space. Default `true`: this is the phone's
   * bottom CTA bar, and a desktop page keeps its actions where they are.
   */
  phoneOnly?: boolean
}
