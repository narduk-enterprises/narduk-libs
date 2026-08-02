/**
 * Rule: require-validated-query
 *
 * Rebuilt from v1's untested `.mjs` version, which the deep review graded
 * UNRELIABLE for three reasons, all fixed here:
 *
 *   - **Scope-blind.** It kept a flat `Set<string>` of "validated" *names*, so
 *     validating a `query` in one function marked every other `query` in the
 *     file validated too. This version resolves the actual variable through
 *     the scope manager and inspects that variable's own references.
 *   - **Receiver-blind.** Any `.parse()` counted, so
 *     `JSON.parse(getQuery(event))` was validation. Now the receiver is checked
 *     against the shared `NON_SCHEMA_RECEIVERS` list.
 *   - **Destructuring escaped.** `const { limit } = getQuery(event)` bound no
 *     identifier the rule tracked and passed silently. It is now reported.
 *
 * `getValidatedQuery(event, schema)` — Nitro's built-in — is the canonical fix
 * and is never flagged, because the rule only visits `getQuery`.
 *
 * No autofix: the schema is the developer's to write.
 */

import type { Rule } from 'eslint'

import {
  APPROVED_PARSE_METHODS,
  NON_SCHEMA_RECEIVERS,
  analyzeServerRoutePath,
  getIdentifierName,
  unwrapTsWrappers,
  isExemptTestPath,
} from '../utils/mutation-route'

interface Options {
  nonSchemaReceivers?: string[]
}

export default {
  meta: {
    type: 'problem' as const,
    docs: {
      description: 'require getQuery() results to be validated by a schema parser before use',
      recommended: true,
    },
    schema: [
      {
        type: 'object',
        properties: {
          nonSchemaReceivers: { type: 'array', items: { type: 'string' }, uniqueItems: true },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      requireValidation:
        'getQuery() results must be validated with a schema parser (schema.safeParse(query)) or read through getValidatedQuery(event, schema).',
      nonSchemaReceiver:
        '`{{receiver}}.{{method}}()` deserializes, it does not validate. Validate the query with a schema parser instead.',
      destructuredWithoutValidation:
        'Destructuring getQuery() skips validation. Parse the whole object with a schema first, or use getValidatedQuery(event, schema).',
    },
  },

  create(context: Rule.RuleContext): Rule.RuleListener {
    const filename = context.filename ?? (context as any).getFilename?.() ?? ''
    if (!filename || isExemptTestPath(filename)) return {}
    if (!analyzeServerRoutePath(filename).isServerRoute) return {}

    const options = (context.options[0] ?? {}) as Options
    const nonSchemaReceivers = new Set<string>([
      ...NON_SCHEMA_RECEIVERS,
      ...(options.nonSchemaReceivers ?? []),
    ])
    const sourceCode = context.sourceCode

    /** Is `call` a schema-parse call (and not a deserializer)? */
    function parseCallKind(call: any): 'schema' | { receiver: string; method: string } | null {
      if (call?.type !== 'CallExpression') return null
      const callee = unwrapTsWrappers(call.callee)

      if (callee?.type === 'Identifier') {
        return APPROVED_PARSE_METHODS.has(callee.name) ? 'schema' : null
      }
      if (callee?.type !== 'MemberExpression') return null

      const method = getIdentifierName(callee.property)
      if (!method || !APPROVED_PARSE_METHODS.has(method)) return null

      const receiver = getIdentifierName(unwrapTsWrappers(callee.object))
      if (receiver && nonSchemaReceivers.has(receiver)) return { receiver, method }
      return 'schema'
    }

    /** Climb past await/TS wrappers to the node a parser would receive. */
    function liftedExpression(node: any): { expression: any; parent: any } {
      let expression = node
      let parent = node.parent
      for (let depth = 0; parent && depth < 8; depth += 1) {
        if (
          parent.type === 'AwaitExpression' ||
          parent.type === 'TSAsExpression' ||
          parent.type === 'TSSatisfiesExpression' ||
          parent.type === 'TSNonNullExpression' ||
          parent.type === 'ChainExpression'
        ) {
          expression = parent
          parent = parent.parent
          continue
        }
        break
      }
      return { expression, parent }
    }

    return {
      CallExpression(node: any) {
        const callee = unwrapTsWrappers(node.callee)
        if (callee?.type !== 'Identifier' || callee.name !== 'getQuery') return

        const { expression, parent } = liftedExpression(node)

        // 1. Inline: `schema.safeParse(getQuery(event))`.
        const inlineKind = parseCallKind(parent)
        if (inlineKind === 'schema') {
          const isArgument = (parent.arguments ?? []).some(
            (argument: any) => argument === expression || unwrapTsWrappers(argument) === expression,
          )
          if (isArgument) return
        }
        if (inlineKind && inlineKind !== 'schema') {
          context.report({
            node: callee,
            messageId: 'nonSchemaReceiver',
            data: inlineKind,
          })
          return
        }

        // 2. Assigned to a variable: check that VARIABLE's own references.
        if (parent?.type === 'VariableDeclarator' && parent.init === expression) {
          if (parent.id?.type !== 'Identifier') {
            context.report({ node: callee, messageId: 'destructuredWithoutValidation' })
            return
          }

          const variable = sourceCode.getDeclaredVariables(parent)[0] ?? null
          const validated = (variable?.references ?? []).some((reference: any) => {
            if (!reference.isRead?.()) return false
            const identifier = reference.identifier
            const lifted = liftedExpression(identifier)
            const kind = parseCallKind(lifted.parent)
            if (kind !== 'schema') return false
            return (lifted.parent.arguments ?? []).some(
              (argument: any) =>
                argument === lifted.expression || unwrapTsWrappers(argument) === lifted.expression,
            )
          })
          if (validated) return

          context.report({ node: callee, messageId: 'requireValidation' })
          return
        }

        // 3. Anything else — inline property reads, spreads, direct returns.
        context.report({ node: callee, messageId: 'requireValidation' })
      },
    }
  },
} satisfies Rule.RuleModule
