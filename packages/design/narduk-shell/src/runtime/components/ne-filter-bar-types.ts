/**
 * NeFilterBar's public shapes (narduk-libs#261).
 *
 * Separate from the SFC for the same reason `ne-data-table-types.ts` is: a
 * consumer that only wants the item type should not have to import a component
 * to get it.
 */

/** Which of the three rows to render. They share a DOM shape and differ in role. */
export type NeFilterBarKind = 'chips' | 'facets' | 'tabs'

export interface NeFilterBarItem {
  /**
   * Extra attributes for the control (`data-platform-facet`, …). An
   * `undefined` value is dropped rather than rendered as the string
   * "undefined".
   */
  attrs?: Record<string, string | undefined>
  /**
   * The figure this control filters down to. Omit it rather than passing `0`
   * when the count is unknown: `0` is a measurement and an absent count is
   * not, and a control that renders "0" for "not counted" is the same lie a
   * hatched bar exists to avoid.
   */
  count?: number | string
  /**
   * This control cannot be chosen — in practice because nothing produces its
   * rows yet. It stays in the row, `aria-disabled`, because removing it hides
   * the fact that the filter is coming; pair it with the row's `note`.
   */
  disabled?: boolean
  key: string
  label: string
  /** `data-testid` for the control, so a consumer's spec keeps its hook through adoption. */
  testid?: string
  /** Hover text — a disabled control's reason, typically. */
  title?: string
}

export interface NeFilterBarProps {
  /** Drop the row's top margin when it sits in a container that already spaces it. */
  flush?: boolean
  /** Tabs only: the id prefix the consumer's `tabpanel`s are named under. */
  idPrefix?: string
  items: NeFilterBarItem[]
  kind?: NeFilterBarKind
  /** The row's accessible name (`aria-label` on the group or tablist). Required: a filter row with no name is unusable by anything that lists landmarks. */
  label: string
  /** The selected key. `null` is "nothing selected", which a toggling consumer sets on a second click. */
  modelValue?: string | null
  /** A caption for the row — when the disabled controls land, typically. */
  note?: string
}
