/**
 * The same import with a prop of the wrong type. `tests/error-page-types.test.ts`
 * expects this file to fail, which proves the declaration is typed rather than
 * `any`.
 */
import EstateErrorPage from '@narduk-enterprises/narduk-core/app/error-page'
import { h } from 'vue'

export const vnode = h(EstateErrorPage, { error: 42 })
