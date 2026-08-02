/**
 * Rule: no-raw-fetch-in-stores
 *
 * A store action that calls `$fetch`/`useFetch` directly loses the incoming
 * request's cookies and headers during SSR, so the server render is
 * unauthenticated while the client render is not. `useRequestFetch()` (or the
 * app's `useAppFetch()` wrapper) proxies them.
 *
 * Kept from v1; its ad-hoc `includes('/app/stores/') || startsWith('app/stores/')`
 * gate is replaced by the shared, tested `path-scope` util so the Nuxt 3 layout
 * and relative filenames are covered too.
 */

import type { Rule } from 'eslint'

import {
  SCRIPT_EXTENSION_PATTERN,
  calleeName,
  getFilename,
  inDir,
  isTestOrFixturePath,
} from './_internal'

const BANNED_IN_STORES = new Set(['$fetch', 'useFetch', 'useLazyFetch'])

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'disallow $fetch/useFetch in stores — use useRequestFetch for SSR cookie proxying',
      recommended: true,
      url: 'https://nuxt.com/docs/api/composables/use-request-fetch',
    },
    schema: [],
    messages: {
      rawFetchInStore:
        '`{{name}}()` in a store drops the incoming request cookies/headers during SSR. Use useRequestFetch() (or the app fetch wrapper), or accept a fetch function as a parameter.',
    },
  },
  create(context: Rule.RuleContext): Rule.RuleListener {
    const filename = getFilename(context)
    if (isTestOrFixturePath(filename)) return {}
    if (!inDir(filename, 'stores') || !SCRIPT_EXTENSION_PATTERN.test(filename)) return {}

    return {
      CallExpression(node: any) {
        const name = calleeName(node.callee)
        if (!name || !BANNED_IN_STORES.has(name)) return
        context.report({ node, messageId: 'rawFetchInStore', data: { name } })
      },
    }
  },
} satisfies Rule.RuleModule
