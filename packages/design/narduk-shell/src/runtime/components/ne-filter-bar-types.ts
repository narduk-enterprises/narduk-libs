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

/**
 * Classes a consumer adds to the bar's parts, for an app that draws filters
 * in its own design system (`theme: false`). Each is appended after the
 * suite's own classes; `selected` is added to the selected control only.
 * Behaviour and ARIA do not change with them.
 */
export interface NeFilterBarUi {
  /** The outer wrapper (controls row, note and `after` slot). */
  root?: string
  /** The row that carries `role="group"` / `role="tablist"`. */
  controls?: string
  /** Every control. */
  control?: string
  /** The selected control, in addition to `control`. */
  selected?: string
  /** A control's count. */
  count?: string
  /** The row note. */
  note?: string
  /** Extra classes per part; see `NeFilterBarUi`. */
  ui?: NeFilterBarUi
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
  /**
   * The selected key, or with `multiple` the array of pressed keys. `null` is
   * "nothing selected", which a toggling consumer sets on a second click.
   */
  modelValue?: string | string[] | null
  /**
   * More than one control may be pressed (narduk-libs#1545): `modelValue` is
   * the array of pressed keys and each of them carries `aria-pressed="true"`
   * and `ui.selected`. A click still emits just the clicked key; the caller
   * toggles it in its array, as it toggles the single key today. Default
   * `false`. Ignored for `kind: 'tabs'` (a tablist has one selected tab).
   */
  multiple?: boolean
  /** A caption for the row — when the disabled controls land, typically. */
  note?: string
  /** Extra classes per part; see `NeFilterBarUi`. */
  ui?: NeFilterBarUi
}
