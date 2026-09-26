/**
 * Named exports of the package root (`.`) — narduk-libs#295.
 *
 * `.` used to be `src/module.ts`, which imports `@nuxt/kit`. Nuxt's
 * import-protection plugin exists precisely to stop that build-time import
 * from reaching a client bundle, so any app code writing
 * `import { defineStatusMap } from '@narduk-enterprises/narduk-shell'` failed
 * a production `nuxt build` — found by the first real adopter
 * (`narduk-enterprises/buoys` PR #44) within an hour of the 0.1.0 publish.
 *
 * This barrel is `.` now instead. It re-exports the exact values and types
 * `.` always documented, from the same underlying source files, and it must
 * never gain a value-level import of `src/module.ts` or of `@nuxt/kit`
 * itself: the "root barrel reachability" test in `test/module.test.ts` walks
 * this file's value-import graph and fails the moment either becomes
 * reachable again. The Nuxt module definition itself stays at
 * `src/module.ts`, reachable through its own `./module` subpath — see that
 * file's header for exactly how a consumer's unchanged
 * `modules: ['@narduk-enterprises/narduk-shell']` keeps resolving there.
 */
export {
  defineStatusMap,
  type NeStatusDescriptor,
  type NeStatusTone,
} from './runtime/utils/status-map'

/**
 * The suite's public runtime types, re-exported from the `.` subpath so an app
 * writes `import type { NeStateValue } from '@narduk-enterprises/narduk-shell'`.
 *
 * `export type` is erased, so this adds nothing to the module's Node-side
 * graph: no component source is loaded to read a type.
 */
export type {
  NeAsyncDataStatus,
  NeStateGap,
  NeStatePanelProps,
  NeStateValue,
} from './runtime/types'

/**
 * `useConfirm()`'s option and tone types, so a wrapper around the composable
 * can state its own signature, and a consuming app's unit test can type a stub,
 * without reaching for an auto-import that only exists inside Nuxt's transform.
 *
 * `useConfirm` itself is NOT re-exported here. `use-confirm.ts` imports
 * `NeConfirmDialog.vue` at module scope to hand the component object to
 * `useOverlay().create()`, and a value re-export would put that single-file
 * component in every value-import of this barrel for no reason — the
 * composable already reaches app code through `addImports` in
 * `src/module.ts`, which is not gated on component registration.
 */
export type { NeConfirmOptions } from './runtime/composables/use-confirm'
export type { NeConfirmTone } from './runtime/components/ne-confirm-dialog-types'

/**
 * `useCollection()`'s public types, re-exported from `.` for the same reason
 * the confirm dialog's are: a page that wraps the composable, or a unit test
 * that stubs it, has to be able to state the shape outside Nuxt's auto-import
 * transform. `NeCollectionState` is also `NePager`'s `v-model:state` type.
 *
 * `useCollection` itself is NOT re-exported as a value, matching `useConfirm`:
 * it reaches app code through `addImports` in `src/module.ts` instead.
 */
export type {
  NeCollection,
  NeCollectionFetchContext,
  NeCollectionOptions,
  NeCollectionQuery,
  NeCollectionState,
} from './runtime/composables/use-collection'

export type { NePagerProps } from './runtime/components/ne-pager-types'

/**
 * The card / card-list / detail-view family (narduk-libs#264). Types only:
 * the SFCs stay out of the barrel's value-import graph, matching the rest
 * of the suite.
 */
export type { NeCardBadge, NeCardProps, NeCardStat } from './runtime/components/ne-card-types'
export type {
  NeCardListBreakpoint,
  NeCardListColumnCount,
  NeCardListProps,
} from './runtime/components/ne-card-list-types'
export type {
  NeDetailFormat,
  NeDetailItem,
  NeDetailViewProps,
} from './runtime/components/ne-detail-view-types'

/**
 * The filter bar's caller-built shapes (narduk-libs#261). `ne-filter-bar-types`
 * exists so a page can type its items array without importing the SFC, which
 * only works if the barrel carries the types: the exports map exposes `.`,
 * `./module`, `./format` and `./theme.css`, so a deep path is not a legal
 * subpath and `from '@narduk-enterprises/narduk-shell'` is the only import a
 * consumer can write.
 */
export type {
  NeFilterBarItem,
  NeFilterBarKind,
  NeFilterBarProps,
} from './runtime/components/ne-filter-bar-types'

/**
 * The search field's caller-built shapes and the debounce constant
 * (narduk-libs#261). `NE_SEARCH_DEBOUNCE_MS` is a value on purpose: a page
 * that wants the same window without importing the SFC should not have to
 * hardcode 250. The types file is a plain module, so this does not put the
 * component — or `@nuxt/ui` — in the barrel's value-import graph.
 */
export { NE_SEARCH_DEBOUNCE_MS } from './runtime/components/ne-search-input-types'
export type {
  NeSearchInputProps,
  NeSearchInputSize,
} from './runtime/components/ne-search-input-types'

/**
 * The unreported treatment's vocabulary (narduk-libs#602) — the text every
 * figure component says, and the test it uses, when nothing produced a value —
 * and NeMeter's shapes (narduk-libs#601). Both files are plain modules, so
 * neither an SFC nor `@nuxt/ui` enters the barrel's value-import graph.
 */
export { isUnreported, NE_UNREPORTED_TEXT } from './runtime/utils/unreported'
export type { NeMeterProps, NeMeterVariant } from './runtime/components/ne-meter-types'

/**
 * The data-table family (narduk-libs#528). `toCsv` and `parseSort` are pure
 * functions with no Vue or DOM import, so a server route can write the same
 * CSV `NeCsvDownload` does, and a page can read a wire sort without a regex.
 */
export { parseSort, toCsv } from './runtime/utils/data-table'
export type {
  NeCsvDownloadProps,
  NeDataColumn,
  NeDataColumnGroup,
  NeDataTableBreakSlotProps,
  NeDataTableCellSlotProps,
  NeDataTableGroupSlotProps,
  NeDataTableProps,
  NeDataTableSlots,
  NeSortableColumn,
  NeSortDirection,
  NeSortHeaderProps,
} from './runtime/components/ne-data-table-types'

/**
 * NeProse's parser and AST (narduk-libs#1005). `parseProse` and
 * `proseOutline` are pure functions with no Vue or DOM import, so a page can
 * parse a document once, build its table of contents from the outline and
 * hand the same blocks to `<NeProse :blocks>`, and a server route can run the
 * parser too.
 */
export { parseProse, proseOutline } from './runtime/utils/prose'
export type {
  NeProseAlign,
  NeProseBlock,
  NeProseHeading,
  NeProseInline,
  NeProseListItem,
  NeProseProps,
} from './runtime/components/ne-prose-types'

/**
 * The admin page blocks (components backlog item 20, narduk-libs#267):
 * `NeAdminListPage`, `NeAdminDetailPage`, `NeAdminEditPage`. Types only; a
 * page wrapping one of them can state its props without importing the SFC.
 */
export type {
  NeAdminBreadcrumbItem,
  NeAdminDetailPageProps,
  NeAdminEditPageProps,
  NeAdminListPageProps,
  NeAdminPageHeaderProps,
  NeAdminPanelCopyProps,
} from './runtime/components/ne-admin-page-types'

/**
 * The marketing sections (components backlog item 21, narduk-libs#268):
 * `NeHero`, `NeFeatureGrid`, `NeCta`, `NeMarketingFooter`. Types only; each
 * is the wrapped Nuxt UI primitive's own props, so a page can type a
 * `links` or `features` array without importing the SFC.
 */
export type {
  NeCtaProps,
  NeCtaVariant,
  NeFeature,
  NeFeatureGridProps,
  NeHeroProps,
  NeMarketingFooterProps,
  NeMarketingLink,
  NeMarketingOrientation,
} from './runtime/components/ne-marketing-types'

/**
 * The shell's shapes (components backlog item 18, narduk-libs#265): its
 * props, the `variant` union, and the section / item shapes that the
 * `nardukShell.sections` option, `app.config.nardukShell` and
 * `useNardukShellSections()` all share. Types only; `useNardukShellSections`
 * reaches app code through `addImports`, like `useConfirm`.
 */
export type {
  NeAppShellAppConfig,
  NeAppShellItem,
  NeAppShellProps,
  NeAppShellSection,
  NeAppShellVariant,
} from './runtime/components/ne-app-shell-types'

/**
 * Data attribution and legal pages (narduk-libs#388). `NeDataSource` is
 * structural, so a caller maps its own `narduk-data` manifest onto it without
 * this package depending on one. `safeAttributionHref` is the http(s)-only
 * link rule the component applies.
 */
export { safeAttributionHref } from './runtime/components/ne-data-attribution-types'
export type {
  NeDataAttributionProps,
  NeDataLicense,
  NeDataSource,
} from './runtime/components/ne-data-attribution-types'

/**
 * The legal templates and their placeholder vocabulary are values on purpose:
 * an app builds a draft page from `privacyPolicyTemplate(options)` and its own
 * pre-launch test asserts `hasLegalPlaceholders(sections)` is false. Both
 * files are plain modules, so no SFC enters the barrel's value-import graph.
 * The templates contain placeholders only — no legal wording — by decision
 * on #388.
 */
export {
  hasLegalPlaceholders,
  isLegalPlaceholder,
  legalPlaceholder,
  NE_LEGAL_PLACEHOLDER_MARK,
} from './runtime/components/ne-legal-page-types'
export type {
  NeLegalDocument,
  NeLegalPageProps,
  NeLegalProcessor,
  NeLegalSection,
  NeLegalTemplateOptions,
} from './runtime/components/ne-legal-page-types'
export { privacyPolicyTemplate, termsOfServiceTemplate } from './runtime/utils/legal-templates'

/**
 * The skip link's target id and props (narduk-libs#977). `NE_MAIN_ID` is a
 * value on purpose: the layout writes `<main :id="NE_MAIN_ID">` and
 * `NeSkipLink` defaults to it, so the two ends of the link are one constant.
 * Inside a Nuxt app it arrives through the module's `addImports`, since import
 * protection refuses app code a bare import of this specifier; this export is
 * for code outside that build (a unit test, a non-Nuxt consumer). The types
 * file is a plain module, so this adds no SFC to the barrel's value-import
 * graph.
 */
export { NE_MAIN_ID } from './runtime/components/ne-skip-link-types'
export type { NeSkipLinkProps } from './runtime/components/ne-skip-link-types'

// Re-exported from the barrel rather than from a new subpath: item 1 fixed
// the exports map at `.`, `./format` and `./theme.css`; narduk-libs#295 added
// `./module`, but only for the Nuxt module definition, not for app-facing
// values. An app that wants to read or extend the preset should not need yet
// another specifier.
export {
  NARDUK_SHELL_APP_CONFIG,
  type NardukShellAppConfig,
  type NardukShellColorAliases,
  type NardukShellUiAppConfig,
} from './app-config'

// Type-only, so this does not put `src/module.ts` — and therefore
// `@nuxt/kit` — in this barrel's value-import graph: `export type` is erased
// before the bundler resolves anything. Lets a consumer name the module's
// options shape directly (a typed wrapper, a typed test fixture) without
// reaching into Nuxt's own inferred `nuxt.config.ts` module-options typing.
export type { NardukShellModuleOptions } from './module'
