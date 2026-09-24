/**
 * `NeCardList`'s caller-built shapes (narduk-libs#264).
 *
 * Same reason as `ne-pager-types.ts`: the package root re-exports these as
 * type-only exports, and a plain `.ts` file is what a non-Vue-aware tool can
 * read a named interface out of without compiling the SFC.
 */
import type { Component } from 'vue'

import type { NeCollection } from '../composables/use-collection'
import type { NePagerProps } from './ne-pager-types'

/**
 * Breakpoints `columns` can constrain. Same vocabulary `NeKpiBand` uses, so
 * a page that already wrote `{ base: 1, md: 2, xl: 3 }` for tiles can reuse
 * the object on the card list.
 */
export type NeCardListBreakpoint = 'base' | 'sm' | 'md' | 'lg' | 'xl'

/** Columns at one breakpoint. 6 is the same ceiling as `NeKpiBand`. */
export type NeCardListColumnCount = 1 | 2 | 3 | 4 | 5 | 6

export interface NeCardListProps<TItem = unknown> {
  /**
   * The card rendered for each item. Receives the row as `item`. Prefer the
   * `#card` slot when the card needs more than one prop; this is the
   * `:card="RiverCard"` form in the plan.
   */
  card?: Component
  /**
   * The live `useCollection()` return. Wins over `v-model:state` when both
   * are given, so a page can bind the same `c` it already hands the table.
   * `update:limit` is forwarded to `c.setLimit`.
   */
  collection?: NeCollection<TItem>
  /**
   * Columns per breakpoint. Only the breakpoints given are constrained.
   * Defaults to the plan's density: one column on a phone, two from `md`,
   * three from `xl`.
   */
  columns?: Partial<Record<NeCardListBreakpoint, NeCardListColumnCount>>
  /** Forwards to the built-in `NePager`. */
  density?: NePagerProps['density']
  /** Empty-panel sentence. */
  emptyMessage?: string
  /** Empty-panel headline. */
  emptyTitle?: string
  /** Error-panel sentence. The collection's `error` is not stringified onto the page. */
  errorMessage?: string
  /** Error-panel headline. */
  errorTitle?: string
  /** Loading-panel sentence. */
  loadingMessage?: string
  /** Loading-panel headline. */
  loadingTitle?: string
  /** Forwards to the built-in `NePager`. */
  maxLimit?: NePagerProps['maxLimit']
  /** Forwards to the built-in `NePager`. */
  mode?: NePagerProps['mode']
  /** Plural noun for the built-in pager summary: "rivers", "stations". */
  noun?: string
  /** Forwards to the built-in `NePager`. */
  pageSizes?: NePagerProps['pageSizes']
  /**
   * Stable identity for each card. Defaults to the row's index, which is
   * enough for a static page and wrong for a list that reorders — pass
   * `(item) => item.id` there.
   */
  rowKey?: (item: TItem, index: number) => string
  /** Forwards to the built-in `NePager`. Real hrefs, same SEO claim. */
  to?: NePagerProps['to']
}
