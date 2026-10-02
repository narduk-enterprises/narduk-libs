/**
 * `NeAppShell`'s caller-built shapes (components backlog item 18,
 * narduk-libs#265).
 *
 * Kept in a plain module for the same reason as `ne-pager-types.ts`: the
 * package root re-exports these as type-only exports, `src/module.ts` types
 * its `sections` option with them, and a plain `.ts` file is what a
 * non-Vue-aware tool can read a named interface out of.
 */

/**
 * The shell's layouts. `'rail'` — the sectioned left rail — is the only one
 * this item ships (plan decision D3). It is a union of one on purpose: a later
 * variant (a top-nav shape for public apps) is added here when a second app
 * needs one, and every existing call site keeps type-checking.
 */
export type NeAppShellVariant = 'rail'

/** One destination in a rail section. */
export interface NeAppShellItem {
  /** The destination's name, retained for assistive technology when collapsed. The link's accessible name. */
  label: string
  /**
   * The route. Active state comes from the router matching this location
   * against the current route, never from state the app keeps.
   */
  to: string
  /** Include query state when matching selection-sensitive destinations. */
  exactQuery?: boolean | 'partial'
  /** Nuxt UI icon name, e.g. `i-lucide-server`. Decorative. */
  icon?: string
  /** Decorative asset URL, preferred over icon when supplied. */
  iconSrc?: string
  /**
   * A short reading beside the label, e.g. an unread count. Rendered inside
   * the link, so it is part of the link's accessible name.
   */
  badge?: string | number
}

/** One labelled rail section. Sections are expanded unless explicitly collapsible. */
export interface NeAppShellSection {
  /** Stable identifier; the key an app uses to find the section at runtime. */
  id: string
  /** The section's visible label and the accessible name of its group. */
  label: string
  items: NeAppShellItem[]
  /** Opt in to a disclosure button for this section. */
  collapsible?: boolean
  /** Initial disclosure state. Ignored unless collapsible is true. */
  defaultOpen?: boolean
  /** Hide the visible heading while preserving the group's accessible name. */
  hideLabel?: boolean
}

/**
 * The runtime half of the `nardukShell` module options, as it reaches the app
 * through `app.config` under the `nardukShell` key.
 */
export interface NeAppShellAppConfig {
  /** Sets `--ne-accent` app-wide. See the README's "Brand overrides". */
  accent?: string
  /** Sets `--ne-structure` app-wide. See the README's "Brand overrides". */
  structure?: string
  /** Seeds `useNardukShellSections()`. */
  sections?: NeAppShellSection[]
}

export interface NeAppShellProps {
  /** The layout. `'rail'` is the only value today; see `NeAppShellVariant`. */
  variant?: NeAppShellVariant
  /**
   * Sections to render instead of the shared `useNardukShellSections()`
   * state. Leave unset in an app: the shared state is what a runtime mutation
   * (a feature-flagged admin section) reaches. Set it for a preview or for a
   * second, independent shell.
   */
  sections?: readonly NeAppShellSection[]
  /** Accessible name of the rail's navigation landmark. */
  navLabel?: string
  /** Text of the skip link that jumps past the rail to the page content. */
  skipLinkLabel?: string
  /** Enable an icon rail on desktop. Defaults to false. */
  collapsible?: boolean
  /** Expanded rail width in rem. Defaults to 14.5. */
  railWidth?: number
  /** Collapsed rail width in rem. Defaults to 4. */
  collapsedWidth?: number
}
