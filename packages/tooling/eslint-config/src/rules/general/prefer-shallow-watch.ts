/**
 * Discourage `watch(..., { deep: true })`.
 *
 * A deep watcher walks the whole reactive graph on every mutation. Prefer
 * watching a narrow getter, or acknowledge the cost with a
 * `vue-official allow-deep-watch` block comment directly above the call.
 *
 * Deep-review verdict: SOLID / KEEP (6 tests). Ported unchanged apart from the
 * ESLint 10 API surface and the removal of the stale `docs.url` indirection.
 * The suppression token is deliberately left byte-identical to v1's, because
 * changing it would silently un-suppress every existing consumer suppression.
 *
 * Known, tested boundaries:
 *  - the callee must be a bare `Identifier` named `watch`/`watchEffect`. This
 *    is deliberate and is the reason the rule does NOT inherit the review's
 *    `no-fetch-in-watch` false positive (`chokidar.watch`, `fs.watch` are
 *    MemberExpressions and never match). The flip side is the review's
 *    alias/namespace weakness class: `import { watch as vueWatch }` and
 *    `Vue.watch(...)` are not reported, asserted as `valid` cases.
 *  - the options object must be the LAST argument, matching Vue's own
 *    signature.
 */

import type { Rule } from 'eslint'

const VUE_BEST_PRACTICES = 'https://vuejs.org/guide/best-practices/overview.html'
const WATCH_CALLEES = new Set(['watch', 'watchEffect'])
const SUPPRESSION_TOKEN = 'vue-official allow-deep-watch'

export default {
  meta: {
    type: 'suggestion' as const,
    docs: {
      description: 'prefer a shallow watcher over `deep: true`',
      recommended: true,
      url: VUE_BEST_PRACTICES,
    },
    schema: [
      {
        type: 'object',
        properties: {
          strict: { type: 'boolean' },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      preferShallowWatch:
        'Avoid deep watches when possible for performance. Use /* vue-official allow-deep-watch */ to suppress. See: {{url}}',
    },
  },

  create(context: Rule.RuleContext): Rule.RuleListener {
    const parserServices = context.sourceCode?.parserServices as any
    const options = (context.options[0] ?? {}) as { strict?: boolean }
    const strict = options.strict !== false // default: true

    const checkForDeepWatch = (node: any): void => {
      if (
        node.type !== 'CallExpression' ||
        node.callee?.type !== 'Identifier' ||
        !WATCH_CALLEES.has(node.callee.name)
      ) {
        return
      }

      const optionsArg = node.arguments.at(-1)
      if (optionsArg?.type !== 'ObjectExpression') {
        return
      }

      const hasDeep = optionsArg.properties.some((prop: any) => {
        const key = prop.key?.name ?? prop.key?.value
        return key === 'deep' && prop.value?.value === true
      })
      if (!hasDeep) {
        return
      }

      const comments = context.sourceCode.getCommentsBefore(node)
      const hasSuppression = comments.some((comment: any) =>
        comment.value.includes(SUPPRESSION_TOKEN),
      )

      if (!hasSuppression && strict) {
        context.report({
          node,
          messageId: 'preferShallowWatch',
          data: { url: VUE_BEST_PRACTICES },
        })
      }
    }

    if (parserServices?.defineTemplateBodyVisitor) {
      return parserServices.defineTemplateBodyVisitor(
        {},
        { CallExpression: checkForDeepWatch },
      ) as Rule.RuleListener
    }

    // Composables and plain TS/JS: vue-eslint-parser is not in play.
    return { CallExpression: checkForDeepWatch }
  },
} satisfies Rule.RuleModule
