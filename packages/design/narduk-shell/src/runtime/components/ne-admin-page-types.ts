/**
 * The admin page blocks' contracts: `NeAdminListPage`, `NeAdminDetailPage`
 * and `NeAdminEditPage` (components backlog item 20, narduk-libs#267).
 *
 * Kept in a plain module for the same reason as `ne-pager-types.ts`: the
 * package root re-exports these as type-only exports, and a plain `.ts` file
 * is what a non-Vue-aware tool can read a named interface out of without
 * compiling an SFC. Every prop here is either the page's own header copy or a
 * straight forward to a piece that already exists; the blocks add no
 * behaviour of their own beyond wiring those pieces to one data source.
 */
import type { RouteLocationRaw } from 'vue-router'

import type { NeCollection } from '../composables/use-collection'
import type { NeConfirmOptions } from '../composables/use-confirm'
import type { NeAsyncDataStatus, NeStateValue } from '../types'
import type { NeDataColumn } from './ne-data-table-types'
import type { NeDetailItem } from './ne-detail-view-types'
import type { NePagerProps } from './ne-pager-types'

/**
 * One breadcrumb, in `NePageHeader`'s own item shape (`label`, optional `to`
 * / `icon`, any other `UBreadcrumb` field). Declared here rather than
 * imported from `NePageHeader.vue` so this file stays readable without the
 * SFC compiler.
 */
export interface NeAdminBreadcrumbItem {
  [key: string]: unknown
  icon?: string
  label?: string
  to?: string
}

/** The header copy every admin block forwards to `NePageHeader`. */
export interface NeAdminPageHeaderProps {
  /** Trail above the title. The list page's own entry is usually the last one. */
  breadcrumbs?: NeAdminBreadcrumbItem[]
  /** Supporting copy under the title. */
  description?: string
  /** Small label above the title — `Admin`, or the section name. */
  eyebrow?: string
  /** The page title, rendered as the page's one `<h1>`. */
  title: string
}

/**
 * The panel copy for a read that has not produced a record (or a row) yet.
 * Each string goes to `NeStatePanel` for that reading only; an empty string
 * falls back to the panel's own wording.
 */
export interface NeAdminPanelCopyProps {
  /** Empty-panel sentence. */
  emptyMessage?: string
  /** Empty-panel headline. */
  emptyTitle?: string
  /** Error-panel sentence. The underlying error is never stringified onto the page. */
  errorMessage?: string
  /** Error-panel headline. */
  errorTitle?: string
  /** Loading-panel sentence. */
  loadingMessage?: string
  /** Loading-panel headline. */
  loadingTitle?: string
}

export interface NeAdminListPageProps<TRow = Record<string, unknown>>
  extends NeAdminPageHeaderProps, NeAdminPanelCopyProps {
  /**
   * The ONE `useCollection()` return the page is built on. The table's rows,
   * sort and loading bar, the search field, and the pager all read it and
   * write back through its own mutators (`setSort`, `q`, `setPage`,
   * `setLimit`), so no control on the page can change the query without the
   * page reset `useCollection` guarantees.
   */
  collection: NeCollection<TRow>
  /** `NeDataTable` columns. A column with `sortKey` drives `collection.setSort`. */
  columns: ReadonlyArray<NeDataColumn<TRow>>
  /** Screen-reader caption for the table. */
  caption?: string
  /** Plural noun for the pager summary: "runners", "orders". */
  noun?: string
  /** Forwards to `NePager`: page sizes offered, wired to `collection.setLimit`. */
  pageSizes?: NePagerProps['pageSizes']
  /** Stable row identity. Defaults to the row's index. */
  rowKey?: (row: TRow, index: number) => string
  /**
   * Accessible name of the built-in `NeSearchInput`, bound to `collection.q`.
   * Omit it for a list with no search: the field is only rendered when it
   * has a name, because a search with no label is unusable.
   */
  searchLabel?: string
  /** Hint shown in the empty search field. Not its accessible name. */
  searchPlaceholder?: string
  /** Forwards to `NePager`: page N as a route location, for real hrefs. */
  to?: NePagerProps['to']
}

export interface NeAdminDetailPageProps extends NeAdminPageHeaderProps, NeAdminPanelCopyProps {
  /**
   * Confirm-dialog copy for the delete action. Defaults to a `danger` dialog
   * asking "Delete <title>?"; `onConfirm` is not accepted here because the
   * page's own `onDelete` is what runs.
   */
  deleteConfirm?: Omit<NeConfirmOptions, 'onConfirm'>
  /** The delete button's label. */
  deleteLabel?: string
  /** The record, as `NeDetailView` rows. */
  items: readonly NeDetailItem[]
  /**
   * Deletes the record. When set, the header gains a delete button that asks
   * through `useConfirm()` first; this runs only on confirm, while the dialog
   * shows its pending state. A rejection keeps the dialog open with the
   * error, so the reader can retry or cancel. `deleted` is emitted once it
   * resolves — navigate away there.
   */
  onDelete?: () => unknown | Promise<unknown>
  /**
   * An explicit `NeStatePanel` reading. Wins over `status`, so
   * `:panel-state="record ? undefined : 'empty'"` composes with a bound
   * status. Named `panelState`, not `state`, because on `NeAdminEditPage`
   * `state` is the form's state, as on `NeForm` and `NeSettingsPage`.
   */
  panelState?: NeStateValue
  /** `useAsyncData()` / `useFetch()` status for the record's read. */
  status?: NeAsyncDataStatus
  /** Forwards to `NeDetailView`: the zone for `date` / `datetime` rows. */
  timeZone?: string
  /** Forwards to `NeDetailView`: what a missing reading prints. */
  unavailableMessage?: string
}

export interface NeAdminEditPageProps extends NeAdminPageHeaderProps, NeAdminPanelCopyProps {
  /** The cancel action's label. */
  cancelLabel?: string
  /**
   * Where cancel goes — usually the record's detail page. Renders the cancel
   * action as a real link. Wins over `onCancel` when both are given.
   */
  cancelTo?: RouteLocationRaw
  /** Forwarded to `NeForm`. */
  disabled?: boolean
  /** Called by a cancel button in the save bar. Ignored when `cancelTo` is set. */
  onCancel?: () => void
  /** Forwarded to `NeForm`'s `onSubmit` prop. See `NeForm` for the full submit contract. */
  onSubmit?: (data: Record<string, unknown>) => unknown | Promise<unknown>
  /** Forwarded to `NeForm`. */
  saveLabel?: string
  /** Forwarded to `NeForm`'s `schema` prop. */
  schema?: unknown
  /** An explicit `NeStatePanel` reading for the record's read. Wins over `status`. */
  panelState?: NeStateValue
  /** Forwarded to `NeForm`'s `state` prop. Required — edit pages are always controlled. */
  state: Record<string, unknown>
  /** `useAsyncData()` / `useFetch()` status for the record's read. */
  status?: NeAsyncDataStatus
  /** Forwarded to `NeForm`. Defaults on, as on `NeSettingsPage`. */
  stickySave?: boolean
  /** Forwarded to `NeForm`'s `validate` prop. */
  validate?: (state: Record<string, unknown>) => unknown
}
