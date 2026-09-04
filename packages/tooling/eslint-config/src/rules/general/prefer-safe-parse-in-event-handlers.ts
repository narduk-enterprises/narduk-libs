/**
 * Prefer `safeParse(...)` / `safeParseAsync(...)` over `.parse()` /
 * `.parseAsync()` inside event-handler functions.
 *
 * `.parse()` throws on failure, which Nitro turns into a 500 unless the handler
 * is wrapped in a well-known safe wrapper. `safeParse()` with explicit error
 * branching lets the handler return a predictable 4xx.
 *
 * Deep-review verdict: SOLID / KEEP (26 tests) — "best-engineered rule in the
 * package: TS-wrapper unwrapping, `NON_SCHEMA_RECEIVERS`, correct
 * `try`/`finally` discrimination, scope-manager wrapper resolution". Ported
 * unchanged in behaviour, on the ESLint 10 API surface.
 *
 * Two v1 imports are inlined instead of carried across tiers:
 *  - `unwrapCalleeWrappers` from `utils/data-fetch-ast`, a 733-LOC module the
 *    review graded SHAKY with no direct test. Only this one predicate is
 *    needed; it is reproduced verbatim in behaviour.
 *  - `APPROVED_MUTATION_WRAPPERS` from the server tier's
 *    `mutation-route-utils`. That module is being REBUILT (the review proved
 *    its `MUTATION_ROUTE_PATTERN` file gate misses `server/routes/**` and
 *    method-less handlers, silently disabling four security rules on a
 *    rename). The rebuild concerns the *path* regex; this rule consumes only
 *    the wrapper NAME list, which the review did not fault, so inlining the
 *    list decouples the port from that rebuild without changing behaviour.
 *
 * Known, tested boundary: `NON_SCHEMA_RECEIVERS` is matched on the receiver
 * IDENTIFIER, so `JSON.parse` / `qs.parse` are exempt but an aliased
 * `import JSONish from 'node:querystring'` is not — the review's repo-wide
 * alias/namespace weakness class. Asserted as an `invalid` case so the
 * false-positive shape is on the record rather than assumed absent.
 */

import type { Rule } from 'eslint'

const DEFAULT_ALLOWED_HANDLER_WRAPPERS = ['withValidation', 'safeHandler', 'validateRequest']

const PARSE_METHODS = new Set(['parse', 'parseAsync'])

const EVENT_HANDLER_WRAPPERS = new Set([
  'defineEventHandler',
  'defineCachedEventHandler',
  'defineLazyEventHandler',
])

/** Inlined from v1 `src/rules/server/mutation-route-utils.ts` — name list only. */
const APPROVED_MUTATION_WRAPPERS = new Set([
  'defineAdminMutation',
  'definePublicMutation',
  'defineUserMutation',
  'defineCallbackMutation',
  'defineWebhookMutation',
  'defineCronMutation',
])

/**
 * Built-in / stdlib receivers that expose a `.parse()` which is not a Zod
 * schema. Recommending `safeParse` on them would always be a false positive,
 * and `JSON.parse` in particular is extremely common inside event handlers.
 * Also covers popular Node/h3 utilities that ship `parse()` with no
 * `safeParse()` counterpart.
 */
const NON_SCHEMA_RECEIVERS = new Set([
  'JSON',
  'Date',
  'URL',
  'cookie',
  'cookies',
  'qs',
  'querystring',
  'yaml',
  'YAML',
  'toml',
  'TOML',
])

type Options = { allowedHandlerWrappers?: string[] }

/* ------------------------------------------------------------------ *
 * Inlined from v1 `src/rules/utils/data-fetch-ast.ts`
 * ------------------------------------------------------------------ */

function unwrapTypeCasts(node: any): any {
  let cur = node
  for (let i = 0; cur && i < 16; i++) {
    if (
      cur.type === 'TSAsExpression' ||
      cur.type === 'TSSatisfiesExpression' ||
      cur.type === 'TSTypeAssertion' ||
      cur.type === 'TSNonNullExpression' ||
      cur.type === 'TSInstantiationExpression' ||
      cur.type === 'ParenthesizedExpression'
    ) {
      cur = cur.expression
    } else {
      return cur
    }
  }
  return cur
}

/**
 * Strip BOTH `ChainExpression` optional-chaining wrappers AND TS wrapper nodes
 * from a callee, in one loop, until stable — inputs stack them in either order
 * (`((schema?.parse as any)(…))`, `((schema.parse) as any)(…)`).
 */
function unwrapCalleeWrappers(node: any): any {
  let cur = node
  for (let i = 0; cur && i < 32; i++) {
    if (cur.type === 'ChainExpression') {
      cur = cur.expression
      continue
    }
    const next = unwrapTypeCasts(cur)
    if (next === cur) {
      return cur
    }
    cur = next
  }
  return cur
}

/* ------------------------------------------------------------------ *
 * Handler / wrapper resolution
 * ------------------------------------------------------------------ */

/**
 * Only a `try` BODY with a `catch` clause protects the call. A bare
 * `try { schema.parse(…) } finally { … }` still lets the validation error
 * propagate to the handler boundary and must be flagged.
 */
function isWithinTryBlock(node: any): boolean {
  let child: any = node
  let current = node?.parent
  while (current) {
    if (current.type === 'TryStatement' && current.block === child && current.handler) {
      return true
    }
    if (
      current.type === 'FunctionDeclaration' ||
      current.type === 'FunctionExpression' ||
      current.type === 'ArrowFunctionExpression'
    ) {
      return false
    }
    child = current
    current = current.parent
  }
  return false
}

function findEnclosingFunction(node: any): any | null {
  let current = node?.parent
  while (current) {
    if (
      current.type === 'FunctionDeclaration' ||
      current.type === 'FunctionExpression' ||
      current.type === 'ArrowFunctionExpression'
    ) {
      return current
    }
    current = current.parent
  }
  return null
}

function getCalleeName(callee: any): string | null {
  if (callee?.type === 'Identifier') {
    return callee.name
  }
  if (callee?.type === 'MemberExpression' && callee.property?.type === 'Identifier') {
    return callee.property.name
  }
  return null
}

function getDirectWrappingCalleeName(fnNode: any): string | null {
  const parent = fnNode?.parent
  if (parent?.type !== 'CallExpression' || parent.arguments?.[0] !== fnNode) {
    return null
  }
  return getCalleeName(parent.callee)
}

function getBindingIdentifier(fnNode: any): any | null {
  if (fnNode?.type === 'FunctionDeclaration') {
    return fnNode.id ?? null
  }
  const parent = fnNode?.parent
  // const handler = () => { … }
  if (parent?.type === 'VariableDeclarator' && parent.init === fnNode) {
    return parent.id?.type === 'Identifier' ? parent.id : null
  }
  // handler = () => { … }
  if (parent?.type === 'AssignmentExpression' && parent.right === fnNode) {
    return parent.left?.type === 'Identifier' ? parent.left : null
  }
  return null
}

function getWrappingCalleeNamesViaBinding(scopeManager: any, fnNode: any): string[] {
  const bindingId = getBindingIdentifier(fnNode)
  if (!bindingId || !scopeManager) {
    return []
  }
  const scope = scopeManager.acquire(fnNode, true) ?? scopeManager.globalScope
  let current: any = scope
  while (current) {
    const variable = current.set?.get?.(bindingId.name)
    if (variable) {
      const names: string[] = []
      for (const ref of variable.references ?? []) {
        const idNode = ref.identifier
        const parent = idNode?.parent
        if (parent?.type === 'CallExpression' && parent.arguments?.[0] === idNode) {
          const calleeName = getCalleeName(parent.callee)
          if (calleeName) names.push(calleeName)
        }
      }
      return names
    }
    current = current.upper
  }
  return []
}

function getAllWrappingCalleeNames(scopeManager: any, fnNode: any): string[] {
  const names: string[] = []
  const direct = getDirectWrappingCalleeName(fnNode)
  if (direct) names.push(direct)
  names.push(...getWrappingCalleeNamesViaBinding(scopeManager, fnNode))
  return names
}

function isInsideApprovedHandler(
  scopeManager: any,
  node: any,
  allowedWrappers: Set<string>,
): boolean {
  let fn = findEnclosingFunction(node)
  while (fn) {
    if (getAllWrappingCalleeNames(scopeManager, fn).some((name) => allowedWrappers.has(name))) {
      return true
    }
    fn = findEnclosingFunction(fn)
  }
  return false
}

function isInsideEventHandlerOrMutationWrapper(scopeManager: any, node: any): boolean {
  let fn = findEnclosingFunction(node)
  while (fn) {
    const wrapperNames = getAllWrappingCalleeNames(scopeManager, fn)
    if (
      wrapperNames.some(
        (name) => EVENT_HANDLER_WRAPPERS.has(name) || APPROVED_MUTATION_WRAPPERS.has(name),
      )
    ) {
      return true
    }
    fn = findEnclosingFunction(fn)
  }
  return false
}

export default {
  meta: {
    type: 'suggestion' as const,
    docs: {
      description:
        'prefer zod `safeParse`/`safeParseAsync` over `parse`/`parseAsync` inside event-handler functions',
      recommended: true,
    },
    schema: [
      {
        type: 'object',
        properties: {
          allowedHandlerWrappers: {
            type: 'array',
            items: { type: 'string' },
            uniqueItems: true,
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      preferSafeParse:
        'Prefer `{{method}}` over `.{{original}}(...)` inside event handlers. `.{{original}}()` throws, which converts zod validation errors into 500 responses; switch to `{{method}}()` and branch on `result.success`.',
    },
  },

  create(context: Rule.RuleContext): Rule.RuleListener {
    const options = (context.options[0] ?? {}) as Options
    const allowedWrappers = new Set<string>(
      options.allowedHandlerWrappers ?? DEFAULT_ALLOWED_HANDLER_WRAPPERS,
    )
    const scopeManager = (context.sourceCode as any)?.scopeManager ?? null

    return {
      CallExpression(node: any) {
        // Optional chaining (`schema?.parse(…)`) and TS wrappers
        // (`(schema.parse as any)(…)`) can surround the callee in any order.
        const callee = unwrapCalleeWrappers(node.callee)
        if (
          callee?.type !== 'MemberExpression' ||
          callee.property?.type !== 'Identifier' ||
          !PARSE_METHODS.has(callee.property.name)
        ) {
          return
        }

        if (callee.object?.type === 'Identifier' && NON_SCHEMA_RECEIVERS.has(callee.object.name)) {
          return
        }

        if (!isInsideEventHandlerOrMutationWrapper(scopeManager, node)) {
          return
        }

        if (isWithinTryBlock(node)) {
          return
        }

        if (isInsideApprovedHandler(scopeManager, node, allowedWrappers)) {
          return
        }

        const original = callee.property.name
        const replacement = original === 'parse' ? 'safeParse' : 'safeParseAsync'

        context.report({
          node: callee.property,
          messageId: 'preferSafeParse',
          data: { original, method: replacement },
        })
      },
    }
  },
} satisfies Rule.RuleModule
