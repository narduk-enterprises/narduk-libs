/**
 * NeBottomTabBar's public shape and its pure "which tab is lit" rule, kept
 * apart from the SFC so a server route, a test or a wrapping page can use them
 * without importing a component.
 */
export interface NeBottomTabItem {
  /** Visible label under the icon. */
  label: string
  /** Route path the tab links to. */
  to: string
  /** Iconify name, for example `i-lucide-map`. */
  icon?: string
  /**
   * Extra path prefixes that also light this tab: a Library tab that owns
   * `/playlists` and `/albums`, say.
   */
  match?: readonly string[]
  /** Light the tab on its own path only, never on a sub-path. `/` is always exact. */
  exact?: boolean
  /** `data-testid` on the link. */
  testid?: string
}

export interface NeBottomTabBarProps {
  items: readonly NeBottomTabItem[]
  /** The navigation landmark's accessible name. Default `Primary`. */
  label?: string
  /**
   * The `to` of the tab lit when no tab matches the current path: the "More"
   * tab that every other page was reached through. Unset, no tab is lit.
   */
  fallback?: string
  /**
   * The current path. Defaults to the router's; pass it to drive the bar from
   * somewhere else (a test, a story, an app without vue-router).
   */
  path?: string
  /**
   * Show the bar below the `md` breakpoint (48rem) only. Default `true`: a
   * desktop layout has its own navigation.
   */
  phoneOnly?: boolean
}

/** How a tab relates to the current path. */
export type NeBottomTabState = 'page' | 'section' | 'fallback' | 'none'

function trimSlash(path: string): string {
  const bare = path.split(/[?#]/u)[0] ?? ''
  return bare.length > 1 ? bare.replace(/\/+$/u, '') || '/' : bare || '/'
}

function underPrefix(path: string, prefix: string): boolean {
  const base = trimSlash(prefix)
  if (base === '/') return path === '/'
  return path === base || path.startsWith(`${base}/`)
}

/**
 * The state of every tab for `path`, in item order. At most one tab is lit:
 * an exact path match wins, then the longest matching prefix (so `/stations`
 * beats `/` and `/library/albums` beats `/library`), then `fallback`. Query
 * and hash are ignored.
 */
export function resolveBottomTabs(
  items: readonly NeBottomTabItem[],
  path: string,
  fallback?: string,
): NeBottomTabState[] {
  const current = trimSlash(path)
  const exactIndex = items.findIndex((item) => trimSlash(item.to) === current)
  if (exactIndex !== -1) return items.map((_, index) => (index === exactIndex ? 'page' : 'none'))

  let best = -1
  let bestLength = -1
  for (const [index, item] of items.entries()) {
    const prefixes = item.exact ? (item.match ?? []) : [item.to, ...(item.match ?? [])]
    for (const prefix of prefixes) {
      if (underPrefix(current, prefix) && trimSlash(prefix).length > bestLength) {
        best = index
        bestLength = trimSlash(prefix).length
      }
    }
  }
  if (best !== -1) return items.map((_, index) => (index === best ? 'section' : 'none'))

  const fallbackIndex =
    fallback === undefined
      ? -1
      : items.findIndex((item) => trimSlash(item.to) === trimSlash(fallback))
  return items.map((_, index) => (index === fallbackIndex ? 'fallback' : 'none'))
}
