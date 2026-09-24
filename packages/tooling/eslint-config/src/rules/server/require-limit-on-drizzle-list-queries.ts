/**
 * Rule: require-limit-on-drizzle-list-queries
 *
 * v1 required a literal `.select().from()` chain, so drizzle's relational query
 * API — `db.query.users.findMany()`, the form most estate code actually uses —
 * was never checked at all. It also false-positived on aggregates, where a
 * `.limit()` is meaningless: `db.select({ n: count() }).from(users)` returns
 * one row by construction.
 *
 * This rebuild covers both query builders and skips aggregates:
 *
 *   flagged   db.select().from(users)                     — unbounded scan
 *             db.select().from(users).where(eq(u.org, o)) — non-PK filter
 *             db.query.users.findMany()
 *             db.query.users.findMany({ where: eq(u.org, o) })
 *
 *   allowed   …​.limit(50)                                 — bounded
 *             …​.where(eq(users.id, id))                   — single row by PK
 *             db.query.users.findFirst()                  — single row
 *             db.select({ n: count() }).from(users)       — aggregate
 *             …​.groupBy(users.orgId)                      — aggregate
 *
 * Two evasions the adversarial pass proved, both now covered:
 *
 *   const { users } = db.query      the receiver is no longer a `.query.` chain,
 *   users.findMany()                so the shape test missed it. The receiver is
 *   const t = db.query.users        now resolved back through single-assignment
 *   t.findMany()                    locals, member and destructured alike.
 *
 *   findMany({ limit: undefined })  an explicit `undefined` is a `limit` key
 *                                   with no bound. Presence of the key is not
 *                                   the guarantee; a value is.
 *
 * ## Chains that are neither awaited nor returned (2026-09-18)
 *
 * A select chain handed straight to a helper was invisible:
 * `getDatabaseRows(db.select().from(apiKeys).where(eq(apiKeys.userId, id)))`
 * in narduk-auth's `api-keys.get.ts` passed unbounded. The outermost
 * `.where(eq(<non-primary column>, …))` of a `.from()` chain is now checked
 * wherever it appears. Any other `.where(…)` in argument position is left alone
 * — only the equality-on-a-foreign-column shape reliably means "a list".
 *
 * ## Opting out with a reason
 *
 * Some lists are bounded by the domain rather than by the query (a user's API
 * keys, a tenant's handful of roles). A `// narduk-bounded: <reason>` comment
 * directly before the statement records that judgement and silences the rule
 * for that statement. The reason is required; a bare `narduk-bounded:` does
 * not count.
 *
 * No autofix and no suggestion. v1 offered to append `.limit(100)`; the right
 * bound is a product decision, and an editor "quick fix" that silently caps a
 * result set is worse than the warning.
 */

import type { Rule } from 'eslint'

import {
  analyzeServerRoutePath,
  getIdentifierName,
  unwrapTsWrappers,
  isExemptTestPath,
} from '../utils/mutation-route'

interface Options {
  primaryKeyCallees?: string[]
  primaryKeyColumns?: string[]
  aggregateCallees?: string[]
}

const DEFAULT_PRIMARY_KEY_CALLEES = ['eq', 'inArray']
const BOUNDED_COMMENT = /^\s*narduk-bounded:\s*\S/
const DEFAULT_PRIMARY_KEY_COLUMNS = ['id', 'uuid']
const DEFAULT_AGGREGATE_CALLEES = [
  'count',
  'countDistinct',
  'sum',
  'sumDistinct',
  'avg',
  'avgDistinct',
  'min',
  'max',
]

/** Names of the chained methods, outermost first. */
function chainMethodNames(node: any): string[] {
  const names: string[] = []
  let current = unwrapTsWrappers(node)
  for (let depth = 0; depth < 64; depth += 1) {
    if (current?.type !== 'CallExpression') break
    const callee = unwrapTsWrappers(current.callee)
    if (callee?.type !== 'MemberExpression') break
    const name = getIdentifierName(callee.property)
    if (name) names.push(name)
    current = unwrapTsWrappers(callee.object)
  }
  return names
}

/** The call node for a named method within the chain, if present. */
function chainCallFor(node: any, method: string): any | null {
  let current = unwrapTsWrappers(node)
  for (let depth = 0; depth < 64; depth += 1) {
    if (current?.type !== 'CallExpression') return null
    const callee = unwrapTsWrappers(current.callee)
    if (callee?.type !== 'MemberExpression') return null
    if (getIdentifierName(callee.property) === method) return current
    current = unwrapTsWrappers(callee.object)
  }
  return null
}

export default {
  meta: {
    type: 'suggestion' as const,
    docs: {
      description:
        'require .limit() or a primary-key filter on unbounded drizzle list queries in server routes',
      recommended: true,
    },
    schema: [
      {
        type: 'object',
        properties: {
          primaryKeyCallees: { type: 'array', items: { type: 'string' }, uniqueItems: true },
          primaryKeyColumns: { type: 'array', items: { type: 'string' }, uniqueItems: true },
          aggregateCallees: { type: 'array', items: { type: 'string' }, uniqueItems: true },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      requireLimit:
        'Unbounded drizzle list query. Add .limit(n), or narrow with .where(eq(<primary key>, …)). Unbounded list queries become full-table scans in production.',
      requireLimitOption:
        'Unbounded `findMany()`. Pass a `limit`, or narrow with a primary-key `where`. Unbounded list queries become full-table scans in production.',
    },
  },

  create(context: Rule.RuleContext): Rule.RuleListener {
    const filename = context.filename ?? (context as any).getFilename?.() ?? ''
    if (!filename || isExemptTestPath(filename)) return {}
    if (!analyzeServerRoutePath(filename).isServerRoute) return {}

    const options = (context.options[0] ?? {}) as Options
    const primaryKeyCallees = new Set(options.primaryKeyCallees ?? DEFAULT_PRIMARY_KEY_CALLEES)
    const primaryKeyColumns = new Set(options.primaryKeyColumns ?? DEFAULT_PRIMARY_KEY_COLUMNS)
    const aggregateCallees = new Set(options.aggregateCallees ?? DEFAULT_AGGREGATE_CALLEES)

    const reported = new Set<any>()
    const { sourceCode } = context

    /** Resolve an identifier to its variable through the real scope chain. */
    function resolveVariable(identifier: any): any | null {
      if (typeof (sourceCode as any)?.getScope !== 'function') return null
      let scope: any
      try {
        scope = (sourceCode as any).getScope(identifier)
      } catch {
        return null
      }
      while (scope) {
        const variable = scope.variables.find(
          (candidate: any) => candidate.name === identifier.name,
        )
        if (variable) return variable
        scope = scope.upper
      }
      return null
    }

    /** The sole declarator of a never-reassigned local, or null. */
    function soleDeclaratorOf(identifier: any): any | null {
      const variable = resolveVariable(identifier)
      const definitions = variable?.defs ?? []
      if (definitions.length !== 1) return null
      const [definition] = definitions
      if (definition.type !== 'Variable') return null
      const writes = (variable.references ?? []).filter((reference: any) => reference.isWrite?.())
      if (writes.length > 1) return null
      return definition.node?.type === 'VariableDeclarator' ? definition.node : null
    }

    /**
     * Does this receiver resolve to drizzle's relational `db.query` namespace?
     *
     * Requiring a literal `.query.` segment is what keeps an unrelated
     * `repo.findMany()` helper out of the rule; resolving locals is what stops
     * one destructuring line from removing that segment.
     */
    function reachesDrizzleQuery(node: any, depth = 0): boolean {
      const target = unwrapTsWrappers(node)
      if (!target || depth > 8) return false

      if (target.type === 'MemberExpression') {
        if (getIdentifierName(target.property) === 'query') return true
        return reachesDrizzleQuery(target.object, depth + 1)
      }

      if (target.type === 'Identifier') {
        // `const t = db.query.users` and `const { users } = db.query` both
        // reach the namespace through the declarator's initializer.
        const declarator = soleDeclaratorOf(target)
        if (!declarator) return false
        if (declarator.id?.type !== 'Identifier' && declarator.id?.type !== 'ObjectPattern') {
          return false
        }
        return reachesDrizzleQuery(declarator.init, depth + 1)
      }

      return false
    }

    /** An explicitly-undefined option value: `undefined` or `void 0`. */
    function isExplicitUndefined(node: any): boolean {
      const target = unwrapTsWrappers(node)
      if (!target) return false
      if (target.type === 'Identifier') return target.name === 'undefined'
      return target.type === 'UnaryExpression' && target.operator === 'void'
    }

    function targetsPrimaryKey(node: any): boolean {
      const target = unwrapTsWrappers(node)
      if (!target) return false
      if (target.type === 'Identifier') return primaryKeyColumns.has(target.name)
      if (target.type === 'MemberExpression') {
        const property = getIdentifierName(target.property)
        return property !== null && primaryKeyColumns.has(property)
      }
      return false
    }

    /** `eq(users.id, x)` / `inArray(users.id, xs)` — narrows to known rows. */
    function isPrimaryKeyCondition(node: any): boolean {
      const target = unwrapTsWrappers(node)
      if (target?.type !== 'CallExpression') return false
      const callee = getIdentifierName(unwrapTsWrappers(target.callee))
      if (!callee) return false
      if (primaryKeyCallees.has(callee)) return targetsPrimaryKey(target.arguments?.[0])
      // `and(eq(users.id, x), …)` still narrows by the primary key.
      if (callee === 'and' || callee === 'or') {
        return (target.arguments ?? []).some((argument: any) => isPrimaryKeyCondition(argument))
      }
      return false
    }

    /** `eq(<non-primary column>, …)` — an equality that selects a list. */
    function isForeignColumnEquality(node: any): boolean {
      const target = unwrapTsWrappers(node)
      if (target?.type !== 'CallExpression') return false
      if (getIdentifierName(unwrapTsWrappers(target.callee)) !== 'eq') return false
      const column = unwrapTsWrappers(target.arguments?.[0])
      return column?.type === 'MemberExpression' && !targetsPrimaryKey(column)
    }

    /** The call is not itself the receiver of a further chained method. */
    function isOutermostChainCall(node: any): boolean {
      let current = node
      while (
        current.parent &&
        ['TSAsExpression', 'TSNonNullExpression', 'ChainExpression'].includes(current.parent.type)
      ) {
        current = current.parent
      }
      const parent = current.parent
      return !(parent?.type === 'MemberExpression' && parent.object === current)
    }

    /** Does the projection consist of aggregate helpers or aggregate sql? */
    function isAggregateProjection(node: any): boolean {
      const target = unwrapTsWrappers(node)
      if (target?.type !== 'ObjectExpression') return false
      const values = target.properties
        .filter((property: any) => property.type === 'Property')
        .map((property: any) => unwrapTsWrappers(property.value))
      if (values.length === 0) return false
      return values.some((value: any) => {
        if (value?.type === 'CallExpression') {
          const callee = getIdentifierName(unwrapTsWrappers(value.callee))
          return callee !== null && aggregateCallees.has(callee)
        }
        if (value?.type === 'TaggedTemplateExpression') {
          const raw = (value.quasi?.quasis ?? [])
            .map((quasi: any) => quasi.value?.raw ?? '')
            .join(' ')
          return /\b(?:count|sum|avg|min|max)\s*\(/i.test(raw)
        }
        return false
      })
    }

    /** `// narduk-bounded: <reason>` before the node or its statement. */
    function isDeclaredBounded(node: any): boolean {
      let current = node
      for (let depth = 0; current && depth < 64; depth += 1) {
        const comments = sourceCode.getCommentsBefore(current)
        if (comments.some((comment: any) => BOUNDED_COMMENT.test(comment.value))) return true
        if (/Statement$|Declaration$/.test(current.type)) return false
        current = current.parent
      }
      return false
    }

    function report(node: any, messageId: 'requireLimit' | 'requireLimitOption'): void {
      if (reported.has(node)) return
      reported.add(node)
      if (isDeclaredBounded(node)) return
      context.report({ node, messageId })
    }

    /** `db.select(...).from(...)…` style chain. */
    function analyzeSelectChain(chain: any, reportNode: any): void {
      const methods = chainMethodNames(chain)
      if (!methods.includes('from')) return
      if (methods.includes('limit')) return
      // Aggregations collapse the result set; a limit is meaningless.
      if (methods.includes('groupBy')) return

      const selectCall = chainCallFor(chain, 'select')
      if (selectCall && isAggregateProjection(selectCall.arguments?.[0])) return

      const whereCall = chainCallFor(chain, 'where')
      if (whereCall && isPrimaryKeyCondition(whereCall.arguments?.[0])) return

      report(reportNode, 'requireLimit')
    }

    /** `db.query.<table>.findMany({ … })` style call. */
    function analyzeFindMany(node: any): void {
      const callee = unwrapTsWrappers(node.callee)
      if (callee?.type !== 'MemberExpression') return
      if (getIdentifierName(callee.property) !== 'findMany') return

      // Require a `.query.` segment so an unrelated `repo.findMany()` helper is
      // not swept in — resolved through locals, not matched on shape alone.
      if (!reachesDrizzleQuery(callee.object)) return

      const optionsArgument = unwrapTsWrappers(node.arguments?.[0])
      if (optionsArgument?.type === 'ObjectExpression') {
        for (const property of optionsArgument.properties ?? []) {
          if (property.type !== 'Property') continue
          const key = getIdentifierName(property.key)
          // `limit: undefined` is the key without the bound — drizzle treats it
          // exactly as an absent limit, so this rule has to as well.
          if (key === 'limit' && !isExplicitUndefined(property.value)) return
          if (key === 'where' && isPrimaryKeyCondition(property.value)) return
        }
      }

      report(callee.property, 'requireLimitOption')
    }

    /** Chain terminals that materialize the full result set. */
    const TERMINALS = new Set(['all', 'execute'])
    /** Terminals that are single-row or side-effecting — not list queries. */
    const NON_LIST_TERMINALS = new Set(['get', 'run', 'limit', 'returning'])

    function analyzeThenable(node: any): void {
      const target = unwrapTsWrappers(node)
      if (target?.type !== 'CallExpression') return
      const callee = unwrapTsWrappers(target.callee)
      if (callee?.type !== 'MemberExpression') return
      const method = getIdentifierName(callee.property)
      if (method === 'findMany') {
        analyzeFindMany(target)
        return
      }
      if (method && (TERMINALS.has(method) || NON_LIST_TERMINALS.has(method))) return
      analyzeSelectChain(target, target)
    }

    return {
      CallExpression(node: any) {
        const callee = unwrapTsWrappers(node.callee)
        if (callee?.type !== 'MemberExpression') return
        const method = getIdentifierName(callee.property)

        if (method === 'findMany') {
          analyzeFindMany(node)
          return
        }
        if (
          method === 'where' &&
          isOutermostChainCall(node) &&
          isForeignColumnEquality(node.arguments?.[0])
        ) {
          analyzeSelectChain(node, node)
          return
        }
        if (method && TERMINALS.has(method)) {
          analyzeSelectChain(unwrapTsWrappers(callee.object), node)
        }
      },

      AwaitExpression(node: any) {
        analyzeThenable(node.argument)
      },

      ReturnStatement(node: any) {
        analyzeThenable(node.argument)
      },

      ArrowFunctionExpression(node: any) {
        if (node.body?.type === 'CallExpression') analyzeThenable(node.body)
      },
    }
  },
} satisfies Rule.RuleModule
