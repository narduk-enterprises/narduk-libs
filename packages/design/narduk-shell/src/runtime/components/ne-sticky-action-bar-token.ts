/*
 * One document-level token, many bars.
 *
 * Two kinds of bar share the bottom edge: page actions (NeStickyActionBar) and
 * the layout's navigation (NeBottomTabBar). Each kind keeps its own stack,
 * because during a page transition the incoming bar mounts before the
 * outgoing one unmounts, so only the newest bar of a kind counts.
 *
 * - `--ne-bottom-bar-h` is the newest action bar plus the newest tab bar, so
 *   `scroll-padding-bottom` clears both when a page has both.
 * - `--ne-bottom-nav-h` is the newest tab bar alone. NeStickyActionBar sits
 *   that far up, above the tab bar instead of under it.
 *
 * Each token goes back to its original value when the last bar of every kind
 * leaves.
 */
const TOKEN = '--ne-bottom-bar-h'
const NAV_TOKEN = '--ne-bottom-nav-h'

export type NeBottomBarKind = 'action' | 'nav'

export interface NeBottomBarEntry {
  px: number
  kind?: NeBottomBarKind
}

const mountedBars: NeBottomBarEntry[] = []
let tokenRoot: HTMLElement | undefined
let originalToken = ''
let originalNavToken = ''

function newest(kind: NeBottomBarKind): NeBottomBarEntry | undefined {
  for (let index = mountedBars.length - 1; index >= 0; index -= 1) {
    const entry = mountedBars[index]
    if (entry && (entry.kind ?? 'action') === kind) return entry
  }
  return undefined
}

function restore(root: HTMLElement, name: string, original: string) {
  if (original) root.style.setProperty(name, original)
  else root.style.removeProperty(name)
}

function writeToken() {
  if (!tokenRoot) return
  if (mountedBars.length === 0) {
    restore(tokenRoot, TOKEN, originalToken)
    restore(tokenRoot, NAV_TOKEN, originalNavToken)
    return
  }
  const action = newest('action')
  const nav = newest('nav')
  tokenRoot.style.setProperty(TOKEN, `${(action?.px ?? 0) + (nav?.px ?? 0)}px`)
  if (nav) tokenRoot.style.setProperty(NAV_TOKEN, `${nav.px}px`)
  else restore(tokenRoot, NAV_TOKEN, originalNavToken)
}

/**
 * Register `entry` (pass `root` the first time, to join the stack) and publish
 * the bars' heights.
 */
export function claimBottomBarToken(entry: NeBottomBarEntry, root?: HTMLElement) {
  if (root && !mountedBars.includes(entry)) {
    if (mountedBars.length === 0) {
      tokenRoot = root
      originalToken = root.style.getPropertyValue(TOKEN)
      originalNavToken = root.style.getPropertyValue(NAV_TOKEN)
    }
    mountedBars.push(entry)
  }
  writeToken()
}

/** Remove `entry`; the remaining bars' heights, or the original values, come back. */
export function releaseBottomBarToken(entry: NeBottomBarEntry) {
  const index = mountedBars.indexOf(entry)
  if (index === -1) return
  mountedBars.splice(index, 1)
  writeToken()
}
