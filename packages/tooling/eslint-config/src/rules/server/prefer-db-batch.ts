/**
 * Rule: prefer-db-batch
 *
 * On D1 (and libSQL) every awaited `db.insert/update/delete` is its own round
 * trip. Two or more independent writes in a row, or a `Promise.all` over a
 * mapped write, belong in one `db.batch([...])`: one round trip, and the writes
 * commit or fail together instead of leaving a half-applied change behind.
 *
 *   flagged   await db.insert(a).values(x)
 *             await db.update(b).set(y).where(eq(b.id, id))
 *
 *             await Promise.all(rows.map((r) => db.insert(t).values(r)))
 *
 *   allowed   const [row] = await db.insert(a).values(x).returning()
 *             await db.insert(b).values({ aId: row.id })   — depends on row
 *
 *             await db.insert(a).values(x)
 *             log.info('inserted')                         — not consecutive
 *             await db.delete(b).where(eq(b.id, id))
 *
 * A later write that reads a binding declared by an earlier write in the run
 * breaks the run: it cannot go in the same batch. `tx.*` inside a transaction
 * callback is not flagged — only receivers named in `receivers` (default
 * `['db']`). Scope: `server/**` sources, test trees exempt. Warn-level: a batch
 * is a D1/libSQL API, not a node-postgres one.
 */

import type { Rule } from 'eslint'

import { getIdentifierName, isExemptTestPath, unwrapTsWrappers } from '../utils/mutation-route'
import { isServerSourcePath } from '../utils/path-scope'

const WRITE_METHODS = new Set(['insert', 'update', 'delete'])

interface Options {
  receivers?: string[]
}

export default {
  meta: {
    type: 'suggestion' as const,
    docs: {
      description:
        'prefer db.batch([...]) over consecutive or mapped drizzle writes in server code',
      recommended: true,
    },
    schema: [
      {
        type: 'object',
        properties: { receivers: { type: 'array', items: { type: 'string' }, uniqueItems: true } },
        additionalProperties: false,
      },
    ],
    messages: {
      consecutive:
        '{{ count }} consecutive awaited drizzle writes. Use `db.batch([...])` to send them in one round trip and commit them together.',
      mapped:
        '`Promise.all` over mapped drizzle writes. Use `db.batch(rows.map(...))` to send them in one round trip and commit them together.',
    },
  },

  create(context: Rule.RuleContext): Rule.RuleListener {
    const filename = context.filename ?? ''
    if (!isServerSourcePath(filename) || isExemptTestPath(filename)) return {}
    const receivers = new Set(((context.options[0] ?? {}) as Options).receivers ?? ['db'])

    /** Is this expression a `<receiver>.insert|update|delete(...)…` chain? */
    function isWriteChain(node: any): boolean {
      let current = unwrapTsWrappers(node)
      for (let depth = 0; depth < 32; depth += 1) {
        if (current?.type !== 'CallExpression') return false
        const callee = unwrapTsWrappers(current.callee)
        if (callee?.type !== 'MemberExpression') return false
        const object = unwrapTsWrappers(callee.object)
        if (object?.type === 'Identifier') {
          return (
            receivers.has(object.name) &&
            WRITE_METHODS.has(getIdentifierName(callee.property) ?? '')
          )
        }
        current = object
      }
      return false
    }

    /** The awaited write in `await w`, `x = await w`, `const x = await w`. */
    function awaitedWriteOf(statement: any): any | null {
      let expression: any = null
      if (statement.type === 'ExpressionStatement') {
        expression = statement.expression
        if (expression?.type === 'AssignmentExpression') expression = expression.right
      } else if (statement.type === 'VariableDeclaration' && statement.declarations.length === 1) {
        expression = statement.declarations[0].init
      }
      expression = unwrapTsWrappers(expression)
      if (expression?.type !== 'AwaitExpression') return null
      return isWriteChain(expression.argument) ? expression : null
    }

    function declaredNames(statement: any): Set<string> {
      const names = new Set<string>()
      const collect = (pattern: any): void => {
        if (!pattern) return
        if (pattern.type === 'Identifier') names.add(pattern.name)
        else if (pattern.type === 'ArrayPattern') {
          for (const element of pattern.elements) collect(element)
        } else if (pattern.type === 'ObjectPattern') {
          for (const property of pattern.properties) {
            collect(property.type === 'RestElement' ? property.argument : property.value)
          }
        } else if (pattern.type === 'AssignmentPattern') collect(pattern.left)
        else if (pattern.type === 'RestElement') collect(pattern.argument)
      }
      if (statement.type === 'VariableDeclaration') {
        for (const declarator of statement.declarations) collect(declarator.id)
      } else if (statement.expression?.type === 'AssignmentExpression') {
        collect(statement.expression.left)
      }
      return names
    }

    function readsAny(statement: any, names: Set<string>): boolean {
      if (names.size === 0) return false
      const tokens = context.sourceCode.getTokens(statement)
      return tokens.some((token) => token.type === 'Identifier' && names.has(token.value))
    }

    function checkBody(statements: any[]): void {
      let run: any[] = []
      let bound = new Set<string>()
      const flush = (): void => {
        if (run.length >= 2) {
          context.report({
            node: run[1],
            messageId: 'consecutive',
            data: { count: String(run.length) },
          })
        }
        run = []
        bound = new Set()
      }
      for (const statement of statements) {
        if (!awaitedWriteOf(statement)) {
          flush()
          continue
        }
        if (readsAny(statement, bound)) flush()
        run.push(statement)
        for (const name of declaredNames(statement)) bound.add(name)
      }
      flush()
    }

    return {
      Program(node: any) {
        checkBody(node.body)
      },
      BlockStatement(node: any) {
        checkBody(node.body)
      },
      CallExpression(node: any) {
        const callee = unwrapTsWrappers(node.callee)
        if (
          callee?.type !== 'MemberExpression' ||
          getIdentifierName(callee.object) !== 'Promise' ||
          !['all', 'allSettled'].includes(getIdentifierName(callee.property) ?? '')
        ) {
          return
        }
        const mapped = unwrapTsWrappers(node.arguments?.[0])
        if (mapped?.type !== 'CallExpression') return
        const mapCallee = unwrapTsWrappers(mapped.callee)
        if (
          mapCallee?.type !== 'MemberExpression' ||
          getIdentifierName(mapCallee.property) !== 'map'
        )
          return
        const callback = mapped.arguments?.[0]
        if (callback?.type !== 'ArrowFunctionExpression' && callback?.type !== 'FunctionExpression')
          return

        let found = false
        const visit = (child: any): void => {
          if (found || !child || typeof child.type !== 'string') return
          if (isWriteChain(child)) {
            found = true
            return
          }
          for (const key of Object.keys(child)) {
            if (key === 'parent') continue
            const value = child[key]
            if (Array.isArray(value)) {
              for (const item of value) visit(item)
            } else if (value && typeof value.type === 'string') visit(value)
          }
        }
        visit(callback.body)
        if (found) context.report({ node, messageId: 'mapped' })
      },
    }
  },
} satisfies Rule.RuleModule
