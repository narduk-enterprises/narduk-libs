/**
 * Types for the `@narduk-enterprises/narduk-core/app/error-page` export
 * (narduk-libs#521).
 *
 * The export's runtime target is the estate error page SFC
 * (`runtime/app/error.vue`). Without a `types` condition a consumer's `tsc` /
 * `vue-tsc` found no declaration for the `.vue` file and every app that
 * composed the page into its own `app/error.vue` needed a
 * `@ts-expect-error` on the import. This declaration mirrors the SFC's
 * `defineProps<{ error: NuxtError }>()`; `tests/error-page-types.test.ts`
 * keeps the two in step.
 */
import type { ErrorPageAction, ErrorPageCopy, ErrorPageLink, ErrorPageUi } from './error-page'
import type { NuxtError } from 'nuxt/app'
import type { DefineSetupFnComponent, SlotsType, VNode } from 'vue'

export type { ErrorPageAction, ErrorPageCopy, ErrorPageLink, ErrorPageUi } from './error-page'

export interface EstateErrorPageProps {
  error: NuxtError
  /** Title and description per status code, with `default` for the rest. Never the error's message. */
  copy?: ErrorPageCopy
  /** Go Home's label. Defaults to `'Go Home'`. */
  homeLabel?: string
  /** Where Go Home clears the error to. Defaults to `'/'`. */
  homeTo?: string
  /** A Nuxt layout to render the page inside. Defaults to none. */
  layout?: string | false
  /** Extra recovery links after Go Home and Try Again. */
  links?: readonly ErrorPageLink[]
  /** Runs before Go Home or Try Again; a throw or rejection is ignored. */
  onBeforeClear?: (error: NuxtError, action: ErrorPageAction) => unknown
  /** Try Again's label. Defaults to `'Try Again'`. */
  retryLabel?: string
  /** Colour classes for the page's parts, instead of `:deep()` selectors. */
  ui?: ErrorPageUi
}

export interface EstateErrorPageSlots {
  /** Extra actions after the recovery links. */
  actions?: (props: { error: NuxtError; statusCode: number }) => VNode[]
}

declare const EstateErrorPage: DefineSetupFnComponent<
  EstateErrorPageProps,
  never[],
  SlotsType<EstateErrorPageSlots>
>
export default EstateErrorPage
