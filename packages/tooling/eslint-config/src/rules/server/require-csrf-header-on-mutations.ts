/**
 * Rule: require-csrf-header-on-mutations
 *
 * v1's rule **matched zero files**. Its internal gate required
 * `app/composables/`, but the only config that wired it attached it to
 * `server/**` — a disjoint intersection — and 18 of its 19 tests passed
 * `testMode: true`, so the suite proved the matcher while the wiring was dead.
 * It shipped at `'error'` as a security control that could never fire.
 *
 * This rebuild gives the rule a coherent scope by making the two halves of the
 * original intent explicit, and selecting between them from the filename:
 *
 * - **server mode** — on a *mutation route* (via the shared mutation-route
 *   gate, so `server/api/**` and `server/routes/**` are both covered and a
 *   rename cannot disable it): the handler must actually verify the CSRF
 *   header, or be declared with an approved mutation wrapper that verifies it.
 *
 * - **client mode** — on an app composable/store/util: a `$fetch` call with a
 *   mutating `method` must carry the CSRF header, use `useCsrfFetch()` /
 *   `useAppFetch()`, or spread a CSRF-looking header source. This is v1's
 *   original matcher, kept because the intent is real; it is now attached to
 *   files it can actually match.
 *
 * There is no `testMode`. Every test runs through the real filename gate.
 */

import type { Rule } from 'eslint'

import {
  APPROVED_MUTATION_WRAPPERS,
  HANDLER_DEFINING_CALLS,
  MUTATION_METHODS,
  analyzeMutationRoute,
  getIdentifierName,
  isExemptTestPath,
  resolveAliasedName,
  shouldGuardMutations,
  unwrapTsWrappers,
} from '../utils/mutation-route'
import { inAppScope } from '../utils/path-scope'

type Mode = 'auto' | 'server' | 'client' | 'off'

interface Options {
  mode?: Mode
  /** Header names (lower-case) that count as CSRF verification server-side. */
  csrfHeaders?: string[]
  /** App directories treated as client API surfaces in `auto` mode. */
  clientScopes?: string[]
}

const DEFAULT_CSRF_HEADERS = ['x-requested-with', 'x-csrf-token', 'x-xsrf-token']
const DEFAULT_CLIENT_SCOPES = ['app/composables', 'app/stores', 'app/utils']

const HEADER_READERS = new Set(['getHeader', 'getRequestHeader', 'getRequestHeaders'])

function literalString(node: any): string | null {
  const target = unwrapTsWrappers(node)
  if (!target) return null
  if (target.type === 'Literal' && typeof target.value === 'string') return target.value
  if (target.type === 'TemplateLiteral' && target.expressions.length === 0) {
    return String(target.quasis[0]?.value?.raw ?? '')
  }
  return null
}

function isMutationMethodNode(node: any): boolean {
  const value = literalString(node)
  return value !== null && MUTATION_METHODS.has(value.toUpperCase())
}

/**
 * Only CSRF-*looking* sources are trusted. A bare `headers: { ...otherHeaders }`
 * must not let an author opt out of the guarantee.
 */
function looksCsrfRelated(node: any): boolean {
  const target = unwrapTsWrappers(node)
  if (!target) return false
  if (target.type === 'Identifier') return /csrf|xsrf/i.test(target.name)
  if (target.type === 'MemberExpression' && !target.computed) {
    return /csrf|xsrf/i.test(getIdentifierName(target.property) ?? '')
  }
  if (target.type === 'CallExpression') {
    const callee = unwrapTsWrappers(target.callee)
    if (callee?.type === 'Identifier') return /csrf|xsrf/i.test(callee.name)
    if (callee?.type === 'MemberExpression') {
      return /csrf|xsrf/i.test(getIdentifierName(callee.property) ?? '')
    }
  }
  return false
}

function hasCsrfHeaderEntry(headersNode: any, csrfHeaders: Set<string>): boolean {
  const target = unwrapTsWrappers(headersNode)
  if (!target) return false

  if (target.type === 'ObjectExpression') {
    return target.properties.some((property: any) => {
      if (property.type === 'SpreadElement') return looksCsrfRelated(property.argument)
      if (property.type !== 'Property') return false
      const key = getIdentifierName(property.key)
      return key !== null && csrfHeaders.has(key.toLowerCase())
    })
  }

  if (target.type === 'Identifier' || target.type === 'CallExpression') {
    return looksCsrfRelated(target)
  }
  return false
}

function findProperty(objectNode: any, name: string): any | null {
  const target = unwrapTsWrappers(objectNode)
  if (target?.type !== 'ObjectExpression') return null
  return (
    target.properties.find(
      (property: any) => property.type === 'Property' && getIdentifierName(property.key) === name,
    ) ?? null
  )
}

/** `$fetch(...)`, `$fetch.raw(...)`, `useFetch(...)` — the mutation-capable callers. */
function fetchCalleeName(node: any): string | null {
  const callee = unwrapTsWrappers(node.callee)
  if (callee?.type === 'Identifier') return callee.name
  if (callee?.type === 'MemberExpression') {
    const object = getIdentifierName(unwrapTsWrappers(callee.object))
    const property = getIdentifierName(callee.property)
    if (object && property) return `${object}.${property}`
  }
  return null
}

export default {
  meta: {
    type: 'problem' as const,
    docs: {
      description:
        'mutation routes must verify a CSRF header, and client mutation $fetch calls must send one',
      recommended: true,
    },
    schema: [
      {
        type: 'object',
        properties: {
          mode: { enum: ['auto', 'server', 'client', 'off'] },
          csrfHeaders: { type: 'array', items: { type: 'string' }, uniqueItems: true },
          clientScopes: { type: 'array', items: { type: 'string' }, uniqueItems: true },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      routeMissingCsrfCheck:
        'Mutation route does not verify a CSRF header. Read one of [{{headers}}] via getHeader(event, …), call a CSRF helper, or declare the route with an approved mutation wrapper ({{wrappers}}).',
      clientMissingCsrf:
        "Mutation $fetch call must include CSRF protection. Prefer useCsrfFetch() or useAppFetch() (they inject the header), or pass { headers: { 'X-Requested-With': 'XMLHttpRequest' } }.",
    },
  },

  create(context: Rule.RuleContext): Rule.RuleListener {
    const options = (context.options[0] ?? {}) as Options
    const mode: Mode = options.mode ?? 'auto'
    if (mode === 'off') return {}

    const filename = context.filename ?? (context as any).getFilename?.() ?? ''
    if (!filename || isExemptTestPath(filename)) return {}

    const { sourceCode } = context

    const csrfHeaders = new Set(
      (options.csrfHeaders ?? DEFAULT_CSRF_HEADERS).map((header) => header.toLowerCase()),
    )
    const clientScopes = options.clientScopes ?? DEFAULT_CLIENT_SCOPES

    const routeInfo = analyzeMutationRoute(filename, sourceCode)
    const inClientScope = clientScopes.some((scope) => inAppScope(filename, scope))

    const useServerMode =
      mode === 'server' || (mode === 'auto' && routeInfo.isMutationRoute && !inClientScope)
    const useClientMode = mode === 'client' || (mode === 'auto' && inClientScope)

    if (useServerMode) {
      // Even under an explicit `mode: 'server'` the rule only speaks about
      // mutation routes: a pack wiring it to `server/**` must not turn every
      // `server/utils/*.ts` into a CSRF violation.
      if (!shouldGuardMutations(routeInfo)) return {}
      // A CSRF-exempt route authenticates with a shared secret instead; that
      // obligation is enforced by no-csrf-exempt-route-misuse.
      if (routeInfo.isCsrfExempt) return {}

      let verified = false
      let reportNode: any = null

      return {
        CallExpression(node: any) {
          const callee = unwrapTsWrappers(node.callee)
          const calleeName = getIdentifierName(callee)

          // Alias-aware: `const handler = definePublicMutation` still declares
          // the route with a wrapper that verifies, and an aliased raw handler
          // is still the node this rule should point its report at.
          const definingCall = resolveAliasedName(callee, sourceCode, HANDLER_DEFINING_CALLS)
          if (definingCall && !reportNode) {
            reportNode = callee
            if (APPROVED_MUTATION_WRAPPERS.has(definingCall)) verified = true
          }

          // A CSRF helper of any shape: assertCsrf(event), validateCsrfToken(…),
          // security.requireCsrf(event).
          if (looksCsrfRelated(callee) || (calleeName && /csrf|xsrf/i.test(calleeName))) {
            verified = true
          }

          // getHeader(event, 'x-requested-with')
          if (calleeName && HEADER_READERS.has(calleeName)) {
            const header = literalString(node.arguments[1])
            if (header && csrfHeaders.has(header.toLowerCase())) verified = true
          }

          // event.headers.get('x-requested-with')
          if (
            callee?.type === 'MemberExpression' &&
            getIdentifierName(callee.property) === 'get' &&
            unwrapTsWrappers(callee.object)?.type === 'MemberExpression' &&
            getIdentifierName(unwrapTsWrappers(callee.object).property) === 'headers'
          ) {
            const header = literalString(node.arguments[0])
            if (header && csrfHeaders.has(header.toLowerCase())) verified = true
          }
        },

        'Program:exit'(programNode: any) {
          if (verified) return
          context.report({
            node: reportNode ?? programNode,
            messageId: 'routeMissingCsrfCheck',
            data: {
              headers: [...csrfHeaders].join(', '),
              wrappers: [...APPROVED_MUTATION_WRAPPERS].join(', '),
            },
          })
        },
      }
    }

    if (!useClientMode) return {}

    return {
      CallExpression(node: any) {
        const name = fetchCalleeName(node)
        if (name !== '$fetch' && name !== '$fetch.raw') return
        if (node.arguments.length < 2) return

        const optionsArgument = unwrapTsWrappers(node.arguments[1])
        if (optionsArgument?.type !== 'ObjectExpression') return

        const methodProperty = findProperty(optionsArgument, 'method')
        if (!methodProperty || !isMutationMethodNode(methodProperty.value)) return

        const headersProperty = findProperty(optionsArgument, 'headers')
        const spreadIsCsrf = optionsArgument.properties.some(
          (property: any) =>
            property.type === 'SpreadElement' && looksCsrfRelated(property.argument),
        )
        if (spreadIsCsrf) return
        if (headersProperty && hasCsrfHeaderEntry(headersProperty.value, csrfHeaders)) return

        context.report({ node: unwrapTsWrappers(node.callee), messageId: 'clientMissingCsrf' })
      },
    }
  },
} satisfies Rule.RuleModule
