/**
 * NeTabs' public shape. Separate from the SFC so a page that wraps the tabs can
 * type its items and props without importing a component.
 */
export interface NeTabItem {
  /** The tab's name: what `v-model` holds and what `?tab=` carries. Unique. */
  value: string
  /** The visible text. */
  label: string
  /** An icon name shown before the label, e.g. `i-lucide-trophy`. */
  icon?: string
  /** A small count or marker after the label, e.g. unread `3`. */
  badge?: number | string
  /** A disabled tab is skipped by the arrow keys and cannot be chosen. */
  disabled?: boolean
}

export interface NeTabsProps {
  /** The tabs, in order. */
  items: readonly NeTabItem[]
  /** The selected tab's `value`, for `v-model`. Ignored when `routeParam` is set. */
  modelValue?: string
  /**
   * Keep the selected tab in the URL under this query key (`?tab=`). Switching
   * uses `router.replace`, other query keys and the hash are kept, and the
   * default tab leaves the URL clean. See `useRouteTab`. Needs vue-router.
   */
  routeParam?: string
  /** The tab shown when nothing else picks one. Default: the first enabled tab. */
  defaultValue?: string
  /** The tab strip's accessible name. Default `Tabs`. */
  label?: string
}
