/*
 * One document-level token, many bars: during a page transition the incoming
 * NeStickyActionBar mounts before the outgoing one unmounts. Mounted bars are
 * kept in a stack so the newest one's height wins and `--ne-bottom-bar-h` only
 * goes back to its original value when the last bar leaves.
 */
const TOKEN = '--ne-bottom-bar-h'

export interface NeBottomBarEntry {
  px: number
}

const mountedBars: NeBottomBarEntry[] = []
let tokenRoot: HTMLElement | undefined
let originalToken = ''

function writeToken() {
  if (!tokenRoot) return
  const top = mountedBars.at(-1)
  if (top) tokenRoot.style.setProperty(TOKEN, `${top.px}px`)
  else if (originalToken) tokenRoot.style.setProperty(TOKEN, originalToken)
  else tokenRoot.style.removeProperty(TOKEN)
}

/**
 * Register `entry` (pass `root` the first time, to join the stack) and publish
 * the newest bar's height.
 */
export function claimBottomBarToken(entry: NeBottomBarEntry, root?: HTMLElement) {
  if (root && !mountedBars.includes(entry)) {
    if (mountedBars.length === 0) {
      tokenRoot = root
      originalToken = root.style.getPropertyValue(TOKEN)
    }
    mountedBars.push(entry)
  }
  writeToken()
}

/** Remove `entry`; the previous bar's height, or the original value, comes back. */
export function releaseBottomBarToken(entry: NeBottomBarEntry) {
  const index = mountedBars.indexOf(entry)
  if (index === -1) return
  mountedBars.splice(index, 1)
  writeToken()
}
