/**
 * `NePager`'s prop contract, kept in a plain module rather than inside the
 * single-file component.
 *
 * Same reason as `ne-confirm-dialog-types.ts`: `src/module.ts` re-exports the
 * suite's public types from the package root, Nuxt loads that entry with jiti,
 * and jiti cannot parse a `.vue`. A type-only re-export is erased and would be
 * safe in principle, but keeping the declaration out of the SFC means the
 * question never has to be re-answered by the next lane reading this file.
 */
import type { RouteLocationRaw } from 'vue-router'

export interface NePagerProps {
  /**
   * `'dense'` is the list-foot reading pacc-trac's `DenseListPager` shipped:
   * smaller control, tighter gap, summary on the same line as the buttons.
   */
  density?: 'default' | 'dense'
  /** Plural noun for the summary line: "rivers", "orders", "runners". */
  noun?: string
  /** Pages either side of the current one. `UPagination`'s own default is 2. */
  siblingCount?: number
  /** First/last/previous/next controls. */
  showControls?: boolean
  /** The `1–25 of 712 rivers` line. */
  showSummary?: boolean
  /**
   * Turns page N into a route location, which makes every control a real
   * link — an `<a href>` a crawler follows and a middle-click opens in a tab.
   * Omit it for a pager inside a view that pages without navigating.
   */
  to?: (page: number) => RouteLocationRaw
}
