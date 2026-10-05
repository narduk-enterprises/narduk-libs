/**
 * The command palette's public shapes.
 *
 * Kept apart from the single-file components so an app (or its unit test) can
 * state a group, an item or a provider without importing a component.
 */

/** A status chip's tone. `color` on the badge, when set, wins. */
export type NeCommandTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info'

export interface NeCommandBadge {
  /** The words. Colour is never the only signal, so a badge always has them. */
  label: string
  /** A semantic tone. Defaults to `neutral`. */
  tone?: NeCommandTone
  /**
   * A CSS colour for the status dot, for an app whose statuses have their own
   * scale (`var(--app-flood-moderate)`). Wins over `tone`.
   */
  color?: string
}

/** A second thing a row can do, e.g. "Show on map". Runs with Cmd/Ctrl+Enter. */
export interface NeCommandAction {
  id: string
  label: string
  icon?: string
  /** Where it goes. An action with no `to` only emits `select`. */
  to?: string
}

export interface NeCommandItem {
  /** Unique within its group. Also the recent-items key, so keep it stable. */
  id: string
  /** The row's title. */
  label: string
  /** The secondary line. Searched too. */
  description?: string
  /** An icon name for `UIcon`, e.g. `i-lucide-waves`. */
  icon?: string
  /** Where Enter goes: an app path, or an absolute URL. */
  to?: string
  badge?: NeCommandBadge
  /** Extra words that find the row but are not shown ("MO", an old name). */
  keywords?: readonly string[]
  /** The row's other actions. The first one runs on Cmd/Ctrl+Enter. */
  actions?: readonly NeCommandAction[]
}

export interface NeCommandSearchContext {
  /** Aborted when the query changes or the palette closes. Pass it to `fetch`. */
  signal: AbortSignal
}

/**
 * A group is one section of the palette. It holds its rows (`items`), asks a
 * provider for them (`search`), or both.
 */
export interface NeCommandGroup {
  id: string
  /** The section heading. */
  label: string
  /** A fixed list, or a function of the query for rows made from it. */
  items?: readonly NeCommandItem[] | ((query: string) => readonly NeCommandItem[])
  /**
   * An async provider. Called after `debounceMs` of quiet and at least
   * `minQuery` characters, with a signal that aborts when the query moves on.
   * A rejected call (that is not an abort) shows the group as unavailable; it
   * never shows an empty group as if nothing matched.
   */
  search?: (query: string, context: NeCommandSearchContext) => Promise<readonly NeCommandItem[]>
  /** The shortest query a provider is called with. Default 2. */
  minQuery?: number
  /** Quiet time before a provider is called, in ms. Default 150. */
  debounceMs?: number
  /** Rows shown while a query is typed. Default 5. */
  limit?: number
  /**
   * Rows shown before anything is typed. Default 0, which hides the group
   * until there is a query. Set it on a group worth browsing (pages, live items).
   */
  idleLimit?: number
  /**
   * `match` ranks `items` against the query. `source` keeps the order the
   * provider returned (the server already ranked it). Default `match` for
   * `items`, `source` for `search`.
   */
  rank?: 'match' | 'source'
  /** Remember picks from this group as recent items. Default true. */
  recent?: boolean
}

/** What `select` carries. */
export interface NeCommandSelection {
  item: NeCommandItem
  groupId: string
  /** The action that was run; `undefined` for the row itself. */
  action?: NeCommandAction
}

export interface NeCommandPaletteProps {
  groups: readonly NeCommandGroup[]
  /** The dialog's accessible name. Default "Search". */
  title?: string
  /** The input's placeholder. */
  placeholder?: string
  /** The input's accessible name. Defaults to `title`. */
  inputLabel?: string
  /** `localStorage` key for recent items. Give each app its own. */
  recentsKey?: string
  /** How many recent items are kept. Default 6. 0 turns recents off. */
  maxRecents?: number
  /** The heading above recent items. Default "Recent". */
  recentLabel?: string
  /** Shown when a query matches nothing. */
  emptyTitle?: string
  emptyDescription?: string
  /** Shown before anything is typed when no group has rows to offer. */
  idleHint?: string
  /**
   * Called to go to a `to`. Default: `router.push` for an app path and
   * `location.assign` for an absolute URL.
   */
  navigate?: (to: string) => void | Promise<void>
}

export interface NeCommandPaletteTriggerProps {
  /** Show only the icon (a phone header). The label stays for assistive tech. */
  compact?: boolean
  /**
   * A search page to submit to when the button is pressed before the page has
   * hydrated, so the control never does nothing. Omit for a plain button.
   */
  fallbackAction?: string
  /** The button's accessible name. Defaults to `placeholder`. */
  label?: string
  /** The text shown in the button, e.g. "Find a river, town or gauge". */
  placeholder?: string
  /** Bind Cmd/Ctrl+K and "/" from this component. Default true. */
  shortcuts?: boolean
}

/** A remembered pick, stored as plain JSON. */
export interface NeCommandRecent {
  groupId: string
  item: Pick<NeCommandItem, 'id' | 'label' | 'description' | 'icon' | 'to' | 'actions'>
}

/** A rendered row: an item placed in the flat keyboard order. */
export interface NeCommandRow {
  /** `sectionId:groupId:itemId`, unique across the list (a recent copy of a row is a different row). */
  key: string
  groupId: string
  item: NeCommandItem
  /** Position in the flat list the arrow keys walk. */
  index: number
}

export interface NeCommandSection {
  id: string
  label: string
  /** `loading` while a provider is out, `error` when it failed, else `ready`. */
  status: 'ready' | 'loading' | 'error'
  rows: NeCommandRow[]
  /** True for the recent-items section. */
  recent?: boolean
}

/** A provider's last answer for one group. */
export interface NeCommandGroupState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  items: readonly NeCommandItem[]
}
