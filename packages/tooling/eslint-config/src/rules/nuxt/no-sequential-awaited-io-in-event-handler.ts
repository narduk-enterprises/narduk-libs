/**
 * Rule: no-sequential-awaited-io-in-event-handler
 *
 * Two independent reads awaited one after the other in a Nitro handler add their
 * latencies together for every request.
 *
 * Kept from v1 with two deep-review defects fixed:
 *
 *  - the sibling rule `no-sequential-awaited-data-fetching` recommended
 *    `Promise.all` for `/cart/lock` followed by `/cart/submit` — introducing a
 *    race in code whose *ordering was the point*. Calls that look like mutations
 *    (an explicit non-GET `method`, or an insert/update/delete/transaction
 *    builder chain) are excluded, and the message no longer tells you to
 *    parallelise unconditionally;
 *  - v1 re-walked the entire handler subtree with `Object.keys()` for every
 *    `defineEventHandler`. Only the handler's own statement list is scanned.
 */

import type { Rule } from 'eslint'

import {
  SCRIPT_EXTENSION_PATTERN,
  bareCalleeName,
  collectBoundNames,
  collectIdentifierNames,
  getFilename,
  inServerDir,
  isIoCall,
  isMutationCall,
  isTestOrFixturePath,
} from './_internal'

const HANDLER_DEFINERS = new Set([
  'defineEventHandler',
  'defineCachedEventHandler',
  'defineLazyEventHandler',
])

interface AwaitedIo {
  statement: any
  call: any
  bound: Set<string>
}

/** The awaited I/O call a statement performs, if it performs exactly one at its top level. */
function awaitedIoOf(statement: any): AwaitedIo | null {
  const bound = new Set<string>()
  let awaited: any = null

  if (statement?.type === 'VariableDeclaration') {
    const declarators = statement.declarations ?? []
    if (declarators.length !== 1) return null
    const [declarator] = declarators
    if (declarator.init?.type !== 'AwaitExpression') return null
    collectBoundNames(declarator.id, bound)
    awaited = declarator.init.argument
  } else if (
    statement?.type === 'ExpressionStatement' &&
    statement.expression?.type === 'AwaitExpression'
  ) {
    awaited = statement.expression.argument
  } else {
    return null
  }

  if (!isIoCall(awaited)) return null
  return { statement, call: awaited, bound }
}

function isFunctionLike(node: any): boolean {
  return (
    node?.type === 'ArrowFunctionExpression' ||
    node?.type === 'FunctionExpression' ||
    node?.type === 'FunctionDeclaration'
  )
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'disallow sequential awaits of independent reads in a Nitro event handler',
      recommended: true,
      url: 'https://nitro.build/guide/routing',
    },
    schema: [],
    messages: {
      sequentialReads:
        'These two reads do not depend on each other, so their latencies add up on every request. Because both are reads, they can be issued together (Promise.all) or batched into one query. Leave ordered writes sequential.',
    },
  },
  create(context: Rule.RuleContext): Rule.RuleListener {
    const filename = getFilename(context)
    if (isTestOrFixturePath(filename)) return {}
    if (!inServerDir(filename) || !SCRIPT_EXTENSION_PATTERN.test(filename)) return {}

    /** Named functions, so `defineEventHandler(handler)` can be followed. */
    const namedFunctions = new Map<string, any>()

    function resolveHandler(argument: any): any {
      if (isFunctionLike(argument)) return argument
      if (argument?.type === 'Identifier') return namedFunctions.get(argument.name) ?? null
      if (argument?.type === 'ObjectExpression') {
        for (const property of argument.properties ?? []) {
          if (
            property.type === 'Property' &&
            !property.computed &&
            property.key?.type === 'Identifier' &&
            property.key.name === 'handler' &&
            isFunctionLike(property.value)
          ) {
            return property.value
          }
        }
      }
      return null
    }

    function checkHandler(fn: any) {
      const body = fn?.body
      if (body?.type !== 'BlockStatement') return

      let previous: AwaitedIo | null = null

      for (const statement of body.body ?? []) {
        const current = awaitedIoOf(statement)
        if (!current) {
          previous = null
          continue
        }

        if (previous && !isMutationCall(previous.call) && !isMutationCall(current.call)) {
          const referenced = collectIdentifierNames(current.call)
          const dependsOnPrevious = [...previous.bound].some((name) => referenced.has(name))
          if (!dependsOnPrevious) {
            context.report({ node: current.call, messageId: 'sequentialReads' })
          }
        }

        previous = current
      }
    }

    const handlerCalls: any[] = []

    return {
      FunctionDeclaration(node: any) {
        if (node.id?.name) namedFunctions.set(node.id.name, node)
      },
      VariableDeclarator(node: any) {
        if (node.id?.type === 'Identifier' && isFunctionLike(node.init)) {
          namedFunctions.set(node.id.name, node.init)
        }
      },
      CallExpression(node: any) {
        const definer = bareCalleeName(node.callee)
        if (definer && HANDLER_DEFINERS.has(definer)) handlerCalls.push(node)
      },
      // Deferred so a hoisted `function handler() {}` declared after the
      // `defineEventHandler(handler)` call is still resolvable.
      'Program:exit'() {
        for (const call of handlerCalls) {
          const handler = resolveHandler(call.arguments?.[0])
          if (handler) checkHandler(handler)
        }
      },
    }
  },
} satisfies Rule.RuleModule
