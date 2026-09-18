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
 * The data-table family (narduk-libs#528). `toCsv` and `parseSort` are pure
 * functions with no Vue or DOM import, so a server route can write the same
 * CSV `NeCsvDownload` does, and a page can read a wire sort without a regex.
 */
export { parseSort, toCsv } from './runtime/utils/data-table'
export type {
  NeCsvDownloadProps,
  NeDataColumn,
  NeDataColumnGroup,
  NeDataTableProps,
  NeSortableColumn,
  NeSortDirection,
  NeSortHeaderProps,
} from './runtime/components/ne-data-table-types'

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
