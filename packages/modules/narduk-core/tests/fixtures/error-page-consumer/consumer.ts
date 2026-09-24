/**
 * A consumer of the `./app/error-page` export, type-checked by
 * `tests/error-page-types.test.ts` (narduk-libs#521). It must compile with no
 * suppression directive: the import resolves through the package's own `exports`
 * map (a self-reference), exactly as an app's `app/error.vue` imports it.
 */
import EstateErrorPage from '@narduk-enterprises/narduk-core/app/error-page'
import { h } from 'vue'

import type { NuxtError } from 'nuxt/app'

declare const error: NuxtError

export const vnode = h(EstateErrorPage, { error })
