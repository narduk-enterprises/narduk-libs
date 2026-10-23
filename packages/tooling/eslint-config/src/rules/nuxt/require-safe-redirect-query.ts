/**
 * Rule: require-safe-redirect-query
 *
 * A `?redirect=` / `?next=` / `?returnTo=` value is attacker-chosen. Navigating
 * to it unchecked is an open redirect: `/sign-in?next=//evil.example` sends a
 * freshly signed-in user to a page that looks like the app. Every read of such
 * a parameter must reach a same-origin guard before it is used as a value.
 *
 *   flagged   navigateTo(route.query.redirect)
 *             const next = getQuery(event).next; return sendRedirect(event, next)
 *             const { returnTo } = useRoute().query; router.push(returnTo)
 *             const r = typeof q.redirect === 'string' ? q.redirect : null
 *             navigateTo(r && r.startsWith('/') ? r : '/')   — `//evil` passes
 *
 *   allowed   sanitizeSameOriginPath(route.query.next, fallback)
 *             const next = getQuery(event).next; sanitizeNextPath(next, '/')
 *             typeof route.query.next === 'string'          — a type test only
 *
 * A read is followed through `as`, `!`, `?.`, `??`/`||`, a ternary's branches
 * and one `const` binding (whose every use must then reach a guard). Guards are
 * the narduk-auth sanitizers, a `safe…`/`sanitize…`/`isSafe…` callee naming a
 * redirect, path, URL or target (`safeLoginRedirect`, not `safeParse`),
 * `isSameOrigin…`, and the rule's `guards` option for an app's own helper.
 * `String()`, `decodeURIComponent()`, `computed()`, `r[0]`, `r.trim()` and
 * `.value` pass the value on. Test trees are exempt.
 */

import type { Rule } from 'eslint'

import { templateBodyVisitor } from '../hydration/_internal'
import { getIdentifierName, unwrapTsWrappers } from '../utils/mutation-route'
import { isTestOrFixturePath } from '../utils/path-scope'

const DEFAULT_PARAMS = [
  'callbackUrl',
  'next',
  'redirect',
  'redirectTo',
  'redirectUrl',
  'redirect_to',
  'returnTo',
  'returnUrl',
  'return_to',
]

/** narduk-auth's same-origin sanitizers. */
const DEFAULT_GUARDS = [
  'normalizeDemoRedirectPath',
  'resolveLocalRedirectRequest',
  'sanitizeLocalEmailRedirect',
  'sanitizeLocalRedirectPath',
  'sanitizeNextPath',
  'sanitizeSameOriginPath',
]

/** `safeLoginRedirect`, `sanitizeReturnPath`, `isSameOriginUrl`; not zod's `safeParse`. */
const GUARD_NAME =
  /^(?:isSameOrigin|sameOrigin)|^(?:safe|sanitize|isSafe)\w*(?:Redirect|Path|Url|Href|Next|Target)/

/** Calls that return the same value, so its use is decided further out. */
const PASS_THROUGH_CALLS = new Set([
  'String',
  'computed',
  'decodeURI',
  'decodeURIComponent',
  'toRef',
  'toValue',
  'unref',
])

/** Members that return the value or part of it: `r[0]`, `r.trim()`, `ref.value`. */
const PASS_THROUGH_MEMBERS = new Set([
  'at',
  'normalize',
  'replace',
  'slice',
  'substring',
  'toLowerCase',
  'toString',
  'trim',
  'value',
  'valueOf',
])

/** Wrappers a value passes through unchanged. */
const TRANSPARENT = new Set([
  'ChainExpression',
  'TSAsExpression',
  'TSNonNullExpression',
  'TSSatisfiesExpression',
  'TSTypeAssertion',
])

const MAX_HOPS = 2

function calleeName(callee: any): string | null {
  const target = unwrapTsWrappers(callee)
  if (target?.type === 'Identifier') return target.name
  if (target?.type === 'MemberExpression' && !target.computed)
    return getIdentifierName(target.property)
  return null
}

function propertyName(member: any): string | null {
  if (!member.computed) return getIdentifierName(member.property)
  return member.property?.type === 'Literal' && typeof member.property.value === 'string'
    ? member.property.value
    : null
}

export default {
  meta: {
    type: 'problem' as const,
    docs: {
      description: 'require redirect-like query parameters to pass a same-origin guard',
      recommended: true,
    },
    schema: [
      {
        type: 'object',
        properties: {
          params: { type: 'array', items: { type: 'string' } },
          guards: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      unguarded:
        "Query parameter `{{ param }}` is used without a same-origin guard, so `?{{ param }}=//evil.example` is an open redirect. Pass it through `sanitizeSameOriginPath()` (narduk-auth) or a guard named in this rule's `guards` option.",
    },
  },

  create(context: Rule.RuleContext): Rule.RuleListener {
    if (isTestOrFixturePath(context.filename ?? '')) return {}
    const options = (context.options[0] ?? {}) as { params?: string[]; guards?: string[] }
    const params = new Set(options.params ?? DEFAULT_PARAMS)
    const guards = new Set([...DEFAULT_GUARDS, ...(options.guards ?? [])])
    const sourceCode = context.sourceCode

    const isGuard = (callee: any) => {
      const name = calleeName(callee)
      return name !== null && (guards.has(name) || GUARD_NAME.test(name))
    }

    /** `x.query`, `getQuery(e)`, `useRoute().query`, or a `const` bound to one. */
    function isQueryObject(node: any, hops = 0): boolean {
      const target = unwrapTsWrappers(node?.type === 'ChainExpression' ? node.expression : node)
      if (!target) return false
      if (target.type === 'MemberExpression') return propertyName(target) === 'query'
      if (target.type === 'CallExpression') return calleeName(target.callee) === 'getQuery'
      if (target.type === 'Identifier' && hops < MAX_HOPS) {
        const init = constInit(target)
        return init ? isQueryObject(init, hops + 1) : false
      }
      return false
    }

    /** `url.searchParams`, `new URLSearchParams(…)`, or a `const` bound to one. */
    function isSearchParams(node: any, hops = 0): boolean {
      const target = unwrapTsWrappers(node)
      if (!target) return false
      if (target.type === 'MemberExpression') return propertyName(target) === 'searchParams'
      if (target.type === 'NewExpression')
        return getIdentifierName(target.callee) === 'URLSearchParams'
      if (target.type === 'Identifier' && hops < MAX_HOPS) {
        const init = constInit(target)
        return init ? isSearchParams(init, hops + 1) : false
      }
      return false
    }

    function variableOf(identifier: any): any {
      let scope: any
      try {
        scope = sourceCode.getScope(identifier)
      } catch {
        return null
      }
      while (scope) {
        const found = scope.set?.get(identifier.name)
        if (found) return found
        scope = scope.upper
      }
      return null
    }

    function constInit(identifier: any): any {
      const def = variableOf(identifier)?.defs?.[0]
      if (def?.type !== 'Variable' || def.parent?.kind !== 'const') return null
      return def.node.id?.type === 'Identifier' ? def.node.init : null
    }

    /** Does this value, wherever it flows, reach a guard before any other use? */
    function flowsOnlyToGuards(start: any, hops: number): boolean {
      let node = start
      for (;;) {
        const parent = node.parent
        if (!parent) return false
        if (TRANSPARENT.has(parent.type)) {
          node = parent
          continue
        }
        if (parent.type === 'ConditionalExpression') {
          if (parent.test === node) return true
          node = parent
          continue
        }
        if (parent.type === 'LogicalExpression') {
          // `x && x.startsWith('/')` tests x; the result is the test's value.
          if (parent.operator === '&&' && parent.left === node) return true
          node = parent
          continue
        }
        if (parent.type === 'BinaryExpression' && parent.operator === '+') {
          node = parent
          continue
        }
        if (parent.type === 'UnaryExpression' || parent.type === 'BinaryExpression') return true
        if (parent.type === 'MemberExpression' && parent.object === node) {
          // `r.startsWith('/')`, `r.length`: a test of the value, not a use of it.
          if (!parent.computed && !PASS_THROUGH_MEMBERS.has(propertyName(parent) ?? '')) return true
          const call = parent.parent
          node = call?.type === 'CallExpression' && call.callee === parent ? call : parent
          continue
        }
        if (parent.type === 'CallExpression' && parent.arguments.includes(node)) {
          if (calleeName(parent.callee) === 'isArray') return true
          if (isGuard(parent.callee)) {
            // `sanitizeSameOriginPath(value, fallback)` returns the fallback verbatim.
            const last = parent.arguments.length - 1
            return last === 0 || parent.arguments.indexOf(node) < last
          }
          if (!PASS_THROUGH_CALLS.has(calleeName(parent.callee) ?? '')) return false
          node = parent
          continue
        }
        if (parent.type === 'ArrowFunctionExpression' && parent.body === node) {
          // `computed(() => q.next)` passes the value on; a `watch` source is untracked.
          const call = parent.parent
          if (call?.type !== 'CallExpression' || !call.arguments.includes(parent)) return false
          if (calleeName(call.callee) === 'watch') return true
          if (!PASS_THROUGH_CALLS.has(calleeName(call.callee) ?? '')) return false
          node = call
          continue
        }
        if (parent.type === 'ReturnStatement') {
          // `computed(() => { return q.next })`: the returned value is the getter's.
          const getter = parent.parent?.type === 'BlockStatement' ? parent.parent.parent : null
          const call = getter?.parent
          if (
            (getter?.type !== 'ArrowFunctionExpression' && getter?.type !== 'FunctionExpression') ||
            call?.type !== 'CallExpression' ||
            !call.arguments.includes(getter)
          )
            return false
          if (calleeName(call.callee) === 'watch') return true
          if (!PASS_THROUGH_CALLS.has(calleeName(call.callee) ?? '')) return false
          node = call
          continue
        }
        if (
          parent.type === 'VariableDeclarator' &&
          parent.init === node &&
          parent.id.type === 'Identifier' &&
          hops < MAX_HOPS
        ) {
          return bindingFlowsOnlyToGuards(parent.id, hops + 1)
        }
        if (parent.type === 'ExpressionStatement') return true
        if (parent.type === 'VExpressionContainer') {
          // `:to="…"` and `@click="…"` use it; `v-if`, `v-show` and `{{ … }}` do not.
          const directive =
            parent.parent?.type === 'VAttribute' ? parent.parent.key?.name?.name : null
          return directive !== 'bind' && directive !== 'on'
        }
        return false
      }
    }

    /** Template reads of a `<script setup>` binding, which the script scope does not see. */
    function templateUses(name: string): any[] {
      const found: any[] = []
      const visit = (node: any) => {
        if (!node || typeof node !== 'object') return
        if (node.type === 'VExpressionContainer') {
          for (const reference of node.references ?? [])
            // A resolved `variable` is a `v-for` or slot-scope local shadowing the binding.
            if (reference.id?.name === name && !reference.variable) found.push(reference.id)
        }
        for (const key of ['children', 'startTag', 'attributes', 'value']) {
          const child = node[key]
          if (Array.isArray(child)) for (const item of child) visit(item)
          else visit(child)
        }
      }
      visit((sourceCode.ast as any).templateBody)
      return found
    }

    function bindingFlowsOnlyToGuards(id: any, hops: number): boolean {
      const variable = variableOf(id)
      if (!variable) return false
      const uses = [
        // vue-eslint-parser adds a reference on the declaration itself for a template use.
        ...variable.references
          .filter((reference: any) => !reference.init && reference.identifier !== id)
          .map((reference: any) => reference.identifier),
        ...(variable.scope?.type === 'module' ? templateUses(id.name) : []),
      ]
      return uses.length > 0 && uses.every((use: any) => flowsOnlyToGuards(use, hops))
    }

    const report = (node: any, param: string) =>
      context.report({ node, messageId: 'unguarded', data: { param } })

    const listeners = {
      MemberExpression(node: any) {
        const param = propertyName(node)
        if (!param || !params.has(param) || !isQueryObject(node.object)) return
        if (!flowsOnlyToGuards(node, 0)) report(node, param)
      },

      CallExpression(node: any) {
        const callee = unwrapTsWrappers(node.callee)
        if (callee?.type !== 'MemberExpression' || propertyName(callee) !== 'get') return
        const [first] = node.arguments
        if (first?.type !== 'Literal' || typeof first.value !== 'string') return
        if (!params.has(first.value) || !isSearchParams(callee.object)) return
        if (!flowsOnlyToGuards(node, 0)) report(node, first.value)
      },

      VariableDeclarator(node: any) {
        if (node.id.type !== 'ObjectPattern' || !isQueryObject(node.init)) return
        for (const property of node.id.properties) {
          if (property.type !== 'Property') continue
          const param = getIdentifierName(property.key)
          if (!param || !params.has(param)) continue
          const value =
            property.value?.type === 'AssignmentPattern' ? property.value.left : property.value
          if (value?.type !== 'Identifier') continue
          if (!bindingFlowsOnlyToGuards(value, 1)) report(property, param)
        }
      },
    }
    // `<NuxtLink :to="$route.query.next">` is a use too.
    return templateBodyVisitor(
      context,
      { MemberExpression: listeners.MemberExpression, CallExpression: listeners.CallExpression },
      listeners,
    )
  },
} satisfies Rule.RuleModule
