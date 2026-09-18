/**
 * `NePager`'s prop contract, kept in a plain module rather than inside the
 * single-file component.
 *
 * Same reason as `ne-confirm-dialog-types.ts`: `src/index.ts` (the `.`
 * subpath — narduk-libs#295 moved it off `src/module.ts`) re-exports the
 * suite's public types from the package root as type-only exports, which are
 * erased before the bundler resolves anything. A plain `.ts` module is what a
 * generic, non-Vue-aware tool can read a named interface out of directly,
 * without needing Vue's own SFC compiler to strip one out of a `<script>`
 * block. Keeping the declaration out of the SFC means the question never has
 * to be re-answered by the next lane reading this file.
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
  /**
   * Page sizes offered in a "25 per page" select. Omit for no select. The
   * pager cannot change the limit itself (its model applies the page only):
   * the select emits `update:limit`, which you hand to `useCollection().setLimit`.
   */
  pageSizes?: readonly number[]
  /**
   * `'pages'` (default): numbered pages. `'more'`: a "Show 25 more" button for
   * a phone, which grows the page by emitting `update:limit` so the list keeps
   * its scroll. `'auto'`: numbered pages from the `sm` breakpoint up, "Show
   * more" below it — pure CSS, so the server renders both.
   */
  mode?: 'pages' | 'more' | 'auto'
  /** How many rows "Show more" adds. Defaults to the limit the pager first saw. */
  moreStep?: number
  /**
   * The route's page-size ceiling. Once the page has grown to it, "Show more"
   * gives way to numbered pages rather than offering a click that cannot work.
   */
  maxLimit?: number
}
