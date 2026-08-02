/**
 * Rule: require-immediate-mutation-body-validation
 *
 * v1 checked the *method name* of the receiving call and nothing else, so
 * `JSON.parse(await readBody(event))` counted as validation — deserialization
 * accepted as a schema check on the one path this rule exists to protect. Its
 * own sibling rule (`prefer-safe-parse-in-event-handlers`) already maintained a
 * `NON_SCHEMA_RECEIVERS` list for exactly this distinction; this rebuild uses
 * the shared list and extends it.
 *
 * Accepted validation shapes:
 *   schema.parse(await readBody(event))            zod / valibot method form
 *   schema.safeParseAsync(await readBody(event))
 *   v.parse(Schema, await readBody(event))         valibot namespace form
 *   parse(Schema, await readBody(event))           bare imported parser
 *
 * Rejected:
 *   JSON.parse(await readBody(event))              not validation
 *   const body = await readBody(event)             deferred / unvalidated
 *
 * Scope comes from the shared mutation-route gate, so `server/routes/**` is
 * covered and a rename cannot silently disable it. Declared read-only routes
 * are skipped; method-less routes are included, because a route that reads a
 * body accepts one regardless of what its filename says.
 *
 * No autofix — inserting a schema call requires choosing the schema.
 */

import type { Rule } from 'eslint'

import {
  APPROVED_PARSE_METHODS,
  NON_SCHEMA_RECEIVERS,
  analyzeMutationRoute,
  getIdentifierName,
  shouldGuardMutations,
  unwrapTsWrappers,
  isExemptTestPath,
} from '../utils/mutation-route'

interface Options {
  /** Route prefixes exempt from the requirement. */
  exemptRoutePrefixes?: string[]
  /** Extra receiver names that are NOT schema validators. */
  nonSchemaReceivers?: string[]
  /** Body-reading calls the rule guards. */
  bodyReaders?: string[]
}

const DEFAULT_EXEMPT_PREFIXES = ['webhooks/', 'cron/', 'callbacks/']
const DEFAULT_BODY_READERS = ['readBody', 'readRawBody', 'readFormData', 'readMultipartFormData']

export default {
  meta: {
    type: 'problem' as const,
    docs: {
      description:
        'require readBody() in a mutation route to be validated inline by a schema parser (JSON.parse is not validation)',
      recommended: true,
    },
    schema: [
      {
        type: 'object',
        properties: {
          exemptRoutePrefixes: { type: 'array', items: { type: 'string' }, uniqueItems: true },
          nonSchemaReceivers: { type: 'array', items: { type: 'string' }, uniqueItems: true },
          bodyReaders: { type: 'array', items: { type: 'string' }, uniqueItems: true },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      requireImmediateValidation:
        '{{reader}}() must be validated inline by a schema parser — schema.parse()/safeParse() (or the async variants) — before the value is used.',
      nonSchemaReceiver:
        '`{{receiver}}.{{method}}()` deserializes, it does not validate. Wrap {{reader}}() in a schema parser such as schema.safeParse().',
    },
  },

  create(context: Rule.RuleContext): Rule.RuleListener {
    const options = (context.options[0] ?? {}) as Options
    const filename = context.filename ?? (context as any).getFilename?.() ?? ''
    if (!filename || isExemptTestPath(filename)) return {}

    const routeInfo = analyzeMutationRoute(filename, context.sourceCode)
    // Method-less routes are included: Nitro routes POST to them, and the
    // visitor only fires when a body is actually read, so an unspecified GET
    // handler that never reads a body produces nothing.
    if (!shouldGuardMutations(routeInfo, { includeUnspecified: true })) return {}

    const exemptPrefixes = options.exemptRoutePrefixes ?? DEFAULT_EXEMPT_PREFIXES
    if (
      routeInfo.routeRelativePath &&
      exemptPrefixes.some((prefix) => routeInfo.routeRelativePath!.startsWith(prefix))
    ) {
      return {}
    }

    const nonSchemaReceivers = new Set<string>([
      ...NON_SCHEMA_RECEIVERS,
      ...(options.nonSchemaReceivers ?? []),
    ])
    const bodyReaders = new Set(options.bodyReaders ?? DEFAULT_BODY_READERS)

    /**
     * Classify the call that receives the body value.
     * `null` -> not a parse call at all.
     */
    function classifyReceivingCall(
      call: any,
    ): { ok: true } | { ok: false; receiver: string; method: string } | null {
      if (call?.type !== 'CallExpression') return null
      const callee = unwrapTsWrappers(call.callee)

      // Bare `parse(Schema, body)` from an imported parser.
      if (callee?.type === 'Identifier') {
        return APPROVED_PARSE_METHODS.has(callee.name) ? { ok: true } : null
      }

      if (callee?.type !== 'MemberExpression') return null
      const method = getIdentifierName(callee.property)
      if (!method || !APPROVED_PARSE_METHODS.has(method)) return null

      const receiverName = getIdentifierName(unwrapTsWrappers(callee.object))
      if (receiverName && nonSchemaReceivers.has(receiverName)) {
        return { ok: false, receiver: receiverName, method }
      }
      return { ok: true }
    }

    return {
      CallExpression(node: any) {
        const callee = unwrapTsWrappers(node.callee)
        const readerName = getIdentifierName(callee)
        if (!readerName || !bodyReaders.has(readerName)) return
        if (callee?.type !== 'Identifier') return

        // Climb past `await` and TS wrappers to the expression the parser sees.
        let expression: any = node
        let parent: any = node.parent
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

        const classification = classifyReceivingCall(parent)

        if (classification?.ok === true) {
          // The body value has to be an argument of that parse call, not merely
          // somewhere beneath it.
          const isArgument = (parent.arguments ?? []).some(
            (argument: any) => argument === expression || unwrapTsWrappers(argument) === expression,
          )
          if (isArgument) return
        }

        if (classification && classification.ok === false) {
          context.report({
            node: callee,
            messageId: 'nonSchemaReceiver',
            data: {
              receiver: classification.receiver,
              method: classification.method,
              reader: readerName,
            },
          })
          return
        }

        context.report({
          node: callee,
          messageId: 'requireImmediateValidation',
          data: { reader: readerName },
        })
      },
    }
  },
} satisfies Rule.RuleModule
