/**
 * Disallow `.map(async …)` in server code.
 *
 * `array.map(async fn)` produces an array of promises and, once awaited with
 * `Promise.all`, fires one round-trip per element — the classic N+1. Prefer a
 * single batched query (`inArray(table.id, ids)`, `.in('id', ids)`, …).
 *
 * Deep-review verdict: SOLID / KEEP (8 tests).
 *
 * REVIEW FINDING IMPLEMENTED — duplicated path predicates. v1 inlined its own
 * copy of the test/fixture exclusion; the review counted "seven rules [that]
 * inline divergent copies of one `isLikelyTestOrFixturePath` predicate". Both
 * the scope gate and the exclusion now go through the shared, tested
 * `path-scope` util. v1's server gate already carried the `startsWith('server/')`
 * fallback, so the scope this rule reports on is unchanged.
 */

import type { Rule } from 'eslint'
import { inAppScope, isTestOrFixturePath } from '../utils/path-scope'

export default {
  meta: {
    type: 'problem' as const,
    docs: {
      description: 'disallow `.map(async …)` in server code — use batched queries to avoid N+1',
      recommended: true,
    },
    schema: [],
    messages: {
      mapAsync:
        '.map(async ...) in server code often causes N+1 queries. Prefer batched queries (e.g. .in("id", ids)).',
    },
  },

  create(context: Rule.RuleContext): Rule.RuleListener {
    const filename = context.filename
    if (!inAppScope(filename, 'server')) {
      return {}
    }
    if (isTestOrFixturePath(filename)) {
      return {}
    }

    return {
      CallExpression(node: any) {
        // With optional chaining (`rows?.map(async …)`) the parser wraps the
        // callee in a ChainExpression whose `.expression` is the MemberExpression.
        let callee = node.callee
        if (callee?.type === 'ChainExpression') {
          callee = callee.expression
        }
        if (callee?.type !== 'MemberExpression') {
          return
        }
        const prop = callee.property
        if (prop?.type !== 'Identifier' || prop.name !== 'map') {
          return
        }
        const first = node.arguments[0]
        if (
          !first ||
          (first.type !== 'ArrowFunctionExpression' && first.type !== 'FunctionExpression')
        ) {
          return
        }
        if (first.async) {
          context.report({
            node: callee.property,
            messageId: 'mapAsync',
          })
        }
      },
    }
  },
} satisfies Rule.RuleModule
