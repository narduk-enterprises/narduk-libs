/**
 * A consumer using every seam of the `./app/error-page` export
 * (narduk-libs#976), type-checked by `tests/error-page-types.test.ts`.
 */
import EstateErrorPage from '@narduk-enterprises/narduk-core/app/error-page'
import { h } from 'vue'

import type { ErrorPageCopy, ErrorPageLink } from '@narduk-enterprises/narduk-core/app/error-page'
import type { NuxtError } from 'nuxt/app'

declare const error: NuxtError

const copy: ErrorPageCopy = {
  404: { title: 'No screen lives at that address.' },
  default: { description: 'The farm hit a snag.' },
}
const links: ErrorPageLink[] = [{ label: 'Stations', to: '/stations', icon: 'i-lucide-search' }]

export const vnode = h(
  EstateErrorPage,
  {
    error,
    copy,
    homeLabel: 'Back to Today',
    homeTo: '/today',
    layout: 'auth',
    links,
    onBeforeClear: (failed: NuxtError, action: 'home' | 'retry') => {
      void failed
      void action
    },
    retryLabel: 'Reload',
    ui: { home: 'bg-sky-600', status: 'text-sky-700', title: 'text-sky-900' },
  },
  { actions: () => [h('span', 'extra')] },
)
