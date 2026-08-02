/**
 * Rule: no-template-complex-expressions
 *
 * Logic in a template is neither testable nor cacheable; move it into a computed
 * property or a method.
 *
 * Kept from v1 with two deep-review defects fixed:
 *
 *  - `countLogicalOps` combined its recursive results with `Math.max`, so it
 *    measured nesting *depth*, not operator count. `a && b && c && d && e && f`
 *    scored 1, which made the default `maxLogicalOps: 5` unreachable. Operators
 *    are now summed.
 *  - the `toFixed`/`toString`/`toLocaleString` whitelist entries were dead
 *    because only `Identifier` callees ever resolved a name. Member callees now
 *    resolve to their property name, so `price.toFixed(2)` is allowed again.
 */

import type { Rule } from 'eslint'

import { templateBodyVisitor } from '../hydration/_internal'

const DEFAULT_ALLOWED_FUNCTIONS = [
  'formatPrice',
  'formatChange',
  'formatPercent',
  'formatDate',
  'formatCurrency',
  'formatNumber',
  'toLocaleString',
  'toString',
  'toFixed',
]

/** Nesting depth of a ternary chain (depth is the right measure here). */
function ternaryDepth(node: any, depth = 0): number {
  if (node?.type !== 'ConditionalExpression') return depth
  return Math.max(ternaryDepth(node.consequent, depth + 1), ternaryDepth(node.alternate, depth + 1))
}

/** Total number of `&&`/`||` operators in an expression. */
function logicalOperatorCount(node: any): number {
  if (node?.type !== 'LogicalExpression') return 0
  if (node.operator !== '&&' && node.operator !== '||') return 0
  return 1 + logicalOperatorCount(node.left) + logicalOperatorCount(node.right)
}

function calleeName(callee: any): string | null {
  if (callee?.type === 'Identifier') return callee.name
  if (
    callee?.type === 'MemberExpression' &&
    !callee.computed &&
    callee.property?.type === 'Identifier'
  ) {
    return callee.property.name
  }
  return null
}

function isComplexArgument(node: any, depth = 0): boolean {
  if (!node || typeof node !== 'object' || depth > 20) return false
  if (node.type === 'ConditionalExpression' || node.type === 'LogicalExpression') return true
  if (node.type === 'CallExpression' && (node.arguments?.length ?? 0) > 0) return true

  for (const key of Object.keys(node)) {
    if (key === 'parent' || key === 'loc' || key === 'range') continue
    const child = (node as any)[key]
    if (Array.isArray(child)) {
      if (
        child.some(
          (entry) => entry && typeof entry === 'object' && isComplexArgument(entry, depth + 1),
        )
      ) {
        return true
      }
    } else if (
      child &&
      typeof child === 'object' &&
      typeof child.type === 'string' &&
      isComplexArgument(child, depth + 1)
    ) {
      return true
    }
  }
  return false
}

export default {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'disallow complex expressions in templates',
      recommended: true,
      url: 'https://vuejs.org/style-guide/rules-strongly-recommended.html',
    },
    schema: [
      {
        type: 'object',
        properties: {
          maxTernaryDepth: { type: 'number' },
          maxLogicalOps: { type: 'number' },
          maxCallArgs: { type: 'number' },
          allowedFunctions: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      complexExpression:
        'This template expression is too complex ({{reason}}). Move it into a computed property or a method.',
    },
  },
  create(context: Rule.RuleContext): Rule.RuleListener {
    const options = (context.options[0] ?? {}) as {
      maxTernaryDepth?: number
      maxLogicalOps?: number
      maxCallArgs?: number
      allowedFunctions?: string[]
    }
    const maxTernaryDepth = options.maxTernaryDepth ?? 2
    const maxLogicalOps = options.maxLogicalOps ?? 5
    const maxCallArgs = options.maxCallArgs ?? 3
    const allowedFunctions = new Set(options.allowedFunctions ?? DEFAULT_ALLOWED_FUNCTIONS)

    function checkExpression(node: any) {
      if (!node) return

      const depth = ternaryDepth(node)
      if (depth > maxTernaryDepth) {
        context.report({
          node,
          messageId: 'complexExpression',
          data: { reason: `${depth} nested ternaries, max ${maxTernaryDepth}` },
        })
        return
      }

      const operators = logicalOperatorCount(node)
      if (operators > maxLogicalOps) {
        context.report({
          node,
          messageId: 'complexExpression',
          data: { reason: `${operators} logical operators, max ${maxLogicalOps}` },
        })
        return
      }

      let reported = false
      const checkCalls = (current: any, depthGuard: number): void => {
        if (reported || !current || typeof current !== 'object' || depthGuard > 20) return

        if (current.type === 'CallExpression' && (current.arguments?.length ?? 0) > 0) {
          const name = calleeName(current.callee)
          if (name && allowedFunctions.has(name)) return

          if (current.arguments.length > maxCallArgs) {
            reported = true
            context.report({
              node: current,
              messageId: 'complexExpression',
              data: { reason: `${current.arguments.length} call arguments, max ${maxCallArgs}` },
            })
            return
          }

          if (current.arguments.some((argument: any) => isComplexArgument(argument))) {
            reported = true
            context.report({
              node: current,
              messageId: 'complexExpression',
              data: { reason: 'a nested expression is passed as a call argument' },
            })
          }
          return
        }

        for (const key of Object.keys(current)) {
          if (key === 'parent' || key === 'loc' || key === 'range') continue
          const child = (current as any)[key]
          if (Array.isArray(child)) {
            for (const entry of child) {
              if (entry && typeof entry === 'object' && typeof entry.type === 'string') {
                checkCalls(entry, depthGuard + 1)
              }
            }
          } else if (child && typeof child === 'object' && typeof child.type === 'string') {
            checkCalls(child, depthGuard + 1)
          }
        }
      }

      checkCalls(node, 0)
    }

    return templateBodyVisitor(context, {
      'VExpressionContainer[expression!=null]'(node: any) {
        checkExpression(node.expression)
      },
    })
  },
} satisfies Rule.RuleModule
