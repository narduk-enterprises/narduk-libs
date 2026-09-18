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
import type { NuxtError } from 'nuxt/app'
import type { DefineSetupFnComponent } from 'vue'

export interface EstateErrorPageProps {
  error: NuxtError
}

declare const EstateErrorPage: DefineSetupFnComponent<EstateErrorPageProps>
export default EstateErrorPage
