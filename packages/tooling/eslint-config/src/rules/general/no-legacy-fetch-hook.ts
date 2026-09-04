/**
 * Detect the Nuxt 2 Options-API `fetch()` hook and point at
 * `useFetch()` / `useAsyncData()`.
 *
 * Deep-review verdict: SOLID / KEEP (2 tests).
 *
 * REVIEW FINDING IMPLEMENTED — frozen spec tier removed. v1 asked
 * `spec-loader.getApiSpec('useFetch')` for the doc URL. The review proved that
 * loader reads a git-tracked 88 KB snapshot over a hardcoded path ladder,
 * returns `{components:{}}` and caches it when the file is missing (silent
 * green lint), and aborts the whole lint run on an unguarded `JSON.parse` when
 * it is malformed. DESIGN.md drops the spec tier wholesale, so the doc URL is
 * now the literal Nuxt URL that lookup fell back to anyway. Nothing the rule
 * reports changes.
 *
 * Known, tested boundaries:
 *  - the rule only runs under `vue-eslint-parser`; a Nuxt 2 `fetch()` hook only
 *    ever appears in an SFC's Options-API default export.
 *  - the property must be a shorthand method (`async fetch() {}`). A
 *    value-position function (`fetch: async function () {}`) is NOT reported.
 *    That is v1 behaviour, asserted as a `valid` case so the gap is recorded
 *    rather than assumed closed.
 */

import type { Rule } from 'eslint'

const NUXT_FETCH_DOCS = 'https://nuxt.com/docs/api/composables/use-fetch'

export default {
  meta: {
    type: 'problem' as const,
    docs: {
      description: 'disallow the legacy Nuxt 2 fetch() hook',
      recommended: true,
      url: NUXT_FETCH_DOCS,
    },
    schema: [],
    messages: {
      legacyFetch: 'Use useFetch() or useAsyncData() instead of fetch() hook. See: {{docUrl}}',
    },
  },

  create(context: Rule.RuleContext): Rule.RuleListener {
    const parserServices = context.sourceCode?.parserServices as any
    if (!parserServices?.defineTemplateBodyVisitor) {
      return {}
    }

    return parserServices.defineTemplateBodyVisitor(
      {},
      {
        'Property[key.name="fetch"]'(node: any) {
          if (
            node.method &&
            node.parent?.type === 'ObjectExpression' &&
            node.parent.parent?.type === 'ExportDefaultDeclaration'
          ) {
            context.report({
              node,
              messageId: 'legacyFetch',
              data: { docUrl: NUXT_FETCH_DOCS },
            })
          }
        },
      },
    ) as Rule.RuleListener
  },
} satisfies Rule.RuleModule
