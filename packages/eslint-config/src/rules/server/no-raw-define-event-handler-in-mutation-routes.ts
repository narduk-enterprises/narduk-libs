/**
 * Rule: no-raw-define-event-handler-in-mutation-routes
 *
 * Mutation routes must be declared with an approved wrapper — the wrappers are
 * where CSRF verification, rate limiting and auth live. A raw
 * `defineEventHandler()` in a mutation route silently opts out of all three.
 *
 * Mechanically this rule was fine in v1; it was dead for the same reason its
 * four siblings were — the shared gate only matched `server/api/**` with a
 * method-suffix filename. Ported onto the rebuilt gate, so `server/routes/**`
 * and handler-declared methods are covered and a rename cannot disable it.
 *
 * ## This rule owns the indeterminate-method report
 *
 * A handler can put its method behind a value the linter cannot read —
 * `const method = ['POST'][0]; if (getMethod(event) === method) …`. The shared
 * gate refuses to guess, so the route classifies as `unspecified` and every
 * rule that needs a *proven* mutation goes quiet: the adversarial pass shipped
 * exactly that file and got zero diagnostics on a runtime POST handler.
 *
 * The gate records the ambiguity (`hasUnresolvableMethod`) and this rule is the
 * one place it surfaces, because the fix is the same fix this rule already
 * asks for — decide what the route is. Naming the method (a `.post.ts`
 * filename, or a literal in the comparison) makes the whole tier decidable
 * again; adopting a wrapper makes the question moot. The other five rules stay
 * silent on ambiguity by design: reporting a missing rate limit on a route that
 * may well be read-only is how a security tier gets switched off wholesale.
 *
 * No autofix: swapping the wrapper changes the route's auth posture and the
 * correct wrapper (admin / user / public / webhook / cron / callback) is a
 * decision about who may call the route.
 */

import type { Rule } from 'eslint'

import {
  APPROVED_MUTATION_WRAPPERS,
  analyzeMutationRoute,
  hasUnresolvableMethod,
  isExemptTestPath,
  resolveAliasedName,
  shouldGuardMutations,
  unwrapTsWrappers,
} from '../utils/mutation-route'

const RAW_HANDLER_NAMES = new Set([
  'defineEventHandler',
  'eventHandler',
  'defineLazyEventHandler',
  'defineCachedEventHandler',
])

export default {
  meta: {
    type: 'problem' as const,
    docs: {
      description:
        'mutation routes must use an approved mutation wrapper instead of a raw defineEventHandler()',
      recommended: true,
    },
    schema: [
      {
        type: 'object',
        properties: {
          allowedWrappers: { type: 'array', items: { type: 'string' }, uniqueItems: true },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      useMutationWrapper:
        'Mutation routes must be declared with one of {{wrappers}} instead of raw {{raw}}(). The wrapper is where CSRF, rate limiting and auth are applied.',
      indeterminateMethod:
        "This route's HTTP method cannot be statically determined — it is tested against a value the linter cannot read, and the filename declares no method, so Nitro routes every method here. Use a method-suffixed filename (`…​.post.ts`) or compare against a literal, or declare the route with one of {{wrappers}}. Until then CSRF, rate-limit and body-validation enforcement cannot apply to it.",
    },
  },

  create(context: Rule.RuleContext): Rule.RuleListener {
    const filename = context.filename ?? (context as any).getFilename?.() ?? ''
    if (!filename || isExemptTestPath(filename)) return {}

    const { sourceCode } = context
    const routeInfo = analyzeMutationRoute(filename, sourceCode)
    const guardMutations = shouldGuardMutations(routeInfo)
    const reportIndeterminate = !guardMutations && hasUnresolvableMethod(routeInfo)
    if (!guardMutations && !reportIndeterminate) return {}

    const options = (context.options[0] ?? {}) as { allowedWrappers?: string[] }
    const wrappers = options.allowedWrappers ?? [...APPROVED_MUTATION_WRAPPERS]
    const wrapperList = wrappers.map((wrapper) => `${wrapper}()`).join(', ')
    const allowedWrappers = new Set(wrappers)

    /** Reported once — the ambiguity is a property of the route, not of a call. */
    let indeterminateReported = false

    return {
      CallExpression(node: any) {
        const callee = unwrapTsWrappers(node.callee)
        if (callee?.type !== 'Identifier') return

        // `const handler = defineEventHandler` then `handler(…)` is the same
        // raw handler. Resolved through the scope manager, so an unrelated
        // local named `defineEventHandler` in another scope is not swept in.
        const name = resolveAliasedName(callee, sourceCode, RAW_HANDLER_NAMES)
        if (!name) return

        // A raw handler nested inside an approved wrapper is the wrapper's own
        // composition (`defineUserMutation(defineEventHandler(…))`) and is fine.
        let parent = node.parent
        for (let depth = 0; parent && depth < 16; depth += 1) {
          if (parent.type === 'CallExpression') {
            const outer = resolveAliasedName(
              unwrapTsWrappers(parent.callee),
              sourceCode,
              allowedWrappers,
            )
            if (outer) return
          }
          parent = parent.parent
        }

        if (reportIndeterminate) {
          if (indeterminateReported) return
          indeterminateReported = true
          context.report({
            node: callee,
            messageId: 'indeterminateMethod',
            data: { wrappers: wrapperList },
          })
          return
        }

        context.report({
          node: callee,
          messageId: 'useMutationWrapper',
          data: { wrappers: wrapperList, raw: name },
        })
      },
    }
  },
} satisfies Rule.RuleModule
