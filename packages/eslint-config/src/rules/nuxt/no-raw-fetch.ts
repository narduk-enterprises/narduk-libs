/**
 * Rule: no-raw-fetch
 *
 * A `$fetch()` awaited at the top level of `<script setup>` runs once on the
 * server and again after hydration, because its result is not part of the Nuxt
 * payload. `useAsyncData()`/`useFetch()` dedupe it.
 *
 * Rewritten from v1, which was unreliable in both directions (deep-review proof 12):
 *
 *  - its path gate was `normalized.includes('/app/pages/')`, which is `false` for
 *    the relative filenames ESLint reports in a repo root run — so all seven of
 *    its "valid" test cases executed no rule logic at all. The gate now goes
 *    through the shared, tested `path-scope` util;
 *  - it reported *any* callee named `$fetch`, so the canonical
 *    `useAsyncData('users', () => $fetch('/api/users'))` was an error, as was
 *    every `$fetch` inside an event handler (where it is the correct API).
 *    Only top-level setup calls outside a data-fetch composable report now.
 */

import type { Rule } from 'eslint'

import {
  calleeName,
  getFilename,
  inDir,
  isInsideDataFetchComposable,
  isTestOrFixturePath,
  isTopLevel,
} from './_internal'

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'disallow top-level $fetch in pages and components — use useAsyncData or useFetch',
      recommended: true,
      url: 'https://nuxt.com/docs/api/composables/use-fetch',
    },
    schema: [],
    messages: {
      rawFetch:
        '`$fetch()` during setup runs on the server and again after hydration. Wrap it in useAsyncData() (or use useFetch()) so the result is transferred in the payload.',
    },
  },
  create(context: Rule.RuleContext): Rule.RuleListener {
    const filename = getFilename(context)
    if (isTestOrFixturePath(filename)) return {}
    if (!inDir(filename, 'pages') && !inDir(filename, 'components')) return {}

    return {
      CallExpression(node: any) {
        if (calleeName(node.callee) !== '$fetch') return
        // `useAsyncData('k', () => $fetch(…))` and useFetch internals are correct.
        if (isInsideDataFetchComposable(node)) return
        // Inside an event handler or any other function, `$fetch` is the right API.
        if (!isTopLevel(node)) return

        context.report({ node, messageId: 'rawFetch' })
      },
    }
  },
} satisfies Rule.RuleModule
