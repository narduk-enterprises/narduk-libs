/**
 * Rule: require-enforce-rate-limit-on-mutations
 *
 * v1 kept **one file-scoped boolean**, set by any matching call anywhere in the
 * file — including inside a function that is never invoked. A route with a dead
 * `function unusedLegacyPath() { enforceRateLimit(event) }` passed while the
 * live handler was completely unlimited.
 *
 * This rebuild is scope-aware: the enforcing call must be **reachable from the
 * handler body** —
 *
 *   1. lexically inside the handler, crossing no other function boundary; or
 *   2. inside a local helper that the handler itself calls (one hop, resolved
 *      through the scope manager, so a same-named unrelated function does not
 *      count); or
 *   3. implied by an approved mutation wrapper, which enforces internally.
 *
 * A call sitting in an uninvoked sibling function satisfies nothing.
 *
 * Conservative by design: when the file contains no handler body at all (the
 * handler is imported, or re-exported from another module) the rule stays
 * silent rather than reporting something it cannot see. v1 reported on every
 * such file.
 *
 * No autofix — where the limit belongs, and with what policy, is a decision.
 */

import type { Rule } from 'eslint'

import {
  APPROVED_MUTATION_WRAPPERS,
  HANDLER_DEFINING_CALLS,
  analyzeMutationRoute,
  getIdentifierName,
  isExemptTestPath,
  resolveAliasedName,
  shouldGuardMutations,
  unwrapTsWrappers,
} from '../utils/mutation-route'

interface Options {
  rateLimitCalls?: string[]
  exemptRoutePrefixes?: string[]
}

const DEFAULT_RATE_LIMIT_CALLS = ['enforceRateLimit', 'enforceRateLimitPolicy']
const DEFAULT_EXEMPT_PREFIXES = ['webhooks/', 'cron/', 'callbacks/']

function isFunctionLike(node: any): boolean {
  return (
    node?.type === 'FunctionDeclaration' ||
    node?.type === 'FunctionExpression' ||
    node?.type === 'ArrowFunctionExpression'
  )
}

/** The nearest enclosing function, or null at module scope. */
function enclosingFunction(node: any): any | null {
  let current = node?.parent
  for (let depth = 0; current && depth < 512; depth += 1) {
    if (isFunctionLike(current)) return current
    current = current.parent
  }
  return null
}

export default {
  meta: {
    type: 'problem' as const,
    docs: {
      description: 'require a reachable enforceRateLimit() call in the handler of a mutation route',
      recommended: true,
    },
    schema: [
      {
        type: 'object',
        properties: {
          rateLimitCalls: { type: 'array', items: { type: 'string' }, uniqueItems: true },
          exemptRoutePrefixes: { type: 'array', items: { type: 'string' }, uniqueItems: true },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      missingRateLimit:
        'Mutation route handler must call {{calls}} on a path the handler actually reaches. A call in an uninvoked helper does not count.',
    },
  },

  create(context: Rule.RuleContext): Rule.RuleListener {
    const options = (context.options[0] ?? {}) as Options
    const filename = context.filename ?? (context as any).getFilename?.() ?? ''
    if (!filename || isExemptTestPath(filename)) return {}

    const routeInfo = analyzeMutationRoute(filename, context.sourceCode)
    if (!shouldGuardMutations(routeInfo)) return {}

    const exemptPrefixes = options.exemptRoutePrefixes ?? DEFAULT_EXEMPT_PREFIXES
    if (
      routeInfo.routeRelativePath &&
      exemptPrefixes.some((prefix) => routeInfo.routeRelativePath!.startsWith(prefix))
    ) {
      return {}
    }

    const rateLimitCalls = new Set(options.rateLimitCalls ?? DEFAULT_RATE_LIMIT_CALLS)
    const sourceCode = context.sourceCode

    /** Handler function nodes, keyed to the defining call that introduced them. */
    const handlers: Array<{ fn: any; defineNode: any; wrapperEnforces: boolean }> = []
    /** Every rate-limit call site, with the function that lexically contains it. */
    const rateLimitSites: Array<{ node: any; owner: any | null }> = []
    /** Every call site of a locally-declared function, with its lexical owner. */
    const localCallSites: Array<{ identifier: any; owner: any | null }> = []

    return {
      CallExpression(node: any) {
        const callee = unwrapTsWrappers(node.callee)
        const calleeName = getIdentifierName(callee)
        if (!calleeName) return

        // `const handler = defineEventHandler` then `handler(…)` defines a
        // handler just as much as the direct call does; without resolving the
        // alias this rule sees no handler at all and returns silently.
        const definingCall = resolveAliasedName(callee, sourceCode, HANDLER_DEFINING_CALLS)

        if (definingCall) {
          const wrapperEnforces = APPROVED_MUTATION_WRAPPERS.has(definingCall)
          const before = handlers.length
          for (const argument of node.arguments ?? []) {
            const value = unwrapTsWrappers(argument)
            if (isFunctionLike(value)) {
              handlers.push({ fn: value, defineNode: callee, wrapperEnforces })
            } else if (value?.type === 'ObjectExpression') {
              // defineEventHandler({ handler: () => {} })
              for (const property of value.properties ?? []) {
                if (property.type !== 'Property') continue
                if (getIdentifierName(property.key) !== 'handler') continue
                const handlerValue = unwrapTsWrappers(property.value)
                if (isFunctionLike(handlerValue)) {
                  handlers.push({ fn: handlerValue, defineNode: callee, wrapperEnforces })
                }
              }
            }
          }
          if (wrapperEnforces && handlers.length === before) {
            // `defineAdminMutation(handlerFromElsewhere)` still enforces, even
            // though this call contributed no in-file handler body.
            handlers.push({ fn: null, defineNode: callee, wrapperEnforces: true })
          }
        }

        if (rateLimitCalls.has(calleeName)) {
          rateLimitSites.push({ node, owner: enclosingFunction(node) })
        }

        if (callee?.type === 'Identifier') {
          localCallSites.push({ identifier: callee, owner: enclosingFunction(node) })
        }
      },

      'Program:exit'() {
        if (handlers.length === 0) return

        const wrapperHandled = handlers.some((handler) => handler.wrapperEnforces)
        if (wrapperHandled) return

        /** Is `node` lexically inside `fn` without crossing another function? */
        const directlyInside = (node: any, fn: any): boolean => {
          let current = node?.parent
          for (let depth = 0; current && depth < 512; depth += 1) {
            if (current === fn) return true
            if (isFunctionLike(current)) return false
            current = current.parent
          }
          return false
        }

        /** Functions the handler invokes directly, resolved through scope. */
        const helpersCalledBy = (fn: any): Set<any> => {
          const called = new Set<any>()
          for (const site of localCallSites) {
            if (!directlyInside(site.identifier, fn)) continue
            let scope: any = sourceCode.getScope(site.identifier)
            let variable: any = null
            while (scope && !variable) {
              variable =
                scope.variables.find((candidate: any) => candidate.name === site.identifier.name) ??
                null
              scope = scope.upper
            }
            for (const definition of variable?.defs ?? []) {
              if (definition.type === 'FunctionName') called.add(definition.node)
              if (
                definition.type === 'Variable' &&
                isFunctionLike(unwrapTsWrappers(definition.node?.init))
              ) {
                called.add(unwrapTsWrappers(definition.node.init))
              }
            }
          }
          return called
        }

        for (const handler of handlers) {
          if (!handler.fn) continue

          const reachable = new Set<any>([handler.fn, ...helpersCalledBy(handler.fn)])
          const satisfied = rateLimitSites.some((site) =>
            [...reachable].some((fn) => directlyInside(site.node, fn)),
          )

          if (!satisfied) {
            context.report({
              node: handler.defineNode,
              messageId: 'missingRateLimit',
              data: { calls: [...rateLimitCalls].map((call) => `${call}()`).join(' or ') },
            })
          }
        }
      },
    }
  },
} satisfies Rule.RuleModule
