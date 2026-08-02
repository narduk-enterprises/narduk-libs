/**
 * Require `defineStore()` to be given a static string-literal id.
 *
 * A computed / imported id breaks Pinia devtools, SSR state hydration keys, and
 * `eslint-plugin-pinia`'s own `no-duplicate-store-ids`.
 *
 * Deep-review verdict: SOLID / KEEP (4 tests). Ported unchanged apart from the
 * ESLint 10 API surface, the removal of the `spec-loader`-adjacent doc-URL
 * indirection (the frozen spec tier is dropped wholesale by DESIGN.md), and
 * inlining the two-line `isLiteral` helper that used to live in the shared
 * `utils/ast-utils` module the review graded SHAKY.
 *
 * Known, tested boundaries:
 *  - the callee must be a bare `Identifier` named `defineStore`. An aliased
 *    import (`import { defineStore as createStore }`) or a namespace call
 *    (`pinia.defineStore(...)`) is not reported — the review's repo-wide
 *    alias/namespace weakness class, asserted as `valid` cases so the boundary
 *    is visible.
 *  - a `TemplateLiteral` id is reported. `defineStore(`user`)` is legal Pinia
 *    but indistinguishable at this layer from the interpolated
 *    `defineStore(`user-${x}`)` the rule exists to catch, so both report.
 */

import type { Rule } from 'eslint'

const PINIA_DOCS = 'https://pinia.vuejs.org/'

function isLiteralLike(node: any): boolean {
  return node?.type === 'Literal' || node?.type === 'TemplateLiteral'
}

export default {
  meta: {
    type: 'problem' as const,
    docs: {
      description: 'require defineStore to have a string literal id',
      recommended: true,
      url: PINIA_DOCS,
    },
    schema: [],
    messages: {
      requireStoreId: 'defineStore() requires a string literal id as first argument. See: {{url}}',
    },
  },

  create(context: Rule.RuleContext): Rule.RuleListener {
    return {
      CallExpression(node: any) {
        if (node.callee?.type !== 'Identifier' || node.callee.name !== 'defineStore') {
          return
        }

        if (node.arguments.length === 0) {
          context.report({
            node,
            messageId: 'requireStoreId',
            data: { url: PINIA_DOCS },
          })
          return
        }

        const firstArg = node.arguments[0]

        if (
          !isLiteralLike(firstArg) ||
          firstArg.type !== 'Literal' ||
          typeof firstArg.value !== 'string'
        ) {
          context.report({
            node: firstArg ?? node,
            messageId: 'requireStoreId',
            data: { url: PINIA_DOCS },
          })
        }
      },
    }
  },
} satisfies Rule.RuleModule
